import assert from 'node:assert/strict';

import test from 'node:test';

import type { StravaWebhookEventRow } from '~/server/db/schema';
import type { WebhookDispatchRepository } from '~/server/repositories/webhook-events';
import type { ConvexProviderEvent } from '~/server/sync/convex-events';

import {
  convexEventFor,
  dispatchEventToConvex,
  dispatchWebhookInboxToConvex,
} from './webhook-dispatch';

const now = new Date('2026-11-10T12:00:00Z');

function row(
  id: string,
  overrides: Partial<StravaWebhookEventRow> = {},
): StravaWebhookEventRow {
  return {
    id,
    subscriptionId: 1,
    objectType: 'activity',
    objectId: 9_007_199_254_740,
    aspectType: 'create',
    ownerId: 42,
    eventTime: new Date('2026-11-10T11:59:00Z'),
    payload: {} as never,
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: new Date('2026-11-10T11:59:00Z'),
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** The inbox rows of owners Convex writes for, with the real lease rules. */
function inbox(rows: StravaWebhookEventRow[]) {
  const byId = new Map(rows.map((item) => [item.id, { ...item }]));
  const held = (lease: { id: string; updatedAt: Date }) => {
    const current = byId.get(lease.id);
    return current?.status === 'processing' &&
      current.updatedAt.getTime() === lease.updatedAt.getTime()
      ? current
      : null;
  };
  const repository: WebhookDispatchRepository = {
    async selectCandidates(limit, at) {
      return [...byId.values()]
        .filter(
          (item) =>
            (item.status === 'pending' || item.status === 'failed') &&
            item.nextAttemptAt <= at,
        )
        .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime())
        .slice(0, limit)
        .map(({ id }) => ({ id }));
    },
    async claim(id, at) {
      const current = byId.get(id);
      if (
        !current ||
        (current.status !== 'pending' && current.status !== 'failed') ||
        current.nextAttemptAt > at
      )
        return null;
      const event = { ...current, status: 'processing' as const };
      byId.set(id, event);
      return { event: { ...event }, userId: 'user-a' };
    },
    async complete(lease) {
      const current = held(lease);
      if (!current) return false;
      byId.set(lease.id, { ...current, status: 'succeeded' });
      return true;
    },
    async defer(lease, error, at) {
      const current = held(lease);
      if (!current) return false;
      byId.set(lease.id, {
        ...current,
        status: 'failed',
        lastError: String(error),
        nextAttemptAt: new Date(at.getTime() + 300_000),
      });
      return true;
    },
  };
  return { repository, byId };
}

void test('an event is marked done only after Convex has recorded it', async () => {
  const { repository, byId } = inbox([row('e1')]);
  const sent: { owner: unknown; event: ConvexProviderEvent }[] = [];
  let statusWhileSending: string | undefined;
  assert.equal(
    await dispatchEventToConvex('e1', {
      repository,
      now,
      send: async (owner, event) => {
        statusWhileSending = byId.get('e1')?.status;
        sent.push({ owner, event });
      },
    }),
    'sent',
  );
  assert.equal(statusWhileSending, 'processing');
  assert.equal(byId.get('e1')?.status, 'succeeded');
  assert.deepEqual(sent, [
    {
      owner: { userId: 'user-a', athleteId: 42 },
      event: {
        event: 'e1',
        activityId: '9007199254740',
        aspect: 'create',
        eventTime: Date.parse('2026-11-10T11:59:00Z'),
      },
    },
  ]);
});

void test('a refused or failed send keeps the event, without counting attempts', async () => {
  const { repository, byId } = inbox([row('e1', { attemptCount: 9 })]);
  const refuse = async () => {
    throw new Error('Convex write bridge rejected recordEvents (400)');
  };
  assert.equal(
    await dispatchEventToConvex('e1', { repository, now, send: refuse }),
    'deferred',
  );
  const kept = byId.get('e1');
  assert.equal(kept?.status, 'failed', 'never dead-lettered');
  assert.equal(kept?.attemptCount, 9);
  assert.ok(kept && kept.nextAttemptAt > now);
  // Not due yet, and nobody else can take it meanwhile.
  assert.equal(
    await dispatchEventToConvex('e1', { repository, now, send: refuse }),
    'lostRace',
  );
});

void test('a cycle sends due events oldest first and reports what happened', async () => {
  const { repository, byId } = inbox([
    row('later', { eventTime: new Date('2026-11-10T11:58:00Z') }),
    row('first', { eventTime: new Date('2026-11-10T11:57:00Z') }),
    row('broken', { eventTime: new Date('2026-11-10T11:59:30Z') }),
    row('done', { status: 'succeeded' }),
    row('future', { nextAttemptAt: new Date('2026-11-10T13:00:00Z') }),
  ]);
  const order: string[] = [];
  const result = await dispatchWebhookInboxToConvex({
    repository,
    now,
    send: async (_owner, event) => {
      if (event.event === 'broken') throw new Error('unreachable');
      order.push(event.event);
    },
  });
  assert.deepEqual(order, ['first', 'later']);
  assert.deepEqual(result, {
    candidates: 3,
    sent: 2,
    deferred: 1,
    lostRace: 0,
  });
  assert.equal(byId.get('future')?.status, 'pending');
});

void test('only activity events with a known aspect are passed on', () => {
  const claim = (overrides: Partial<StravaWebhookEventRow>) => ({
    event: row('e1', overrides),
    userId: 'user-a',
  });
  assert.equal(convexEventFor(claim({ objectType: 'athlete' })), null);
  assert.equal(convexEventFor(claim({ aspectType: 'archive' })), null);
  assert.equal(
    convexEventFor(claim({ aspectType: 'delete' }))?.aspect,
    'delete',
  );
});
