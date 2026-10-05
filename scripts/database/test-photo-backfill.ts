import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import {
  activities,
  accounts,
  users,
  photos,
  photoFetchAttempts,
  photoBackfillRuns,
  photoDeletions,
  syncChanges,
} from '../../src/server/db/schema';
import {
  createPhotoBackfillRepository,
  PHOTO_REQUEST_LIMIT,
  PhotoBackfillStopped,
} from '../../src/server/repositories/photo-backfill';
import { createIngestionStatusRepository } from '../../src/server/repositories/ingestion-status';
import { fetchStravaActivities } from '../../src/server/strava/service';
import { StravaApiError } from '../../src/server/strava/client';
import type { StravaActivity } from '../../src/server/strava/types';
import { deriveIngestionStatus } from '../../src/server/application/ingestion-status';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error('Photo proof requires a guarded local *_test database');
const client = postgres(target.connectionString, {
  max: 4,
  prepare: false,
  onnotice: () => undefined,
});
const database = drizzle(client);
const db = database as unknown as Parameters<
  typeof createPhotoBackfillRepository
>[0];
let now = new Date('2026-10-05T12:00:00Z');
const clock = () => new Date(now);
const repo = createPhotoBackfillRepository(db, clock);
const athlete = 9393001;
const user = 'photo-proof-user';
const revoked = 'photo-proof-revoked';
const id = (n: number) => athlete * 1000 + n;
const photo = (n: number) => ({
  unique_id: `photo-proof-${n}`,
  activity_id: id(n),
  athlete_id: athlete,
  type: 1,
  urls: { '256': `https://example.test/photo-${n}` },
  caption: 'Original caption',
  activity_name: null,
  source: null,
  sizes: null,
  default_photo: null,
  location: null,
  uploaded_at: null,
  created_at: null,
  post_id: null,
  status: null,
  resource_state: null,
});
async function cleanup() {
  await database.delete(users).where(inArray(users.id, [user, revoked]));
  await database
    .delete(photoBackfillRuns)
    .where(eq(photoBackfillRuns.key, 'photos'));
  await database.delete(syncChanges).where(eq(syncChanges.athleteId, athlete));
}
async function seed() {
  await cleanup();
  await database.insert(users).values([
    { id: user, athlete_id: athlete },
    { id: revoked, athlete_id: athlete + 1 },
  ]);
  await database.insert(accounts).values([
    {
      id: 'photo-proof-account',
      userId: user,
      providerId: 'strava',
      accountId: String(athlete),
      accessToken: 'proof-access',
      accessTokenExpiresAt: new Date('2030-01-01'),
    },
    {
      id: 'photo-proof-revoked-account',
      userId: revoked,
      providerId: 'strava',
      accountId: String(athlete + 1),
      accessToken: 'proof-revoked',
      revokedAt: now,
    },
  ]);
  await database.insert(activities).values(
    [1, 2, 3, 4, 5, 6].map((n) => ({
      id: id(n),
      public_id: id(n) + 500000000,
      athlete: n === 6 ? athlete + 1 : athlete,
      name: `Photo proof ${n}`,
      sport_type: 'Run' as const,
      start_date: new Date('2020-01-01'),
      start_date_local: new Date('2020-01-01'),
      timezone: 'Europe/Zurich',
      geometryState: 'detailed' as const,
      is_complete: true,
      photosState:
        n === 1
          ? null
          : n === 4
            ? ('current' as const)
            : ('refresh_required' as const),
      total_photo_count: n === 5 ? 0 : 1,
      photo_count: 0,
      last_updated: new Date('2026-09-01'),
    })),
  );
  await database
    .insert(photos)
    .values([photo(1), photo(2), photo(4), photo(5)]);
}
async function begin() {
  const token = await repo.start();
  assert.ok(token);
  return token;
}
async function next(token: string) {
  const claim = await repo.claimNext(token);
  assert.ok(claim);
  return claim;
}
try {
  await verifyConnectedTarget(client, target);
  await seed();
  // Exercise the additive migration with real legacy rows already present.
  // Only this guarded disposable database may reconstruct its pre-0018 tables.
  await database.transaction(async (tx) => {
    const beforePhotos = await tx
      .select()
      .from(photos)
      .orderBy(photos.unique_id);
    const beforeActivities = await tx
      .select()
      .from(activities)
      .orderBy(activities.id);
    await tx.execute(
      sql.raw('DROP TABLE photo_fetch_attempt, photo_backfill_run'),
    );
    for (const statement of readFileSync(
      'drizzle/0018_photo-catch-up.sql',
      'utf8',
    ).split('--> statement-breakpoint')) {
      if (statement.trim()) await tx.execute(sql.raw(statement));
    }
    assert.deepEqual(
      await tx.select().from(photos).orderBy(photos.unique_id),
      beforePhotos,
    );
    assert.deepEqual(
      await tx.select().from(activities).orderBy(activities.id),
      beforeActivities,
    );
  });
  const before = await createIngestionStatusRepository(db).snapshot(
    user,
    athlete,
    now,
  );
  assert.equal(before.photos.activitiesWithPhotos, 4);
  assert.equal(before.photos.activitiesWithStoredPhotos, 3);
  assert.equal(
    before.photos.pendingRefreshes,
    4,
    'includes zero-count removals, but excludes current and revoked accounts from worker selection',
  );
  assert.equal(
    before.photos.unknown,
    1,
    'legacy rows are not dishonestly marked current',
  );
  const token = await begin();
  assert.equal(await repo.start(), null, 'overlapping run cannot claim');
  const missing = await next(token);
  assert.equal(missing.activityId, id(3), 'missing photos before verification');
  await repo.release(missing, 'upstream_error');
  const [attempt] = await database
    .select()
    .from(photoFetchAttempts)
    .where(eq(photoFetchAttempts.activityId, id(3)));
  assert.equal(
    attempt?.nextAttemptAt.toISOString(),
    '2026-10-05T13:00:00.000Z',
  );
  const legacy = await next(token);
  assert.equal(
    legacy.activityId,
    id(1),
    'failed activity does not starve legacy work',
  );
  const replacement = {
    ...photo(1),
    caption: 'Updated caption',
    urls: { '256': 'https://example.test/new' },
  };
  await assert.rejects(() => repo.complete(legacy, [replacement, replacement]));
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.unique_id, photo(1).unique_id))
    )[0]?.caption,
    'Original caption',
    'failed persistence rolls back the replacement',
  );
  assert.equal(
    (
      await database
        .select()
        .from(activities)
        .where(eq(activities.id, id(1)))
    )[0]?.photosState,
    null,
    'failed persistence cannot mark legacy photos verified',
  );
  assert.equal(await repo.complete(legacy, [replacement]), true);
  const [stored] = await database
    .select()
    .from(photos)
    .where(eq(photos.unique_id, photo(1).unique_id));
  assert.equal(stored?.caption, 'Updated caption');
  const [verified] = await database
    .select()
    .from(activities)
    .where(eq(activities.id, id(1)));
  assert.equal(verified?.photosState, 'current');
  assert.equal(verified?.geometryState, 'detailed');
  const remove = await next(token);
  assert.equal(remove.activityId, id(2));
  assert.equal(await repo.complete(remove, []), true);
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.activity_id, id(2)))
    ).length,
    0,
  );
  assert.equal(
    (
      await database
        .select()
        .from(photoDeletions)
        .where(eq(photoDeletions.photo_id, photo(2).unique_id))
    ).length,
    1,
  );
  const changes = await database
    .select()
    .from(syncChanges)
    .where(eq(syncChanges.athleteId, athlete));
  assert.ok(
    changes.some(
      (row) =>
        row.entityType === 'photo' &&
        row.entityId === photo(2).unique_id &&
        row.operation === 'delete',
    ),
  );
  assert.ok(
    changes.some(
      (row) =>
        row.entityType === 'photo' &&
        row.entityId === photo(1).unique_id &&
        row.operation === 'upsert',
    ),
  );
  const stale = await next(token);
  assert.equal(
    stale.activityId,
    id(5),
    'zero-count photo removals are eligible',
  );
  await database
    .update(activities)
    .set({ last_updated: now, total_photo_count: 2 })
    .where(eq(activities.id, id(5)));
  assert.equal(
    await repo.complete(stale, []),
    false,
    'newer activity update wins',
  );
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.activity_id, id(5)))
    ).length,
    1,
    'stale response preserves stored data',
  );
  await repo.release(stale, null);
  const newer = await next(token);
  assert.notEqual(newer.token, stale.token);
  await repo.release(stale, 'upstream_error');
  assert.equal(
    await repo.isCurrent(newer),
    true,
    'old response cannot release a newer lease',
  );
  await repo.release(newer, null);
  await assert.rejects(
    () => repo.claimNext(token),
    (error) =>
      error instanceof PhotoBackfillStopped &&
      error.reason === 'activity_limit',
  );
  for (let i = 0; i < PHOTO_REQUEST_LIMIT; i++)
    await repo.reserveRequest(token);
  await assert.rejects(
    () => repo.reserveRequest(token),
    (error) =>
      error instanceof PhotoBackfillStopped && error.reason === 'request_limit',
  );
  await repo.finish(token);
  const repeated = await begin();
  await assert.rejects(
    () => repo.claimNext(repeated),
    (error) =>
      error instanceof PhotoBackfillStopped &&
      error.reason === 'activity_limit',
  );
  await repo.finish(repeated);

  await seed();
  const refreshRun = await begin();
  const originalGrant = await next(refreshRun);
  const refreshed = await repo.replaceCredentials(originalGrant, {
    access_token: 'rotated-proof',
    refresh_token: 'rotated-refresh',
    expires_at: 1893456000,
    expires_in: 3600,
  });
  assert.ok(refreshed);
  assert.equal(
    await repo.isCurrent(originalGrant),
    false,
    'old credentials cannot publish',
  );
  assert.equal(
    await repo.isCurrent(refreshed),
    true,
    'authorized token refresh carries the claim forward',
  );
  assert.equal(await repo.complete(refreshed, []), true);
  await repo.finish(refreshRun);

  // A claim cannot publish after account revocation or activity deletion.
  await seed();
  now = new Date('2026-10-05T14:00:00Z');
  const revokedRun = await begin();
  const revokedClaim = await next(revokedRun);
  await database
    .update(accounts)
    .set({ revokedAt: now })
    .where(eq(accounts.id, 'photo-proof-account'));
  assert.equal(await repo.isCurrent(revokedClaim), false);
  assert.equal(await repo.complete(revokedClaim, []), false);
  await repo.finish(revokedRun);
  await seed();
  now = new Date('2026-10-05T15:00:00Z');
  const deletedRun = await begin();
  const deleted = await next(deletedRun);
  await database
    .delete(activities)
    .where(eq(activities.id, deleted.activityId));
  assert.equal(await repo.complete(deleted, []), false);
  assert.equal(
    (
      await database
        .select()
        .from(photoFetchAttempts)
        .where(eq(photoFetchAttempts.activityId, deleted.activityId))
    ).length,
    0,
  );
  await repo.finish(deletedRun);

  await seed();
  now = new Date('2026-10-05T16:00:00Z');
  const expiredRun = await begin();
  const expired = await next(expiredRun);
  now = new Date(now.getTime() + 91_000);
  assert.equal(
    await repo.complete(expired, []),
    false,
    'expired leases cannot publish',
  );
  const recoveredRun = await begin();
  const recovered = await next(recoveredRun);
  assert.equal(
    recovered.activityId,
    expired.activityId,
    'crashed attempts are reclaimable',
  );
  await repo.release(recovered, 'upstream_error');
  await repo.finish(recoveredRun);
  const snapshot = await createIngestionStatusRepository(db).snapshot(
    user,
    athlete,
    now,
  );
  assert.equal(snapshot.photos.retryWaiting, 1);
  assert.equal(
    deriveIngestionStatus(snapshot, {
      streamBackfillEnabled: false,
      photoBackfillEnabled: false,
    }).photos.scheduling,
    'disabled',
  );
  // Detail fetching must update photos even when legacy callers pass false,
  // preserve them on failure, and clear them after an authoritative zero.
  await seed();
  let failPhotos = false;
  let photoCount = 1;
  const fetchDetails = () =>
    fetchStravaActivities(
      {
        accessToken: 'proof',
        athleteId: athlete,
        activityIds: [id(4)],
        includePhotos: false,
        requireExisting: true,
      },
      {
        database: db,
        createClient: () => ({
          getActivity: async () =>
            ({
              id: id(4),
              athlete: { id: athlete },
              name: 'Refreshed detail',
              sport_type: 'Run',
              start_date: '2020-01-01T00:00:00Z',
              start_date_local: '2020-01-01T00:00:00Z',
              timezone: 'Europe/Zurich',
              map: { id: 'm', polyline: null, summary_polyline: null },
              total_photo_count: photoCount,
              photo_count: 0,
            }) as StravaActivity,
          getActivities: async () => [],
          getActivityPhotos: async () => {
            if (failPhotos) throw new StravaApiError('unavailable', 503);
            return photoCount
              ? [
                  {
                    ...photo(4),
                    caption: 'Changed without a count change',
                  } as never,
                ]
              : [];
          },
        }),
      },
    );
  await fetchDetails();
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.activity_id, id(4)))
    )[0]?.caption,
    'Changed without a count change',
  );
  await fetchStravaActivities(
    { accessToken: 'proof', athleteId: athlete, persist: true },
    {
      database: db,
      createClient: () => ({
        getActivity: async () => {
          throw new Error('summary must not fetch details');
        },
        getActivityPhotos: async () => {
          throw new Error('summary must queue photos');
        },
        getActivities: async () => [
          {
            id: id(4),
            athlete: { id: athlete },
            name: 'Summary with new photos',
            sport_type: 'Run',
            start_date: '2020-01-01T00:00:00Z',
            start_date_local: '2020-01-01T00:00:00Z',
            timezone: 'Europe/Zurich',
            map: { id: 'm', polyline: null, summary_polyline: null },
            total_photo_count: 2,
            photo_count: 0,
          } as StravaActivity,
        ],
      }),
    },
  );
  assert.equal(
    (
      await database
        .select()
        .from(activities)
        .where(eq(activities.id, id(4)))
    )[0]?.photosState,
    'refresh_required',
    'summary count changes queue photos independently',
  );
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.activity_id, id(4)))
    ).length,
    1,
    'summary does not discard existing photos',
  );
  await fetchDetails();
  failPhotos = true;
  await fetchDetails();
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.activity_id, id(4)))
    )[0]?.caption,
    'Changed without a count change',
    'failed request preserves metadata',
  );
  assert.equal(
    (
      await database
        .select()
        .from(activities)
        .where(eq(activities.id, id(4)))
    )[0]?.photosState,
    'refresh_required',
    'old current flag must not hide a failed refresh',
  );
  failPhotos = false;
  photoCount = 0;
  await fetchDetails();
  assert.equal(
    (
      await database
        .select()
        .from(photos)
        .where(eq(photos.activity_id, id(4)))
    ).length,
    0,
  );
  assert.equal(
    (
      await database
        .select()
        .from(activities)
        .where(eq(activities.id, id(4)))
    )[0]?.photosState,
    'current',
  );

  // A 401 blocks the grant across hourly runs, without blaming an activity.
  await seed();
  now = new Date('2026-10-07T12:00:00Z');
  const rejectedRun = await begin();
  const rejectedClaim = await next(rejectedRun);
  await repo.blockAccount(rejectedClaim, 'unauthorized');
  await repo.release(rejectedClaim, null);
  await repo.finish(rejectedRun);
  now = new Date('2026-10-07T13:00:00Z');
  const laterRun = await begin();
  assert.equal(
    await repo.claimNext(laterRun),
    null,
    'unchanged rejected grant stays blocked on later runs',
  );
  const blockedSnapshot = await createIngestionStatusRepository(db).snapshot(
    user,
    athlete,
    now,
  );
  const blockedStatus = deriveIngestionStatus(blockedSnapshot, {
    streamBackfillEnabled: false,
    photoBackfillEnabled: true,
  });
  assert.equal(blockedStatus.photos.scheduling, 'blocked');
  assert.equal(blockedStatus.photos.schedulingReason, 'unauthorized');
  assert.equal(
    blockedSnapshot.photos.retryWaiting,
    0,
    'account failure does not create an activity cooldown',
  );
  assert.equal(
    blockedSnapshot.photos.photoCount,
    4,
    'rejected grant preserves all stored photos',
  );
  await database
    .update(accounts)
    .set({ accessToken: 'reconnected-proof', updatedAt: now })
    .where(eq(accounts.id, rejectedClaim.accountId));
  const reconnected = await next(laterRun);
  assert.equal(reconnected.activityId, rejectedClaim.activityId);
  assert.equal(
    reconnected.attemptCount,
    1,
    'rejected credentials did not consume an activity failure attempt',
  );
  await repo.blockAccount(rejectedClaim, 'unauthorized');
  const reconnectedSnapshot = await createIngestionStatusRepository(
    db,
  ).snapshot(user, athlete, now);
  assert.equal(
    reconnectedSnapshot.account.photoCredentialsBlocked,
    null,
    'late failures cannot block the new grant',
  );
  assert.equal(await repo.complete(reconnected, []), true);
  await repo.finish(laterRun);

  console.log(
    'Photo catch-up proof passed: legacy availability, missing-first selection, retries, replacements/removals and change feed, stale/deleted/revoked guards, lease recovery, durable hourly limits, status.',
  );
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
