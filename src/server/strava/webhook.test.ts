import assert from 'node:assert/strict';
import test from 'node:test';

import { activities, photos, syncChanges } from '~/server/db/schema';

import { processWebhookEvent, type ProcessWebhookEventDeps } from './webhook.ts';
import type { StravaWebhookEvent } from './webhook.ts';

type FakeCall = { method: string; via: 'outer' | 'tx' };

/**
 * A minimal stand-in for the drizzle `db`/`tx` handle, deep enough to
 * exercise `processWebhookEvent`'s call shape - same pattern as
 * `~/server/repositories/activities.test.ts`. It records which handle
 * (`outer` vs `tx`, i.e. inside `database.transaction(...)`) each write went
 * through and, for inserts into `syncChanges`, the rows themselves - the two
 * things this suite is proving: every write for one webhook delivery
 * (activity upsert/delete, photo tombstones/inserts, and the change-feed
 * record) happens inside one transaction, and it produces exactly the
 * change rows the delivery should.
 */
function buildFakeDb(opts: {
  existingPhotos?: { photo_id: string; activity_id: number }[];
  failChangeInsert?: boolean;
}) {
  const calls: FakeCall[] = [];
  const recordedChanges: Record<string, unknown>[] = [];

  function makeHandle(via: FakeCall['via']) {
    return {
      select(_columns?: unknown) {
        return {
          from(table: unknown) {
            return {
              where: async () => {
                calls.push({ method: 'select', via });
                if (table === photos) {
                  // Both the not-found branch (`{ id }`) and the
                  // found/replace branch (`{ photo_id, activity_id }`)
                  // select from `photos` with different column aliases;
                  // returning both shapes lets either destructure what it
                  // needs.
                  return (opts.existingPhotos ?? []).map((p) => ({
                    id: p.photo_id,
                    photo_id: p.photo_id,
                    activity_id: p.activity_id,
                  }));
                }
                return [];
              },
            };
          },
        };
      },
      delete(table: unknown) {
        calls.push({ method: `delete:${table === activities ? 'activities' : 'photos'}`, via });
        return { where: async () => undefined };
      },
      insert(table: unknown) {
        if (table === syncChanges) {
          return {
            values(rows: Record<string, unknown>[]) {
              calls.push({ method: 'insertChange', via });
              return {
                returning: async () => {
                  if (opts.failChangeInsert) {
                    throw new Error('simulated change insert failure');
                  }
                  recordedChanges.push(...rows);
                  return rows;
                },
              };
            },
          };
        }
        if (table === activities) {
          calls.push({ method: 'insertActivity', via });
          return { values: () => ({ onConflictDoUpdate: async () => undefined }) };
        }
        if (table === photos) {
          calls.push({ method: 'insertPhotos', via });
          return { values: async () => undefined };
        }
        // activityDeletions / photoDeletions tombstones.
        calls.push({ method: 'insertTombstone', via });
        return { values: () => ({ onConflictDoUpdate: async () => undefined }) };
      },
    };
  }

  const outerHandle = makeHandle('outer');
  const fakeDb = {
    ...outerHandle,
    async transaction<T>(cb: (tx: ReturnType<typeof makeHandle>) => Promise<T>) {
      return cb(makeHandle('tx'));
    },
  };

  return { db: fakeDb, calls, recordedChanges };
}

const baseEvent: StravaWebhookEvent = {
  object_type: 'activity',
  object_id: 100,
  aspect_type: 'update',
  owner_id: 42,
  subscription_id: 1,
  event_time: 1_700_000_000,
};

function deps(overrides: Partial<ProcessWebhookEventDeps> = {}): ProcessWebhookEventDeps {
  return {
    resolveAccount: async () => ({ access_token: 'token' }) as never,
    ...overrides,
  };
}

void test('processWebhookEvent upserts the activity and records one change entry per mutated entity inside one transaction', async () => {
  const { db, calls, recordedChanges } = buildFakeDb({
    existingPhotos: [{ photo_id: 'old-photo', activity_id: 100 }],
  });

  await processWebhookEvent(
    baseEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    deps({
      fetchActivities: async () => ({
        activities: [{ id: 100, athlete: 42 } as never],
        photos: [{ unique_id: 'new-photo' } as never],
        notFoundIds: [],
      }),
    }),
  );

  // Every write for this delivery went through `tx`, not `outer`.
  assert.ok(calls.every((call) => call.via === 'tx'));
  assert.deepEqual(
    calls.map((c) => c.method),
    ['insertActivity', 'select', 'delete:photos', 'insertPhotos', 'insertTombstone', 'insertChange'],
  );

  assert.deepEqual(recordedChanges, [
    { athleteId: 42, entityType: 'activity', entityId: '100', operation: 'upsert' },
    { athleteId: 42, entityType: 'photo', entityId: 'old-photo', operation: 'delete' },
    { athleteId: 42, entityType: 'photo', entityId: 'new-photo', operation: 'upsert' },
  ]);
});

void test('processWebhookEvent records a delete change entry (and cascaded photo deletes) for a not-found activity', async () => {
  const { db, calls, recordedChanges } = buildFakeDb({
    existingPhotos: [{ photo_id: 'cascaded-photo', activity_id: 100 }],
  });

  await processWebhookEvent(
    baseEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    deps({
      fetchActivities: async () => ({
        activities: [],
        photos: [],
        notFoundIds: [100],
      }),
    }),
  );

  assert.ok(calls.every((call) => call.via === 'tx'));
  assert.deepEqual(recordedChanges, [
    { athleteId: 42, entityType: 'activity', entityId: '100', operation: 'delete' },
    { athleteId: 42, entityType: 'photo', entityId: 'cascaded-photo', operation: 'delete' },
  ]);
});

void test('a failed change-record insert rejects the whole delivery instead of committing a mutation with no change entry', async () => {
  const { db } = buildFakeDb({ failChangeInsert: true });

  await assert.rejects(
    () =>
      processWebhookEvent(
        baseEvent,
        db as unknown as Parameters<typeof processWebhookEvent>[1],
        deps({
          fetchActivities: async () => ({
            activities: [{ id: 100, athlete: 42 } as never],
            photos: [],
            notFoundIds: [],
          }),
        }),
      ),
    /simulated change insert failure/,
  );
});

void test('replaying the same webhook delivery (idempotent retry) upserts the activity and records a change entry again', async () => {
  // A retried/duplicate delivery for the same activity must still be safe
  // to process - this proves `processWebhookEvent` does not throw or skip
  // recording on a second run with the same input (the plan doc's "replay
  // is harmless" property, applied to the write path rather than a cursor).
  const { db, recordedChanges } = buildFakeDb({});
  const fetchActivities = async () => ({
    activities: [{ id: 100, athlete: 42 } as never],
    photos: [],
    notFoundIds: [],
  });

  await processWebhookEvent(
    baseEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    deps({ fetchActivities }),
  );
  await processWebhookEvent(
    baseEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    deps({ fetchActivities }),
  );

  assert.deepEqual(recordedChanges, [
    { athleteId: 42, entityType: 'activity', entityId: '100', operation: 'upsert' },
    { athleteId: 42, entityType: 'activity', entityId: '100', operation: 'upsert' },
  ]);
});
