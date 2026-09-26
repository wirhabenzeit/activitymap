import assert from 'node:assert/strict';
import test from 'node:test';

import { accounts, activities, photos, syncChanges } from '~/server/db/schema';

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
      execute: async () => undefined,
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
        photoRefreshAuthoritativeIds: [100],
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

void test('processWebhookEvent preserves existing photos when the photo result is non-authoritative', async () => {
  const { db, calls, recordedChanges } = buildFakeDb({
    existingPhotos: [{ photo_id: 'old-photo', activity_id: 100 }],
  });

  await processWebhookEvent(
    baseEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    deps({
      fetchActivities: async () => ({
        activities: [{ id: 100, athlete: 42 } as never],
        photos: [],
        notFoundIds: [],
        photoRefreshFailedIds: [100],
      }),
    }),
  );

  assert.deepEqual(
    calls.map((call) => call.method),
    ['insertActivity', 'insertChange'],
  );
  assert.deepEqual(recordedChanges, [
    {
      athleteId: 42,
      entityType: 'activity',
      entityId: '100',
      operation: 'upsert',
    },
  ]);
});

void test('processWebhookEvent preserves existing photos when a skipped fetch has no authoritative count', async () => {
  const { db, calls, recordedChanges } = buildFakeDb({
    existingPhotos: [{ photo_id: 'old-photo', activity_id: 100 }],
  });

  await processWebhookEvent(
    baseEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    deps({
      fetchActivities: async () => ({
        activities: [{ id: 100, athlete: 42 } as never],
        photos: [],
        notFoundIds: [],
        photoRefreshAuthoritativeIds: [],
      }),
    }),
  );

  assert.deepEqual(
    calls.map((call) => call.method),
    ['insertActivity', 'insertChange'],
  );
  assert.deepEqual(recordedChanges, [
    {
      athleteId: 42,
      entityType: 'activity',
      entityId: '100',
      operation: 'upsert',
    },
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
            photoRefreshAuthoritativeIds: [100],
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
    photoRefreshAuthoritativeIds: [100],
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

// --- Athlete deauthorization (issue #125) ---

type FakeAccountRow = {
  id: string;
  accountId: string;
  providerId: string;
  access_token: string | null;
  accessToken: string | null;
  refresh_token: string | null;
  refreshToken: string | null;
  revokedAt: Date | null;
  scheduledErasureAt: Date | null;
  updatedAt: Date;
};

type AccountUpdateCall = { via: 'outer' | 'tx'; values: Partial<FakeAccountRow> };

/**
 * A minimal stand-in for the drizzle `db`/`tx` handle, deep enough to
 * exercise `handleAthleteDeauthorization`'s call shape against the
 * `account` table - same spirit as `buildFakeDb` above, but for the one
 * table that path touches. Ignores `where` conditions (same limitation as
 * the other fakes in this file/`activities.test.ts`) and just returns the
 * single seeded account row, if any.
 */
function buildFakeAccountsDb(initialAccount: FakeAccountRow | null) {
  let account = initialAccount ? { ...initialAccount } : null;
  const updateCalls: AccountUpdateCall[] = [];

  function makeHandle(via: 'outer' | 'tx') {
    return {
      execute: async () => undefined,
      select(_columns?: unknown) {
        return {
          from(table: unknown) {
            return {
              where: async () => {
                if (table !== accounts) return [];
                return account ? [account] : [];
              },
            };
          },
        };
      },
      update(table: unknown) {
        if (table !== accounts) throw new Error('unexpected update target in this fake');
        return {
          set(values: Partial<FakeAccountRow>) {
            return {
              where: async () => {
                updateCalls.push({ via, values });
                if (account) account = { ...account, ...values };
              },
            };
          },
        };
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

  return { db: fakeDb, updateCalls, getAccount: () => account };
}

const deauthorizationEvent: StravaWebhookEvent = {
  object_type: 'athlete',
  object_id: 42,
  aspect_type: 'update',
  owner_id: 42,
  subscription_id: 1,
  event_time: 1_700_000_000,
};

/** Fails the test if either Strava-calling dependency is ever invoked. */
function neverCallStravaDeps(): ProcessWebhookEventDeps {
  return {
    resolveAccount: async () => {
      throw new Error('resolveAccount must not be called while handling deauthorization');
    },
    fetchActivities: async () => {
      throw new Error('fetchActivities must not be called while handling deauthorization');
    },
  };
}

function freshAccount(overrides: Partial<FakeAccountRow> = {}): FakeAccountRow {
  return {
    id: 'account-1',
    accountId: '42',
    providerId: 'strava',
    access_token: 'legacy-token',
    accessToken: 'better-auth-token',
    refresh_token: 'legacy-refresh',
    refreshToken: 'better-auth-refresh',
    revokedAt: null,
    scheduledErasureAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

void test('processWebhookEvent handles athlete deauthorization: stops using the token, marks the account revoked, and schedules 30-day erasure - transactionally, without any Strava call', async () => {
  const { db, updateCalls, getAccount } = buildFakeAccountsDb(freshAccount());

  await processWebhookEvent(
    deauthorizationEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    neverCallStravaDeps(),
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.via, 'tx');

  const account = getAccount();
  assert.ok(account);
  assert.equal(account.access_token, null);
  assert.equal(account.accessToken, null);
  assert.equal(account.refresh_token, null);
  assert.equal(account.refreshToken, null);
  assert.ok(account.revokedAt instanceof Date);

  // 30-day erasure deadline, per docs/strava-data-policy.md §1/§3.
  assert.ok(account.scheduledErasureAt instanceof Date);
  const scheduledDays =
    (account.scheduledErasureAt.getTime() - account.revokedAt.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(scheduledDays, 30);
});

void test('processWebhookEvent deauthorization is idempotent: replaying it for an already-revoked account is a safe no-op that never re-extends the erasure deadline', async () => {
  const originalRevokedAt = new Date('2026-01-01T00:00:00.000Z');
  const originalErasureAt = new Date('2026-01-31T00:00:00.000Z');
  const { db, updateCalls, getAccount } = buildFakeAccountsDb(
    freshAccount({
      access_token: null,
      accessToken: null,
      refresh_token: null,
      refreshToken: null,
      revokedAt: originalRevokedAt,
      scheduledErasureAt: originalErasureAt,
    }),
  );

  await processWebhookEvent(
    deauthorizationEvent,
    db as unknown as Parameters<typeof processWebhookEvent>[1],
    neverCallStravaDeps(),
  );

  // No write at all on replay - not even a no-op update - and the
  // original deadline is untouched.
  assert.equal(updateCalls.length, 0);
  const account = getAccount();
  assert.equal(account?.revokedAt?.getTime(), originalRevokedAt.getTime());
  assert.equal(account?.scheduledErasureAt?.getTime(), originalErasureAt.getTime());
});

void test('processWebhookEvent deauthorization for an unknown/unlinked account is a safe no-op', async () => {
  const { db, updateCalls } = buildFakeAccountsDb(null);

  await assert.doesNotReject(() =>
    processWebhookEvent(
      deauthorizationEvent,
      db as unknown as Parameters<typeof processWebhookEvent>[1],
      neverCallStravaDeps(),
    ),
  );

  assert.equal(updateCalls.length, 0);
});
