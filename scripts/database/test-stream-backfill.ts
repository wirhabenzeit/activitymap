import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  resolveMigrationTarget,
  verifyConnectedTarget,
} from '../../src/server/db/migration-tooling';
import {
  accounts,
  activities,
  activityStreams,
  users,
  stravaRequestBudgets,
  streamBackfillRuns,
  streamBackfillAccounts,
  streamBackfillAttempts,
} from '../../src/server/db/schema';
import { createActivityStreamsRepository } from '../../src/server/repositories/activity-streams';
import { createStreamBackfillRepository } from '../../src/server/repositories/stream-backfill';
import { createStravaRequestBudget } from '../../src/server/repositories/strava-budget';
import { backfillActivityStreams } from '../../src/server/application/stream-backfill';
import { RAW_STREAMS_FIXTURE } from '../../src/server/strava/streams.fixture';
import {
  STREAM_BACKFILL_HOUR_MS as HOUR,
  StreamBackfillStopped,
} from '../../src/server/strava/stream-backfill-policy';
import { StravaBudgetExceededError } from '../../src/server/strava/request-budget';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  !target.database.endsWith('_test') ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true'
)
  throw new Error('Backfill proof requires a guarded local *_test database');
const client = postgres(target.connectionString, {
  max: 6,
  prepare: false,
  onnotice: () => undefined,
});
const testDb = drizzle(client);
const database = testDb as unknown as Parameters<
  typeof createStreamBackfillRepository
>[0];
let time = Date.parse('2026-09-22T10:37:00Z');
const now = () => new Date(time);
const repository = createStreamBackfillRepository(database, now);
const streams = createActivityStreamsRepository(database);
const background = () =>
  createStravaRequestBudget(database, now, { fifteenMinutes: 50, daily: 200 });
const userIds = Array.from({ length: 6 }, (_, i) => `backfill-proof-${i}`);
const athleteId = (i: number) => 9184000 + i;
const activityId = (i: number, n: number) => 918400000 + i * 1000 + n;
const keys = ['overall:15m', 'overall:day', 'read:15m', 'read:day'];
let requests: string[] = [];
let active = 0;
let peakActive = 0;
let behavior: (url: URL, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;
const oldEnvironment = {
  effects: process.env.ACTIVITYMAP_EXTERNAL_EFFECTS,
  id: process.env.AUTH_STRAVA_ID,
  secret: process.env.AUTH_STRAVA_SECRET,
};
const headers = {
  'X-RateLimit-Limit': '200,2000',
  'X-RateLimit-Usage': '1,1',
  'X-ReadRateLimit-Limit': '100,1000',
  'X-ReadRateLimit-Usage': '1,1',
};
function successful(url: URL): Response {
  if (url.pathname.endsWith('/oauth/token'))
    return Response.json(
      {
        access_token: 'synthetic-refreshed-access',
        refresh_token: 'synthetic-refreshed-refresh',
        expires_at: Math.floor(time / 1000) + 21600,
        expires_in: 21600,
      },
      { headers },
    );
  assert.equal(url.searchParams.get('key_by_type'), 'true');
  assert.deepEqual(url.searchParams.get('keys')?.split(',').sort(), [
    'altitude',
    'distance',
    'heartrate',
    'latlng',
    'time',
    'watts',
  ]);
  // A successfully empty response is durable completion, not a retry signal.
  const empty = url.pathname.includes(String(activityId(1, 80)));
  if (url.pathname.includes(String(activityId(2, 80))))
    return Response.json(
      {
        time: RAW_STREAMS_FIXTURE.time,
        distance: RAW_STREAMS_FIXTURE.distance,
        altitude: RAW_STREAMS_FIXTURE.altitude,
      },
      { headers },
    );
  return Response.json(empty ? {} : RAW_STREAMS_FIXTURE, { headers });
}
async function cleanup() {
  await testDb.delete(users).where(inArray(users.id, userIds));
  await testDb
    .delete(stravaRequestBudgets)
    .where(inArray(stravaRequestBudgets.key, keys));
  await testDb
    .delete(streamBackfillRuns)
    .where(eq(streamBackfillRuns.key, 'historical-streams'));
  requests = [];
  peakActive = 0;
  behavior = async (url) => successful(url);
}
async function seed(owners = 4, count = 80) {
  for (let i = 0; i < owners; i++) {
    await testDb
      .insert(users)
      .values({ id: userIds[i]!, athlete_id: athleteId(i) });
    await testDb.insert(accounts).values({
      id: userIds[i]!,
      userId: userIds[i]!,
      providerId: 'strava',
      accountId: String(athleteId(i)),
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      accessTokenExpiresAt: new Date('2035-01-01'),
      revokedAt: i === 4 ? now() : null,
    });
    if (i === 5)
      await testDb
        .update(accounts)
        .set({ accessToken: null, refreshToken: null })
        .where(eq(accounts.id, userIds[i]!));
    await testDb.insert(activities).values(
      Array.from({ length: count }, (_, n) => ({
        id: activityId(i, n + 1),
        public_id: activityId(i, n + 1),
        athlete: athleteId(i),
        name: 'Synthetic backfill proof',
        sport_type: 'Ride' as const,
        geometryState: 'summary' as const,
        distance: 1000,
        start_date: new Date(Date.UTC(2020, 0, n + 1)),
        start_date_local: new Date(Date.UTC(2020, 0, n + 1)),
        timezone: 'UTC',
      })),
    );
  }
}
const run = (
  options: Partial<Parameters<typeof backfillActivityStreams>[0]> = {},
) =>
  backfillActivityStreams({
    repository,
    streamRepository: streams,
    requestBudget: background(),
    clock: () => time,
    ...options,
  });
const nextHour = () => {
  time += HOUR;
  requests = [];
};
async function beginRun(activityLimit = 5) {
  const lease = await repository.start(activityLimit, 10);
  assert.equal(typeof lease, 'object');
  if (typeof lease === 'string') throw new Error(lease);
  return lease;
}
async function runProof() {
  await verifyConnectedTarget(client, target);
  process.env.ACTIVITYMAP_EXTERNAL_EFFECTS = 'enabled';
  process.env.AUTH_STRAVA_ID = 'synthetic-client';
  process.env.AUTH_STRAVA_SECRET = 'synthetic-secret';
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(
      url.hostname,
      'www.strava.com',
      'only synthetic Strava requests are mocked',
    );
    requests.push(url.pathname);
    active++;
    peakActive = Math.max(peakActive, active);
    try {
      return await behavior(url, init);
    } finally {
      active--;
    }
  };
  await cleanup();
  await seed(6);
  const first = await run();
  assert.equal(first.selected, 5);
  assert.equal(first.fetched, 5);
  assert.equal(first.unavailable, 1);
  assert.equal(first.requests, 5);
  assert.equal(first.remainingBacklog, 315);
  assert.equal(first.stopReason, 'activity_limit');
  assert.equal(peakActive, 1);
  assert.deepEqual(
    requests.map((path) => path.split('/').at(-2)),
    [0, 1, 2, 3]
      .map((i) => String(activityId(i, 80)))
      .concat(String(activityId(0, 1))),
  );
  const replay = await run({ activityLimit: 10 });
  assert.equal(replay.selected, 0);
  assert.equal(
    requests.length,
    5,
    'same-hour replay cannot raise the persisted cap',
  );
  // Newest-first alternates with oldest and rotates owners, even at a frozen clock.
  nextHour();
  const second = await run();
  assert.equal(second.fetched, 5);
  assert.deepEqual(
    requests.slice(0, 3).map((path) => path.split('/').at(-2)),
    [1, 2, 3].map((i) => String(activityId(i, 1))),
  );
  time += 8 * 24 * HOUR;
  requests = [];
  await run();
  assert.ok(
    !requests.some((path) => path.includes(String(activityId(1, 80)))),
    'empty success does not requeue after cache expiry',
  );
  assert.equal(
    (
      await streams.read(
        {
          userId: userIds[1]!,
          athleteId: athleteId(1),
          authentication: 'bearer',
        },
        String(activityId(1, 80)),
      )
    )?.revision,
    '1',
  );

  assert.ok(
    !requests.some((path) => path.includes(String(activityId(2, 80)))),
    'missing sensor keys do not requeue partial success',
  );

  // OAuth and data calls spend the same durable request allowance.
  nextHour();
  await testDb
    .update(accounts)
    .set({ accessTokenExpiresAt: new Date(0) })
    .where(inArray(accounts.id, userIds));
  const capped = await run({ requestLimit: 3 });
  assert.equal(requests.length, 3);
  assert.equal(capped.requests, 3);
  assert.equal(capped.fetched, 1);
  assert.equal(capped.stopReason, 'request_limit');
  assert.equal(requests.filter((p) => p.endsWith('/oauth/token')).length, 2);
  // Stopping at our own cap is not an upstream failure: nothing is marked
  // failed or backed off, and the interrupted activity stays eligible.
  assert.equal(
    (
      await testDb
        .select()
        .from(activityStreams)
        .where(eq(activityStreams.lastAttemptStatus, 'failed'))
    ).length,
    0,
  );
  assert.equal(
    (
      await testDb
        .select()
        .from(streamBackfillAttempts)
        .where(sql`${streamBackfillAttempts.lastError} is not null`)
    ).length,
    0,
  );
  assert.equal((await run()).selected, 0);

  // A second process cannot run while the first is awaiting the network.
  nextHour();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  behavior = async (url) => {
    entered();
    await blocked;
    return successful(url);
  };
  const running = run();
  await started;
  assert.equal((await run()).stopReason, 'busy');
  release();
  await running;
  assert.equal(peakActive, 1);

  // Recover the same unfinished activity after process loss; fence old workers.
  await cleanup();
  await seed(1, 1);
  nextHour();
  const abandoned = await beginRun();
  const candidate = await repository.claimNext(abandoned);
  assert.ok(candidate);
  const pending = await streams.begin(
    candidate.actor,
    candidate.activityId,
    now(),
  );
  assert.equal(pending.kind, 'fetch');
  if (pending.kind !== 'fetch') throw new Error('Expected fetch');
  await repository.attachGeneration(
    abandoned,
    candidate,
    pending.claim.generation,
  );
  await repository.reserveRequest(abandoned);
  time += 91_000;
  const recovered = await run();
  assert.equal(recovered.fetched, 1);
  assert.equal(recovered.retried, 1);
  assert.equal(requests.length, 1);
  assert.equal(
    await streams.commit(pending.claim, {}, now()),
    null,
    'late previous attempt cannot overwrite recovered data',
  );
  await assert.rejects(
    repository.reserveRequest(abandoned),
    StreamBackfillStopped,
  );
  const [durableRun] = await testDb.select().from(streamBackfillRuns);
  assert.equal(durableRun?.selected, 2);
  assert.equal(durableRun?.requests, 2);

  // An already committed payload is the checkpoint even if queue completion died.
  await cleanup();
  await seed(1, 1);
  nextHour();
  const crashAfterCommit = await beginRun();
  const committing = await repository.claimNext(crashAfterCommit);
  assert.ok(committing);
  const claim = await streams.begin(
    committing.actor,
    committing.activityId,
    now(),
  );
  if (claim.kind !== 'fetch') throw new Error('Expected fetch');
  await repository.attachGeneration(
    crashAfterCommit,
    committing,
    claim.claim.generation,
  );
  await streams.commit(claim.claim, {}, now());
  time += 91_000;
  assert.equal((await run()).selected, 0);
  assert.equal(requests.length, 0);

  // Foreground claims use the same activity lease; cron leaves them alone.
  await cleanup();
  await seed(1, 1);
  nextHour();
  const foregroundActor = {
    userId: userIds[0]!,
    athleteId: athleteId(0),
    authentication: 'cookie' as const,
  };
  await streams.begin(foregroundActor, String(activityId(0, 1)), now());
  assert.equal((await run()).selected, 0);
  assert.equal(requests.length, 0);
  time += 91_000;
  assert.equal((await run()).fetched, 1);

  // New arrivals cannot starve the original history: oldest slots drain it.
  await cleanup();
  await seed(1, 12);
  nextHour();
  for (let hour = 0; hour < 6; hour++) {
    await testDb.insert(activities).values({
      id: activityId(0, 100 + hour),
      public_id: activityId(0, 100 + hour),
      athlete: athleteId(0),
      name: 'New arrival',
      sport_type: 'Ride',
      geometryState: 'summary',
      start_date: now(),
      start_date_local: now(),
      timezone: 'UTC',
    });
    await run();
    nextHour();
  }
  const originalHistory = await testDb
    .select({ fetched: activityStreams.fetchedAt })
    .from(activityStreams)
    .where(sql`${activityStreams.activityId} <= ${activityId(0, 12)}`);
  assert.equal(originalHistory.length, 12);
  assert.ok(originalHistory.every((row) => row.fetched));

  // Each of the four shared windows can stop backfill while ordinary traffic
  // still has room. The background reserve must not mark it globally blocked.
  for (const [key, ceiling, used, duration] of [
    ['overall:15m', 200, 150, 900_000],
    ['read:15m', 100, 50, 900_000],
    ['overall:day', 2000, 1800, 86_400_000],
    ['read:day', 1000, 800, 86_400_000],
  ] as const) {
    await cleanup();
    await seed(1, 2);
    nextHour();
    await testDb.insert(stravaRequestBudgets).values({
      key,
      ceiling,
      used,
      windowStart: new Date(Math.floor(time / duration) * duration),
    });
    const low = await run();
    assert.equal(low.stopReason, 'rate_limit', key);
    assert.equal(requests.length, 0);
    const foreground = createStravaRequestBudget(database, now);
    const ticket = await foreground.reserve(true);
    await foreground.observe(ticket, null, 0);
    assert.equal(
      (await run()).stopReason,
      'rate_limit',
      'quota stop pauses replays until next hour',
    );
  }

  // Repeated quota deferrals remain retryable, even after many attempts.
  await cleanup();
  await seed(1, 1);
  nextHour();
  for (let deferred = 0; deferred < 10; deferred++) {
    time += 24 * HOUR;
    await testDb
      .insert(stravaRequestBudgets)
      .values({
        key: 'read:15m',
        ceiling: 100,
        used: 50,
        windowStart: new Date(Math.floor(time / 900_000) * 900_000),
      })
      .onConflictDoUpdate({
        target: stravaRequestBudgets.key,
        set: {
          used: 50,
          windowStart: new Date(Math.floor(time / 900_000) * 900_000),
        },
      });
    assert.equal((await run()).stopReason, 'rate_limit');
  }
  const [deferredAttempt] = await testDb.select().from(streamBackfillAttempts);
  assert.equal(deferredAttempt?.attemptCount, 10);
  assert.equal(deferredAttempt?.terminal, false);
  assert.equal(deferredAttempt?.nextAttemptAt?.getTime(), time + 24 * HOUR);
  time += 24 * HOUR;
  assert.equal((await run()).fetched, 1);

  // Stop on upstream 429 and preserve already committed work.
  await cleanup();
  await seed(1, 3);
  nextHour();
  behavior = async (url) =>
    requests.length === 2
      ? Response.json({ secret: 'never-persist' }, { status: 429, headers })
      : successful(url);
  const limited = await run();
  assert.equal(limited.fetched, 1);
  assert.equal(limited.stopReason, 'rate_limit');
  assert.equal(requests.length, 2);
  await assert.rejects(
    createStravaRequestBudget(database, now).reserve(true),
    StravaBudgetExceededError,
  );
  assert.equal(await repository.remainingBacklog(), 2);
  const [failed429] = await testDb
    .select()
    .from(streamBackfillAttempts)
    .where(sql`${streamBackfillAttempts.lastError} is not null`);
  assert.deepEqual(failed429?.lastError, {
    code: 'rate_limited',
    retryable: true,
  });

  // Transient backoff is durable; terminal failures don't create an hourly loop.
  await cleanup();
  await seed(1, 1);
  nextHour();
  behavior = async () =>
    Response.json({ secret: 'never-persist' }, { status: 500, headers });
  const failure = await run();
  assert.equal(failure.failed, 1);
  let [attempt] = await testDb.select().from(streamBackfillAttempts);
  assert.equal(attempt?.attemptCount, 1);
  assert.equal(attempt?.nextAttemptAt?.getTime(), time + HOUR);
  assert.equal((await run()).selected, 0);
  nextHour();
  await run();
  [attempt] = await testDb.select().from(streamBackfillAttempts);
  assert.equal(attempt?.attemptCount, 2);
  assert.equal(attempt?.nextAttemptAt?.getTime(), time + 2 * HOUR);
  nextHour();
  assert.equal((await run()).selected, 0);
  nextHour();
  behavior = async () => Response.json({}, { status: 404, headers });
  await run();
  [attempt] = await testDb.select().from(streamBackfillAttempts);
  assert.equal(attempt?.terminal, true);
  assert.deepEqual(attempt?.lastError, { code: 'not_found', retryable: false });
  nextHour();
  assert.equal((await run()).selected, 0);
  // A new generation resets terminal state and attempt count.
  await testDb
    .update(activities)
    .set({ distance: 2000 })
    .where(eq(activities.id, activityId(0, 1)));
  behavior = async (url) => successful(url);
  assert.equal((await run()).fetched, 1);
  [attempt] = await testDb.select().from(streamBackfillAttempts);
  assert.equal(attempt?.attemptCount, 1);
  assert.equal(attempt?.terminal, false);

  // Rejected credentials pause the account, not its activities, until the
  // grant changes (refresh or reconnect); no request budget is spent meanwhile.
  await cleanup();
  await seed(1, 3);
  nextHour();
  behavior = async () =>
    Response.json({ message: 'Authorization Error' }, { status: 401, headers });
  const rejected = await run();
  assert.equal(rejected.failed, 1);
  assert.equal(rejected.selected, 1, 'other activities of the account wait');
  assert.equal(requests.length, 1);
  const rejectedAttempts = await testDb.select().from(streamBackfillAttempts);
  assert.equal(rejectedAttempts.length, 1);
  assert.equal(rejectedAttempts[0]?.terminal, false);
  assert.equal(rejectedAttempts[0]?.nextAttemptAt, null);
  assert.deepEqual(rejectedAttempts[0]?.lastError, {
    code: 'unauthorized',
    retryable: false,
  });
  nextHour();
  behavior = async (url) => successful(url);
  assert.equal((await run()).selected, 0, 'unchanged credentials stay paused');
  assert.equal(requests.length, 0);
  await testDb
    .update(accounts)
    .set({
      accessToken: 'reconnected',
      accessTokenExpiresAt: new Date('2036-01-01'),
    })
    .where(eq(accounts.id, userIds[0]!));
  assert.equal((await run()).fetched, 3, 'reconnect resumes every activity');

  // A generation invalidation, revocation or deletion during HTTP cannot commit.
  for (const change of ['invalidate', 'revoke', 'delete'] as const) {
    await cleanup();
    await seed(1, 1);
    nextHour();
    behavior = async (url) => {
      if (change === 'invalidate')
        await testDb
          .update(activities)
          .set({ distance: 5000 })
          .where(eq(activities.id, activityId(0, 1)));
      if (change === 'revoke')
        await testDb
          .update(accounts)
          .set({ revokedAt: now() })
          .where(eq(accounts.id, userIds[0]!));
      if (change === 'delete')
        await testDb
          .delete(activities)
          .where(eq(activities.id, activityId(0, 1)));
      return successful(url);
    };
    await run({ activityLimit: 1 });
    const rows = await testDb
      .select({ fetched: activityStreams.fetchedAt })
      .from(activityStreams);
    assert.ok(
      rows.every((row) => row.fetched === null),
      change,
    );
    if (change === 'delete')
      assert.equal(
        (await testDb.select().from(streamBackfillAttempts)).length,
        0,
      );
  }

  // Check before and after HTTP; a late response cannot publish beyond deadline.
  await cleanup();
  await seed(1, 4);
  nextHour();
  behavior = async (url) => {
    time += 1000;
    return successful(url);
  };
  const timed = await run({ timeMs: 1500 });
  assert.equal(timed.stopReason, 'deadline');
  assert.equal(requests.length, 2);
  assert.equal(timed.fetched, 1);
  // A truly slow upstream is cancelled by the real AbortSignal too.
  await cleanup();
  await seed(1, 1);
  nextHour();
  let wasAborted = false;
  behavior = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const stop = () => {
        wasAborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (init?.signal?.aborted) stop();
      else init?.signal?.addEventListener('abort', stop, { once: true });
    });
  const realStarted = Date.now();
  const aborted = await run({ timeMs: 250 });
  assert.equal(aborted.stopReason, 'deadline');
  assert.ok(wasAborted);
  assert.ok(Date.now() - realStarted < 1500);

  // Cascades remove per-account scheduling state with athlete erasure.
  await testDb.delete(users).where(eq(users.id, userIds[0]!));
  assert.equal((await testDb.select().from(streamBackfillAccounts)).length, 0);
  assert.equal((await testDb.select().from(streamBackfillAttempts)).length, 0);
  console.log(
    'Stream backfill proof passed: caps, fairness, leases/replay, shared quota, backoff, lifecycle, and deadline.',
  );
}
try {
  await runProof();
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    ACTIVITYMAP_EXTERNAL_EFFECTS: oldEnvironment.effects,
    AUTH_STRAVA_ID: oldEnvironment.id,
    AUTH_STRAVA_SECRET: oldEnvironment.secret,
  })) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  await cleanup();
  await client.end();
}
