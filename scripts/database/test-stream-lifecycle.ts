import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolveMigrationTarget } from '../../src/server/db/migration-tooling';
import {
  accounts,
  activities,
  activityStreams,
  stravaRequestBudgets,
  users,
} from '../../src/server/db/schema';
import { createActivityStreamsRepository } from '../../src/server/repositories/activity-streams';
import { createActivitiesRepository } from '../../src/server/repositories/activities';
import { createChangesRepository } from '../../src/server/repositories/changes';
import { createStravaRequestBudget } from '../../src/server/repositories/strava-budget';
import { fetchActivityStreams } from '../../src/server/application/activity-streams';
import { createActivityStreamsHandler } from '../../src/app/api/v1/activities/[id]/streams/handler';
import { toActivityDTO } from '../../src/contracts/v1/activity';
import {
  activityStreamSummariesDTOSchema,
  activityStreamSummaryDTOSchema,
  activityStreamsDTOSchema,
  toActivityStreamsDTO,
} from '../../src/contracts/v1/activity-streams';
import { RAW_STREAMS_FIXTURE } from '../../src/server/strava/streams.fixture';
import { summarizeStreams } from '../../src/server/strava/stream-summary';
import { createStreamSummariesHandler } from '../../src/app/api/v1/stream-summaries/handler';
import { StravaApiError } from '../../src/server/strava/client';
import { StravaBudgetExceededError } from '../../src/server/strava/request-budget';
import type { Actor } from '../../src/server/auth/actor';

const target = resolveMigrationTarget(process.env);
if (
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error('Lifecycle proof requires a guarded local *_test database');
const client = postgres(target.connectionString, {
  max: 6,
  prepare: false,
  onnotice: () => undefined,
});
const testDb = drizzle(client);
const database = testDb as unknown as Parameters<
  typeof createActivityStreamsRepository
>[0];
const repository = createActivityStreamsRepository(database);
const activityRepository = createActivitiesRepository(database);
const changes = createChangesRepository(database);
const actor: Actor = {
  userId: 'stream-lifecycle-owner',
  athleteId: 9183001,
  authentication: 'cookie',
};
const other: Actor = {
  userId: 'stream-lifecycle-other',
  athleteId: 9183002,
  authentication: 'bearer',
};
const ID = '9183100';
const NOW = new Date();
let clock = new Date(NOW);
const now = () => clock;
const source = () => ({
  async getActivityStreams() {
    return RAW_STREAMS_FIXTURE;
  },
});
const budgetKeys = ['overall:15m', 'overall:day', 'read:15m', 'read:day'];
async function cleanup() {
  await testDb
    .delete(users)
    .where(inArray(users.id, [actor.userId, other.userId]));
  await testDb
    .delete(stravaRequestBudgets)
    .where(inArray(stravaRequestBudgets.key, budgetKeys));
}
async function seedActivity() {
  await testDb
    .insert(activities)
    .values({
      id: Number(ID),
      public_id: Number(ID),
      athlete: actor.athleteId,
      name: 'Stream lifecycle',
      sport_type: 'Ride',
      start_date: NOW,
      start_date_local: NOW,
      timezone: 'UTC',
      geometryState: 'summary',
      distance: 1000,
    });
}
async function fetch(force = false) {
  return fetchActivityStreams(actor, ID, {
    repository,
    createSource: source,
    now,
    force,
  });
}
const request = (query = '') =>
  new Request(`https://app.test/api/v1/activities/${ID}/streams?${query}`);
const makeHandlerView = (
  caller: Actor,
  view: 'raw' | 'summary',
  createSource = source,
) =>
  createActivityStreamsHandler({
    view,
    repository,
    resolveActor: async () => caller,
    now,
    fetch: (owner, id, options) =>
      fetchActivityStreams(owner, id, { ...options, createSource }),
  });
const makeHandler = (caller: Actor, createSource = source) =>
  createActivityStreamsHandler({
    repository,
    resolveActor: async () => caller,
    now,
    fetch: (owner, id, options) =>
      fetchActivityStreams(owner, id, { ...options, createSource }),
  });
async function run() {
  await cleanup();
  for (const owner of [actor, other]) {
    await testDb
      .insert(users)
      .values({ id: owner.userId, athlete_id: owner.athleteId });
    await testDb
      .insert(accounts)
      .values({
        id: owner.userId,
        userId: owner.userId,
        providerId: 'strava',
        accountId: String(owner.athleteId),
        accessToken: 'synthetic-access',
        accessTokenExpiresAt: new Date('2030-01-01'),
      });
  }
  await seedActivity();
  const ownerHandler = makeHandler(actor);
  const never = await ownerHandler(request('fetch=none'));
  assert.equal(never.status, 200);
  assert.match(await never.text(), /"state":"not_fetched"/);
  for (const authentication of ['cookie', 'bearer'] as const) {
    const denied = await makeHandler({ ...other, authentication })(request());
    assert.equal(denied.status, 404);
    assert.doesNotMatch(await denied.text(), /available_types/);
  }

  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const slow = makeHandler(actor, () => ({
    async getActivityStreams() {
      calls++;
      entered();
      await blocked;
      return RAW_STREAMS_FIXTURE;
    },
  }));
  const first = slow(request());
  await started;
  const duplicate = await slow(request());
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.headers.get('retry-after'), '3');
  assert.equal(calls, 1);
  release();
  const completed = await first;
  assert.equal(completed.status, 200);
  const body = (await completed.json()) as { data: unknown };
  assert.deepEqual(
    activityStreamsDTOSchema.parse(body.data).streams,
    RAW_STREAMS_FIXTURE,
  );
  await slow(request());
  assert.equal(calls, 1, 'fresh read does not refetch');
  const stored = await repository.read(actor, ID);
  assert.ok(stored);

  const bootstrap = await activityRepository.findPageByAthlete(
    actor.athleteId,
    { limit: 10 },
  );
  const listed = toActivityDTO(bootstrap[0]!);
  assert.equal(listed.streams?.revision, '1');
  assert.deepEqual(
    listed.streams,
    toActivityStreamsDTO(ID, stored).metadata,
  );
  assert.doesNotMatch(
    JSON.stringify(listed),
    /"data":|original_size|upstream_metadata/,
  );
  const events = await changes.findAfter(actor.athleteId, 0);
  assert.equal(
    events.length,
    2,
    'pending and committed metadata publish atomic feed entries',
  );
  assert.deepEqual(
    await changes.findAfter(actor.athleteId, 0),
    events,
    'feed is replayable',
  );
  assert.deepEqual(
    toActivityDTO((await activityRepository.findManyByIds([Number(ID)]))[0]!)
      .streams,
    listed.streams,
  );

  await testDb
    .update(activities)
    .set({ name: 'Renamed', kudos_count: 20, lastSummarySeenAt: now() })
    .where(eq(activities.id, Number(ID)));
  assert.equal(
    (await fetch()).status,
    'cached',
    'engagement and summary observations do not revalidate or invalidate sensor samples',
  );
  clock = new Date(clock.getTime() + 365 * 24 * 60 * 60 * 1000);
  assert.equal(
    toActivityStreamsDTO(ID, await repository.read(actor, ID)).metadata.state,
    'current',
  );
  assert.equal(
    (await fetch()).status,
    'cached',
    'stored samples stay current until invalidated, whatever their age',
  );
  assert.equal(
    toActivityDTO((await activityRepository.findManyByIds([Number(ID)]))[0]!)
      .streams?.state,
    'current',
  );

  // Summaries: written with the payload, filled lazily for older rows, and
  // only ever returned for the actor's own activities.
  const expectedSummary = summarizeStreams(RAW_STREAMS_FIXTURE);
  const [storedSummary] = await testDb
    .select({ summary: activityStreams.summary })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, BigInt(ID)));
  assert.deepEqual(storedSummary?.summary, expectedSummary);
  await testDb
    .update(activityStreams)
    .set({ summary: null })
    .where(eq(activityStreams.activityId, BigInt(ID)));
  const [lazy] = await repository.readSummaries(actor, [ID, '9183999']);
  assert.equal(lazy?.activityId, ID);
  assert.deepEqual(lazy?.row?.summary, expectedSummary);
  const [refilled] = await testDb
    .select({ summary: activityStreams.summary })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, BigInt(ID)));
  assert.deepEqual(
    refilled?.summary,
    expectedSummary,
    'a lazily computed summary is stored',
  );
  assert.deepEqual(
    await repository.readSummaries(other, [ID]),
    [],
    "another athlete's activity is omitted",
  );
  const summaryResponse = await makeHandlerView(actor, 'summary')(
    new Request(`https://app.test/api/v1/activities/${ID}/streams/summary`),
  );
  assert.equal(summaryResponse.status, 200);
  const summaryBody = activityStreamSummaryDTOSchema.parse(
    ((await summaryResponse.json()) as { data: unknown }).data,
  );
  assert.deepEqual(summaryBody.summary, expectedSummary);
  assert.doesNotMatch(JSON.stringify(summaryBody), /original_size/);
  const batchResponse = await createStreamSummariesHandler({
    repository,
    resolveActor: async () => actor,
  })(new Request(`https://app.test/api/v1/stream-summaries?ids=${ID},1`));
  assert.equal(batchResponse.status, 200);
  const batch = activityStreamSummariesDTOSchema.parse(
    ((await batchResponse.json()) as { data: unknown }).data,
  );
  assert.deepEqual(
    batch.summaries.map((entry) => [entry.activity_id, entry.summary]),
    [[ID, expectedSummary]],
  );

  const { generation, revision } = (await repository.read(actor, ID))!;
  const beforeInvalidation = await changes.latestSequence(actor.athleteId);
  await testDb
    .update(activities)
    .set({ elapsed_time: 200, total_elevation_gain: 50 })
    .where(eq(activities.id, Number(ID)));
  const invalid = await repository.read(actor, ID);
  assert.notEqual(invalid?.generation, generation);
  // Clients order cached sets by revision alone: invalidation rotates the
  // generation but must never change the revision (see activity-streams.md).
  assert.equal(invalid?.revision, revision);
  assert.equal(toActivityStreamsDTO(ID, invalid).streams, null);
  assert.equal(
    (await changes.findAfter(actor.athleteId, beforeInvalidation)).length,
    1,
  );
  // Explicit webhook invalidation also catches edits whose source fields are unchanged.
  await fetch();
  const refetched = (await repository.read(actor, ID))!;
  assert.ok(BigInt(refetched.revision) > BigInt(revision));
  await testDb.execute(sql`select invalidate_activity_streams(${ID}::bigint)`);
  const reinvalidated = await repository.read(actor, ID);
  assert.equal(toActivityStreamsDTO(ID, reinvalidated).metadata.state, 'stale');
  assert.notEqual(reinvalidated?.generation, refetched.generation);
  assert.equal(reinvalidated?.revision, refetched.revision);

  let claim = await repository.begin(actor, ID, now());
  assert.equal(claim.kind, 'fetch');
  if (claim.kind !== 'fetch') throw new Error('Expected claim');
  await testDb
    .update(activities)
    .set({ distance: 1200 })
    .where(eq(activities.id, Number(ID)));
  assert.equal(
    await repository.commit(claim.claim, {}, now()),
    null,
    'late response cannot refresh invalidated generation',
  );
  await fetch();

  // Failed publication must roll back raw samples, metadata and their revision.
  clock = new Date(clock.getTime() + 120_000);
  claim = await repository.begin(actor, ID, now(), true);
  if (claim.kind !== 'fetch') throw new Error('Expected claim');
  const prior = await repository.read(actor, ID);
  const priorSequence = await changes.latestSequence(actor.athleteId);
  await client.unsafe(
    `CREATE FUNCTION stream_feed_proof_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.athlete_id = ${actor.athleteId} THEN RAISE EXCEPTION 'injected publication failure'; END IF; RETURN NEW; END $$`,
  );
  await client.unsafe(
    'CREATE TRIGGER stream_feed_proof_reject BEFORE INSERT ON sync_change FOR EACH ROW EXECUTE FUNCTION stream_feed_proof_reject()',
  );
  try {
    await assert.rejects(repository.commit(claim.claim, {}, now()));
    assert.deepEqual(await repository.read(actor, ID), prior);
    assert.equal(await changes.latestSequence(actor.athleteId), priorSequence);
  } finally {
    await client.unsafe('DROP TRIGGER stream_feed_proof_reject ON sync_change');
    await client.unsafe('DROP FUNCTION stream_feed_proof_reject()');
  }
  await repository.commit(claim.claim, {}, now());
  assert.equal(
    (await fetch()).status,
    'cached',
    'empty success is not an infinite queue',
  );

  clock = new Date(clock.getTime() + 120_000);
  const failing = makeHandler(actor, () => ({
    async getActivityStreams() {
      throw new StravaApiError('throttled', 429);
    },
  }));
  assert.equal((await failing(request('refresh=true'))).status, 429);
  assert.equal(
    (await failing(request('refresh=true'))).status,
    429,
    'cooldown does not make another upstream call',
  );
  const failed = await repository.read(actor, ID);
  assert.deepEqual(failed?.payload, {});
  assert.equal(failed?.lastError?.code, 'rate_limited');
  const lastGood = await failing(request());
  assert.equal(
    lastGood.status,
    200,
    'a failed refresh cooldown still serves the current payload',
  );
  const lastGoodBody = activityStreamsDTOSchema.parse(
    ((await lastGood.json()) as { data: unknown }).data,
  );
  assert.equal(lastGoodBody.metadata.state, 'current');
  assert.equal(lastGoodBody.metadata.fetch_status, 'failed');
  assert.deepEqual(lastGoodBody.streams, {});

  clock = new Date(clock.getTime() + 120_000);
  claim = await repository.begin(actor, ID, now(), true);
  if (claim.kind !== 'fetch') throw new Error('Expected claim');
  await testDb
    .update(accounts)
    .set({ revokedAt: now(), accessToken: null })
    .where(eq(accounts.id, actor.userId));
  assert.equal(await repository.isCurrent(claim.claim), false);
  assert.equal(
    await repository.commit(claim.claim, RAW_STREAMS_FIXTURE, now()),
    null,
  );
  assert.equal((await ownerHandler(request('fetch=none'))).status, 404);
  await testDb
    .update(accounts)
    .set({ revokedAt: null, accessToken: 'new-token', updatedAt: now() })
    .where(eq(accounts.id, actor.userId));
  assert.equal(
    await repository.commit(claim.claim, RAW_STREAMS_FIXTURE, now()),
    null,
  );
  await activityRepository.deleteManyForAthlete(actor.athleteId, [Number(ID)]);
  assert.equal((await ownerHandler(request())).status, 404);
  const deletions = await changes.findAfter(actor.athleteId, priorSequence);
  assert.ok(
    deletions.some(
      (event) => event.entityId === ID && event.operation === 'delete',
    ),
  );
  assert.equal(
    (
      await testDb
        .select()
        .from(activityStreams)
        .where(eq(activityStreams.activityId, BigInt(ID)))
    ).length,
    0,
  );

  // Shared reservations work across independent repository instances.
  clock = new Date('2026-10-01T12:00:00Z');
  const budget = createStravaRequestBudget(database, now);
  const siblingBudget = createStravaRequestBudget(database, now);
  const initial = await budget.reserve(true);
  await budget.observe(
    initial,
    {
      read: {
        limit15Minutes: 100,
        limitDaily: 1000,
        usage15Minutes: 74,
        usageDaily: 100,
      },
    },
    200,
  );
  const competing = await Promise.allSettled([
    budget.reserve(true),
    siblingBudget.reserve(true),
    budget.reserve(true),
  ]);
  assert.equal(
    competing.filter((item) => item.status === 'fulfilled').length,
    1,
  );
  assert.ok(
    competing.some(
      (item) =>
        item.status === 'rejected' &&
        item.reason instanceof StravaBudgetExceededError,
    ),
  );
  const [overall] = await testDb
    .select()
    .from(stravaRequestBudgets)
    .where(eq(stravaRequestBudgets.key, 'overall:15m'));
  assert.equal(
    overall?.used,
    2,
    'denied multi-window reservations roll back entirely',
  );
  const ticket = competing.find((item) => item.status === 'fulfilled');
  assert.ok(ticket?.status === 'fulfilled');
  await budget.observe(
    ticket.value,
    {
      read: {
        limit15Minutes: 100,
        limitDaily: 1000,
        usage15Minutes: 100,
        usageDaily: 1000,
      },
    },
    429,
  );
  clock = new Date('2026-10-01T12:15:01Z');
  await assert.rejects(
    budget.reserve(true),
    StravaBudgetExceededError,
    'daily ceiling survives 15-minute rollover',
  );
  clock = new Date('2026-10-02T00:00:01Z');
  const nextDay = await budget.reserve(true);
  await budget.observe(
    initial,
    {
      read: {
        limit15Minutes: 100,
        limitDaily: 1000,
        usage15Minutes: 100,
        usageDaily: 1000,
      },
    },
    429,
  );
  await budget.observe(nextDay, null, 200);
  await budget.reserve(true);
  assert.ok(
    (
      await testDb
        .select()
        .from(stravaRequestBudgets)
        .where(
          and(
            eq(stravaRequestBudgets.key, 'read:15m'),
            eq(stravaRequestBudgets.used, 2),
          ),
        )
    ).length,
    'late old-window headers cannot poison the next day',
  );
}
try {
  await run();
  console.log(
    'Stream API, lifecycle, feed and shared-budget PostgreSQL proof passed.',
  );
} finally {
  await cleanup();
  await client.end({ timeout: 5 });
}
