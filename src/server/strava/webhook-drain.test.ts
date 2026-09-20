import assert from 'node:assert/strict';
import test from 'node:test';

import type { StravaWebhookEventRow } from '~/server/db/schema';
import type {
  DrainCandidate,
  WebhookEventsRepository,
  WebhookInboxBacklogMetrics,
} from '~/server/repositories/webhook-events';
import { computeRetryDecision, classifyWebhookError } from '~/server/strava/webhook-retry';

import {
  drainWebhookInbox,
  reconcileStuckWebhookEvents,
} from './webhook-drain.ts';
import type { StravaWebhookEvent } from './webhook.ts';

/**
 * An in-memory fake of `WebhookEventsRepository`, in the same spirit as
 * `~/server/auth/mobile.test.ts`'s fake `MobileLoginCodesRepository`: this
 * sandbox has no live Postgres, so the claim/retry/priority/reconciliation
 * behavior below is proven against a fake that implements the same
 * atomic-claim contract the real Drizzle repository does (see that
 * repository's `claim` doc comment), not against a real database. Because
 * this fake's `claim` has no `await` before its check-then-mutate, two
 * "concurrent" claims for the same row resolve deterministically with
 * exactly one winner, the same property a real row lock provides.
 */
function createFakeRepository(rows: StravaWebhookEventRow[]): WebhookEventsRepository {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));

  return {
    async selectDrainCandidates(limit, now) {
      const candidates: DrainCandidate[] = [...byId.values()]
        .filter((row) => (row.status === 'pending' || row.status === 'failed') && row.nextAttemptAt <= now)
        .map((row) => ({
          id: row.id,
          objectType: row.objectType,
          aspectType: row.aspectType,
          nextAttemptAt: row.nextAttemptAt,
        }));
      return candidates.slice(0, limit);
    },

    async claim(id, now) {
      const row = byId.get(id);
      if (!row) return null;
      if (row.status !== 'pending' && row.status !== 'failed') return null;
      if (row.nextAttemptAt > now) return null;
      const claimed = { ...row, status: 'processing' as const, updatedAt: now };
      byId.set(id, claimed);
      return { ...claimed };
    },

    async complete(lease, now) {
      const row = byId.get(lease.id);
      if (
        row?.status !== 'processing' ||
        row.updatedAt.getTime() !== lease.updatedAt.getTime()
      ) {
        return false;
      }
      byId.set(lease.id, {
        ...row,
        status: 'succeeded',
        attemptCount: row.attemptCount + 1,
        lastError: null,
        updatedAt: now,
      });
      return true;
    },

    async fail(lease, error, now) {
      const row = byId.get(lease.id);
      if (
        row?.status !== 'processing' ||
        row.updatedAt.getTime() !== lease.updatedAt.getTime()
      ) {
        return null;
      }
      const classification = classifyWebhookError(error);
      const decision = computeRetryDecision({ attemptCount: lease.attemptCount, classification, now });
      byId.set(lease.id, {
        ...row,
        status: decision.status,
        attemptCount: decision.attemptCount,
        nextAttemptAt: decision.nextAttemptAt,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: now,
      });
      return decision;
    },

    async resetStaleProcessing(cutoff, now) {
      let count = 0;
      for (const row of byId.values()) {
        if (row.status === 'processing' && row.updatedAt < cutoff) {
          const classification = classifyWebhookError(new Error('stuck'));
          const decision = computeRetryDecision({ attemptCount: row.attemptCount, classification, now });
          byId.set(row.id, {
            ...row,
            status: decision.status,
            attemptCount: decision.attemptCount,
            nextAttemptAt: decision.nextAttemptAt,
            lastError: 'Stuck in "processing" past the stale-lock timeout',
            updatedAt: now,
          });
          count++;
        }
      }
      return count;
    },

    async listByStatus(status) {
      return [...byId.values()].filter((row) => row.status === status);
    },

    async backlogMetrics(): Promise<WebhookInboxBacklogMetrics> {
      const countsByStatus: Record<string, number> = {};
      let oldestPendingEventTime: Date | null = null;
      for (const row of byId.values()) {
        countsByStatus[row.status] = (countsByStatus[row.status] ?? 0) + 1;
        if (row.status === 'pending' || row.status === 'failed') {
          if (!oldestPendingEventTime || row.eventTime < oldestPendingEventTime) {
            oldestPendingEventTime = row.eventTime;
          }
        }
      }
      return { countsByStatus, oldestPendingEventTime };
    },
  };
}

let nextRowId = 1;
function makeRow(overrides: Partial<StravaWebhookEventRow> = {}): StravaWebhookEventRow {
  const id = overrides.id ?? `event-${nextRowId++}`;
  const objectType = overrides.objectType ?? 'activity';
  const aspectType = overrides.aspectType ?? 'update';
  const objectId = overrides.objectId ?? 100;
  const ownerId = overrides.ownerId ?? 42;
  return {
    id,
    subscriptionId: 1,
    objectType,
    objectId,
    aspectType,
    ownerId,
    eventTime: new Date('2026-01-01T00:00:00.000Z'),
    payload: {
      object_type: objectType,
      object_id: objectId,
      aspect_type: aspectType,
      owner_id: ownerId,
      subscription_id: 1,
      event_time: 1_800_000_000,
    } as StravaWebhookEvent,
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

void test('drainWebhookInbox processes a due row successfully and marks it complete', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const row = makeRow({ id: 'ok-1' });
  const repository = createFakeRepository([row]);
  const processed: string[] = [];

  const result = await drainWebhookInbox({
    repository,
    now,
    processEvent: async (payload) => {
      processed.push(String(payload.object_id));
    },
  });

  assert.deepEqual(processed, ['100']);
  assert.equal(result.succeeded, 1);
  assert.equal(result.retrying, 0);
  assert.equal(result.deadLettered, 0);
  assert.equal((await repository.listByStatus('succeeded')).length, 1);
});

void test('a transient failure is retried with backoff and attempt increment, and the mutation is not re-run twice for that attempt', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const row = makeRow({ id: 'retry-1', attemptCount: 0 });
  const repository = createFakeRepository([row]);
  let callCount = 0;

  const result = await drainWebhookInbox({
    repository,
    now,
    processEvent: async () => {
      callCount++;
      throw new Error('ECONNRESET: transient network blip');
    },
  });

  // `processEvent` (standing in for `processWebhookEvent`'s mutation) ran
  // exactly once for this one drain attempt - a retry only happens on a
  // later cycle once `nextAttemptAt` is due again, never twice within the
  // same attempt.
  assert.equal(callCount, 1);
  assert.equal(result.retrying, 1);
  assert.equal(result.deadLettered, 0);

  const [failedRow] = await repository.listByStatus('failed');
  assert.ok(failedRow);
  assert.equal(failedRow.attemptCount, 1);
  assert.ok(failedRow.nextAttemptAt.getTime() > now.getTime());
  assert.match(failedRow.lastError ?? '', /ECONNRESET/);

  // Not due yet - a drain cycle running again immediately must not pick
  // it back up before its backoff elapses.
  const candidatesRightNow = await repository.selectDrainCandidates(10, now);
  assert.equal(candidatesRightNow.length, 0);
});

void test('a permanently-failing row reaches dead_letter after the max-attempt threshold and then stays out of the drain query', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const row = makeRow({ id: 'always-fails' });
  const repository = createFakeRepository([row]);

  // Run enough cycles to exhaust the retry budget. Each cycle's row is
  // "due" immediately since we pass the same fixed `now` and never
  // advance past its (irrelevant, in-the-past-relative-to-`now`) backoff -
  // this test only cares about `attemptCount`/status progression, not
  // real wall-clock spacing (covered separately by the retry test above
  // and by `webhook-retry.test.ts`'s backoff math).
  let lastResult;
  for (let i = 0; i < 10; i++) {
    // Force the row to be due for this cycle regardless of its backed-off
    // `nextAttemptAt`, by draining with a `now` far in the future each
    // time - simulating "many cycles later".
    const cycleNow = new Date(now.getTime() + i * 3 * 60 * 60 * 1000);
    lastResult = await drainWebhookInbox({
      repository,
      now: cycleNow,
      batchSize: 10,
      processEvent: async () => {
        throw new Error('permanently broken');
      },
    });
    const [deadLettered] = await repository.listByStatus('dead_letter');
    if (deadLettered) break;
  }

  const [deadLettered] = await repository.listByStatus('dead_letter');
  assert.ok(deadLettered, 'row should have reached dead_letter');
  assert.ok(deadLettered.attemptCount >= 10);
  assert.equal((await repository.listByStatus('failed')).length, 0);

  // Excluded from the drain query going forward, even with a far-future `now`.
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const candidates = await repository.selectDrainCandidates(10, farFuture);
  assert.equal(candidates.length, 0);

  // ...but still inspectable by status.
  assert.equal((await repository.listByStatus('dead_letter')).length, 1);
  void lastResult;
});

void test('drainWebhookInbox processes deletion and athlete-deauthorization events ahead of routine create/update events', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const older = new Date(now.getTime() - 60 * 60 * 1000);
  const rows = [
    makeRow({ id: 'routine-1', objectType: 'activity', aspectType: 'update', nextAttemptAt: older }),
    makeRow({ id: 'routine-2', objectType: 'activity', aspectType: 'create', nextAttemptAt: older }),
    makeRow({ id: 'deletion-1', objectType: 'activity', aspectType: 'delete', nextAttemptAt: now }),
    makeRow({ id: 'deauth-1', objectType: 'athlete', aspectType: 'update', nextAttemptAt: now }),
  ];
  const repository = createFakeRepository(rows);
  const processedOrder: string[] = [];

  // Concurrency 1 forces strictly serial dispatch, so the recorded order
  // is exactly the drain's priority order, not an artifact of parallel
  // scheduling.
  await drainWebhookInbox({
    repository,
    now,
    concurrency: 1,
    processEvent: async (payload) => {
      processedOrder.push(`${payload.object_type}:${payload.aspect_type}`);
    },
  });

  assert.deepEqual(processedOrder.slice(0, 2).sort(), ['activity:delete', 'athlete:update'].sort());
  assert.deepEqual(processedOrder.slice(2).sort(), ['activity:create', 'activity:update'].sort());
});

void test('concurrent drain cycles cannot both process the same row (atomic claim)', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const row = makeRow({ id: 'contended' });
  const repository = createFakeRepository([row]);
  let processedCount = 0;

  const [resultA, resultB] = await Promise.all([
    drainWebhookInbox({
      repository,
      now,
      processEvent: async () => {
        processedCount++;
      },
    }),
    drainWebhookInbox({
      repository,
      now,
      processEvent: async () => {
        processedCount++;
      },
    }),
  ]);

  // Exactly one of the two overlapping drain cycles won the claim and
  // actually ran the mutation; the other must record a lost race, not a
  // second successful processing of the same row.
  assert.equal(processedCount, 1);
  assert.equal(resultA.succeeded + resultB.succeeded, 1);
  assert.equal(resultA.lostRace + resultB.lostRace, 1);
});

void test('reconcileStuckWebhookEvents resets rows stuck in processing past the stale-lock timeout back to retryable', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const stuckSince = new Date(now.getTime() - 20 * 60 * 1000); // 20 minutes ago
  const row = makeRow({ id: 'stuck-1', status: 'processing', updatedAt: stuckSince, attemptCount: 1 });
  const repository = createFakeRepository([row]);

  const resetCount = await reconcileStuckWebhookEvents({
    repository,
    now,
    staleAfterMs: 10 * 60 * 1000, // 10 minutes
  });

  assert.equal(resetCount, 1);
  const [failedRow] = await repository.listByStatus('failed');
  assert.ok(failedRow);
  assert.equal(failedRow.attemptCount, 2);
  assert.ok(failedRow.nextAttemptAt.getTime() > now.getTime());
});

void test('reconcileStuckWebhookEvents leaves recently-updated processing rows alone', async () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const recentlyUpdated = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
  const row = makeRow({ id: 'in-flight', status: 'processing', updatedAt: recentlyUpdated });
  const repository = createFakeRepository([row]);

  const resetCount = await reconcileStuckWebhookEvents({
    repository,
    now,
    staleAfterMs: 10 * 60 * 1000,
  });

  assert.equal(resetCount, 0);
  assert.equal((await repository.listByStatus('processing')).length, 1);
});

void test('a worker that finishes after stale reconciliation cannot overwrite the released lease', async () => {
  const claimedAt = new Date('2026-01-01T01:00:00.000Z');
  const reconciledAt = new Date(claimedAt.getTime() + 20 * 60 * 1000);
  const repository = createFakeRepository([makeRow({ id: 'expired-lease' })]);
  let releaseWorker!: () => void;
  const workerPaused = new Promise<void>((resolve) => {
    releaseWorker = resolve;
  });
  let workerStarted!: () => void;
  const workerDidStart = new Promise<void>((resolve) => {
    workerStarted = resolve;
  });

  const drainPromise = drainWebhookInbox({
    repository,
    now: claimedAt,
    processEvent: async () => {
      workerStarted();
      await workerPaused;
    },
  });
  await workerDidStart;

  const resetCount = await reconcileStuckWebhookEvents({
    repository,
    now: reconciledAt,
    staleAfterMs: 10 * 60 * 1000,
  });
  assert.equal(resetCount, 1);

  releaseWorker();
  const result = await drainPromise;
  assert.equal(result.succeeded, 0);
  assert.equal(result.lostLease, 1);
  assert.equal((await repository.listByStatus('failed')).length, 1);
  assert.equal((await repository.listByStatus('succeeded')).length, 0);
});
