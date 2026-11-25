import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test, { afterEach, beforeEach, mock } from 'node:test';

import { createProviderGatewayHandler } from '../../src/app/api/internal/provider/v1/handler';
import {
  EMPTY_SET_DIGEST,
  LIVE_CATALOGUE,
  type PlaceRow,
  addToSetDigest,
  datasetFor,
  rowHash,
  tileOf,
} from '../../src/server/places/catalogue-rows';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import {
  catalogueIdentity,
  matchingVersion as versionFor,
} from '../../src/server/places/matching-version';
import type {
  GatewayFailure,
  GatewayOperation,
} from '../../src/server/provider-gateway/contract';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { internal } from '../convex/_generated/api';
import { LEASE_MS, MAX_ATTEMPTS, requestMatch } from '../convex/ingestion';
import {
  CONFIRM_INTERVAL_MS,
  CONFIRM_LIMIT,
  EXPLICIT_REQUEST_COOLDOWN_MS,
  SWEEP_INTERVAL_MS,
} from '../convex/ingestionSweep';
import { isMatched } from '../convex/placeCounts';
import schema from '../convex/schema';
import { stravaDetail as detail, stravaPhoto as photo } from './fixtures';

/**
 * Convex ingestion end to end: provider events, the job model, the Node
 * worker, the real gateway client and route handler, and a stand-in for
 * Strava behind them.
 */

// Every test gets its own clock: a backend left over from an earlier test
// still has work scheduled days ahead, which must not run in a later one.
const startedAt = Date.now();

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './catalogueWorker.ts': () => import('../convex/catalogueWorker'),
  './erasure.ts': () => import('../convex/erasure'),
  './ingestion.ts': () => import('../convex/ingestion'),
  './ingestionSweep.ts': () => import('../convex/ingestionSweep'),
  './ingestionWorker.ts': () => import('../convex/ingestionWorker'),
  './livePlaces.ts': () => import('../convex/livePlaces'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './placeCounts.ts': () => import('../convex/placeCounts'),
  './places.ts': () => import('../convex/places'),
  './providerEvents.ts': () => import('../convex/providerEvents'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './sync.ts': () => import('../convex/sync'),
  './library.ts': () => import('../convex/library'),
  './shares.ts': () => import('../convex/shares'),
};

const actor = { userId: 'owner', athleteId: '42' };
const scope = { ...actor, epoch: 'test-owner-epoch-01' };
const secret = 'a'.repeat(64);
const streams: RawActivityStreams = {
  time: {
    data: [0, 1],
    original_size: 2,
    resolution: 'high',
    series_type: 'time',
  },
};

class Refused extends Error {
  constructor(readonly failure: GatewayFailure) {
    super(failure.kind);
  }
}

/** Strava as the gateway sees it, behind the real route handler. */
function fakeProvider() {
  const activities = new Map<string, ReturnType<typeof detail>>();
  const photos = new Map<string, ReturnType<typeof photo>[]>();
  const withoutStreams = new Set<string>();
  const recorded = new Map<string, RawActivityStreams>();
  let hidden = false;
  const reads: string[] = [];
  /** Reads of the activity list, kept apart from reads of one activity. */
  const lists: string[] = [];
  const failures: { failure: GatewayFailure; kind?: string }[] = [];
  const provider = {
    reads,
    lists,
    set(activity: ReturnType<typeof detail>, withPhotos: string[] = []) {
      const id = String(activity.id);
      activities.set(id, {
        ...activity,
        total_photo_count: withPhotos.length,
      });
      photos.set(
        id,
        withPhotos.map((key) => photo(key, activity.id)),
      );
    },
    remove: (id: string) => activities.delete(id),
    /** Make the activity list come back empty until restored. */
    hide() {
      hidden = true;
      return { restore: () => (hidden = false) };
    },
    noStreams: (id: string) => withoutStreams.add(id),
    /** What the activity's streams read answers, instead of the default. */
    record: (id: string, payload: RawActivityStreams) =>
      recorded.set(id, payload),
    /** Answer the next read (of this kind, if given) with a failure. */
    fail: (failure: GatewayFailure, kind?: GatewayOperation['kind']) =>
      failures.push({ failure, kind }),
    /** Runs once, while the next read is under way: after the provider has
     * decided its answer and before the worker receives it. */
    during: null as null | (() => Promise<unknown>),
  };
  const handler = createProviderGatewayHandler({
    config: () => ({ keys: { k1: secret } }),
    serves: async (userId) => userId === actor.userId,
    athleteFor: async () => 42,
    failureFor: (error) => (error instanceof Refused ? error.failure : null),
    read: async (_owner, operation: GatewayOperation) => {
      const id = 'id' in operation ? operation.id : '';
      if (operation.kind === 'activities') lists.push(`page ${operation.page}`);
      else reads.push(`${operation.kind} ${id}`);
      const answer = () => {
        const index = failures.findIndex(
          (entry) => !entry.kind || entry.kind === operation.kind,
        );
        if (index >= 0)
          throw new Refused(failures.splice(index, 1)[0]!.failure);
        if (operation.kind === 'activities') {
          if (hidden) return [];
          const before = (operation.before ?? Infinity) * 1000;
          const start = (operation.page - 1) * operation.perPage;
          return [...activities.values()]
            .filter((entry) => Date.parse(entry.start_date) < before)
            .slice(start, start + operation.perPage);
        }
        const activity = activities.get(id);
        if (!activity) throw new Refused({ kind: 'not_found' });
        switch (operation.kind) {
          case 'activity':
            return activity;
          case 'photos':
            return photos.get(id);
          case 'streams':
            if (withoutStreams.has(id))
              throw new Refused({ kind: 'not_found' });
            return recorded.get(id) ?? streams;
          default:
            throw new Error('Unexpected read');
        }
      };
      let outcome: { value: unknown } | { error: unknown };
      try {
        outcome = { value: answer() };
      } catch (error) {
        outcome = { error };
      }
      const hook = provider.during;
      provider.during = null;
      await hook?.();
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    },
  });
  mock.method(globalThis, 'fetch', (url: string | URL, init?: RequestInit) =>
    handler(new Request(url, init)),
  );
  return provider;
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startedAt });
  process.env.ACTIVITYMAP_APP_ORIGIN = 'https://app.test';
  process.env.ACTIVITYMAP_PROVIDER_GATEWAY_KEY_ID = 'k1';
  process.env.ACTIVITYMAP_PROVIDER_GATEWAY_SECRET = secret;
});
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

type Convex = ReturnType<typeof convexTest<typeof schema>>;

/** Run what is due now, and what that schedules for now. */
async function settle(convex: Convex) {
  for (let i = 0; i < 20; i++) {
    mock.timers.tick(0);
    await convex.finishInProgressScheduledFunctions();
  }
  const jobs = await convex.run((ctx) =>
    ctx.db.system.query('_scheduled_functions').collect(),
  );
  assert(
    !jobs.some((job) => job.state.kind === 'failed'),
    'scheduled function failed',
  );
  await checkMatchCounts(convex);
}

/** The stored match counts are what the library holds. */
async function checkMatchCounts(convex: Convex) {
  await convex.run(async (ctx) => {
    const activities = await ctx.db.query('activities').collect();
    for (const counts of await ctx.db.query('placeMatchCounts').collect()) {
      if (counts.rebuildAfter !== undefined) continue;
      const owner = await ctx.db.get('owners', counts.owner);
      // An erasure deletes the counts with the owner, not with each match.
      if (!owner || owner.revoked) continue;
      assert.equal(
        counts.matched,
        activities.filter(
          (row) => row.owner === owner._id && isMatched(owner, row),
        ).length,
        'match count',
      );
    }
  });
}

const matchCounts = (convex: Convex) =>
  convex.run((ctx) => ctx.db.query('placeMatchCounts').first());
const publicationRows = (convex: Convex) =>
  convex.run((ctx) => ctx.db.query('placePublications').collect());

async function advance(convex: Convex, ms: number) {
  mock.timers.tick(ms);
  await settle(convex);
}

/** An owner that reads from Convex and that Convex writes for. */
async function owner(
  matching = { catalogue: 'a'.repeat(64), matchingVersion: 'b'.repeat(64) },
) {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'test-generation-01',
    ...matching,
  });
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'convex',
    expectedEpoch: 0,
  });
  await settle(convex);
  return convex;
}

let delivery = 0;
function event(
  convex: Convex,
  activityId: string,
  aspect: 'create' | 'update' | 'delete' = 'create',
  id = `event-${++delivery}`,
) {
  return convex.mutation(internal.providerEvents.record, {
    scope,
    events: [{ event: id, activityId, aspect, eventTime: 1 }],
  });
}

/** One event after another, each brought to rest. convex-test cannot store
 * files from several actions at once, which concurrent recordings would. */
async function ingest(convex: Convex, ...ids: string[]) {
  for (const id of ids) {
    await event(convex, id);
    await settle(convex);
  }
}

const state = (convex: Convex) =>
  convex.run(async (ctx) => {
    const sweep = await ctx.db.query('ingestionSweeps').first();
    const [activities, photos, recordings, changes, jobs] = await Promise.all([
      ctx.db.query('activities').collect(),
      ctx.db.query('photos').collect(),
      ctx.db.query('recordings').collect(),
      ctx.db.query('changes').collect(),
      ctx.db.query('ingestionJobs').collect(),
    ]);
    return { activities, photos, recordings, changes, jobs, sweep };
  });

void test('an event brings in the activity, its photos and its recording', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'), ['p1', 'p2']);

  await event(convex, '7');
  await settle(convex);

  const { activities, photos, recordings, changes, jobs } = await state(convex);
  assert.deepEqual(provider.reads, ['activity 7', 'photos 7', 'streams 7']);
  assert.equal(activities.length, 1);
  const [activity] = activities;
  assert.equal(activity!.dto?.name, 'Morning ride');
  assert.equal(activity!.dto?.athlete, '42');
  assert.equal(activity!.dto?.photos_state, 'current');
  assert.equal(activity!.dto?.geometry_state, 'detailed');
  assert.equal(activity!.sourceRevision, jobs[0]!.revision);
  assert.deepEqual(photos.map((row) => row.key).sort(), ['p1', 'p2']);
  assert.equal(recordings.length, 1);
  assert.equal(activity!.recording, recordings[0]!._id);
  assert.equal(recordings[0]!.revision, '1');
  assert.equal(activity!.projection?.streams?.state, 'current');
  assert.deepEqual(activity!.projection?.streams?.available_types, ['time']);
  // No place rowset for the owner's matching version: no match.
  assert.equal(activity!.projection?.match, undefined);
  assert.deepEqual(
    changes.map((row) => `${row.entityType} ${row.operation} ${row.entityId}`),
    [
      'activity upsert 7',
      'photo upsert p1',
      'photo upsert p2',
      'activity upsert 7',
    ],
  );
  assert.equal(jobs.length, 1);
  assert.deepEqual(
    { status: jobs[0]!.status, lease: jobs[0]!.lease, dueAt: jobs[0]!.dueAt },
    { status: 'idle', lease: undefined, dueAt: undefined },
  );

  // A repeated delivery is one receipt and no further read.
  await event(convex, '7', 'create', `event-${delivery}`);
  await settle(convex);
  assert.equal(provider.reads.length, 3);
});

void test('an update reads the activity again and keeps a recording that still fits', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'));
  await event(convex, '7');
  await settle(convex);
  const before = await state(convex);

  // A new title does not change what the samples were recorded from.
  provider.set(detail(7, 'Evening ride'));
  mock.timers.tick(1000);
  await event(convex, '7', 'update');
  await settle(convex);
  let after = await state(convex);
  assert.deepEqual(provider.reads, ['activity 7', 'streams 7', 'activity 7']);
  assert.equal(after.activities[0]!.dto?.name, 'Evening ride');
  assert.equal(after.activities[0]!.recording, before.recordings[0]!._id);
  assert(
    after.activities[0]!.sourceRevision > before.activities[0]!.sourceRevision,
  );

  // A new distance does: the recording is replaced, one revision on.
  provider.set(detail(7, 'Evening ride', { distance: 2000 }));
  mock.timers.tick(1000);
  await event(convex, '7', 'update');
  await settle(convex);
  after = await state(convex);
  assert.deepEqual(provider.reads.slice(3), ['activity 7', 'streams 7']);
  assert.equal(after.recordings.length, 1);
  assert.notEqual(after.recordings[0]!._id, before.recordings[0]!._id);
  assert.equal(after.recordings[0]!.revision, '2');
  assert.equal(after.activities[0]!.projection?.streams?.state, 'current');
});

void test('an activity the provider no longer has is deleted with its photos', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'), ['p1']);
  await event(convex, '7');
  await settle(convex);

  provider.remove('7');
  mock.timers.tick(1000);
  await event(convex, '7', 'delete');
  await settle(convex);

  const { activities, photos, recordings, changes, jobs } = await state(convex);
  assert.equal(activities[0]!.deleted, true);
  assert.equal(activities[0]!.dto, undefined);
  assert.deepEqual([photos.length, recordings.length], [0, 0]);
  assert.equal(
    changes.at(-1)!.operation + ' ' + changes.at(-1)!.entityId,
    'delete 7',
  );
  assert.equal(jobs[0]!.status, 'idle');

  // An event for an activity that never existed here leaves a tombstone.
  await event(convex, '8', 'delete');
  await settle(convex);
  const tombstone = (await state(convex)).activities.find(
    (row) => row.key.endsWith('8') && row.deleted,
  );
  assert(tombstone);
});

void test('activities without samples get an empty recording, so nothing stays pending', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Typed in by hand', { manual: true }));
  provider.set(detail(8, 'No samples'));
  provider.noStreams('8');

  await ingest(convex, '7', '8');

  const { activities, recordings, jobs } = await state(convex);
  // The manual activity is never asked for samples.
  assert.deepEqual(provider.reads, ['activity 7', 'activity 8', 'streams 8']);
  assert.equal(activities.length, 2);
  assert.deepEqual(
    recordings.map((row) => row.manifest.counts),
    [{}, {}],
  );
  for (const activity of activities) {
    assert.equal(activity.projection?.streams?.state, 'current');
    assert.deepEqual(activity.projection?.streams?.available_types, []);
  }
  assert.deepEqual(
    jobs.map((job) => job.status),
    ['idle', 'idle'],
  );

  // The next event finds the recording and asks for nothing more.
  mock.timers.tick(1000);
  await ingest(convex, '8');
  assert.deepEqual(provider.reads.slice(3), ['activity 8']);
});

void test('an activity typed in by hand is stored although the provider leaves fields out', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  // What the provider does not send for such an activity is absent from
  // its answer, not null.
  const omitted = [
    'elev_high',
    'elev_low',
    'upload_id',
    'gear_id',
    'workout_type',
    'kilojoules',
    'average_watts',
    'device_watts',
    'max_watts',
    'weighted_average_watts',
    'hide_from_home',
    'calories',
  ];
  provider.set(
    detail(7, 'Rowing machine', {
      manual: true,
      sport_type: 'Rowing',
      start_latlng: [],
      end_latlng: [],
      map: { id: 'a7', resource_state: 3 },
      ...Object.fromEntries(omitted.map((field) => [field, undefined])),
    }),
  );

  await ingest(convex, '7');

  const { activities, recordings, jobs } = await state(convex);
  const dto = activities[0]!.dto as unknown as Record<string, unknown>;
  assert.equal(dto.manual, true);
  assert.deepEqual(
    [...omitted, 'map_polyline', 'map_summary_polyline'].map(
      (field) => dto[field],
    ),
    Array.from({ length: omitted.length + 2 }, () => null),
  );
  // Nothing to fetch for it: an empty recording, and the job is done.
  assert.equal(recordings.length, 1);
  assert.deepEqual(provider.reads, ['activity 7']);
  assert.deepEqual(
    jobs.map((job) => [job.status, job.error]),
    [['idle', undefined]],
  );
});

void test('a rate limit waits for the time the gateway names and counts no attempt', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'));
  provider.fail({ kind: 'rate_limited', retryAfterSeconds: 120 });

  await event(convex, '7');
  await settle(convex);
  let { activities, jobs } = await state(convex);
  assert.equal(activities.length, 0);
  assert.deepEqual(
    {
      status: jobs[0]!.status,
      error: jobs[0]!.error,
      attempt: jobs[0]!.attempt,
      lease: jobs[0]!.lease,
      wait: jobs[0]!.dueAt! - Date.now(),
    },
    {
      status: 'queued',
      error: 'rate_limited',
      attempt: 0,
      lease: undefined,
      wait: 120_000,
    },
  );

  // Another event in the meantime does not ask the provider sooner.
  await event(convex, '7', 'update');
  await advance(convex, 119_000);
  assert.equal(provider.reads.length, 1);

  await advance(convex, 1000);
  ({ activities, jobs } = await state(convex));
  assert.equal(activities[0]!.dto?.name, 'Morning ride');
  assert.equal(jobs[0]!.status, 'idle');
  assert.equal(jobs[0]!.error, undefined);

  // A limit that hits the samples keeps the activity and retries that phase.
  provider.set(detail(9, 'Second ride'));
  provider.fail({ kind: 'rate_limited', retryAfterSeconds: 60 }, 'streams');
  await event(convex, '9');
  await settle(convex);
  const second = async () =>
    (await state(convex)).jobs.find((job) => job.activity.endsWith('9'))!;
  assert.deepEqual(
    [(await second()).phase, (await second()).error, (await second()).attempt],
    ['recording', 'rate_limited', 0],
  );
  assert.equal((await state(convex)).activities.length, 2);
  const readsBefore = provider.reads.length;
  await advance(convex, 60_000);
  assert.equal((await second()).status, 'idle');
  assert.deepEqual(provider.reads.slice(readsBefore), ['streams 9']);
  assert.equal((await state(convex)).recordings.length, 2);
});

void test('rejected credentials block the job until the activity is asked for again', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'));
  provider.fail({ kind: 'credentials_rejected' });

  await event(convex, '7');
  await settle(convex);
  await advance(convex, 24 * 60 * 60_000);
  let { jobs } = await state(convex);
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.error, jobs[0]!.dueAt],
    ['blocked', 'credentials_rejected', undefined],
  );
  assert.equal(provider.reads.length, 1);

  await event(convex, '7', 'update');
  await settle(convex);
  ({ jobs } = await state(convex));
  assert.equal(jobs[0]!.status, 'idle');
  assert.equal((await state(convex)).activities.length, 1);
});

void test('a failing provider is retried with growing delays, then the job is given up', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'));
  const down: GatewayFailure = {
    kind: 'upstream_error',
    status: 503,
    retryable: true,
  };
  for (let i = 0; i < MAX_ATTEMPTS; i++) provider.fail(down);

  await event(convex, '7');
  await settle(convex);
  let { jobs } = await state(convex);
  assert.deepEqual(
    [jobs[0]!.attempt, jobs[0]!.error, jobs[0]!.dueAt! - Date.now()],
    [1, 'upstream_error 503', 60_000],
  );
  await advance(convex, 60_000);
  ({ jobs } = await state(convex));
  assert.deepEqual(
    [jobs[0]!.attempt, jobs[0]!.dueAt! - Date.now()],
    [2, 120_000],
  );

  for (let i = 0; i < 12; i++) await advance(convex, 6 * 60 * 60_000);
  ({ jobs } = await state(convex));
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.attempt, jobs[0]!.dueAt],
    ['failed', MAX_ATTEMPTS, undefined],
  );
  assert.equal(provider.reads.length, MAX_ATTEMPTS);
  assert.equal((await state(convex)).activities.length, 0);

  // A failure that no retry can change gives up at once.
  provider.set(detail(8, 'Other ride'));
  provider.fail({ kind: 'upstream_error', status: 400, retryable: false });
  await event(convex, '8');
  await settle(convex);
  const other = (await state(convex)).jobs.find((job) =>
    job.activity.endsWith('8'),
  )!;
  assert.deepEqual(
    [other.status, other.error, other.attempt],
    ['failed', 'upstream_error 400', 0],
  );

  // Asking for the activity again starts over.
  await event(convex, '7', 'update');
  await settle(convex);
  assert.equal((await state(convex)).activities[0]!.dto?.name, 'Morning ride');
});

void test('an activity of another athlete is never stored', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Not mine', { athlete: { id: 43 } }));

  await event(convex, '7');
  await settle(convex);
  await advance(convex, 24 * 60 * 60_000);

  const { activities, jobs } = await state(convex);
  assert.equal(activities.length, 0);
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.error],
    ['failed', 'foreign_activity'],
  );
  assert.deepEqual(provider.reads, ['activity 7']);
});

void test('an event that arrives during a run makes the job run again', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'First name', { manual: true }));
  // The activity changes after the provider answered the first read.
  provider.during = async () => {
    provider.set(detail(7, 'Second name', { manual: true }));
    await event(convex, '7', 'update');
  };

  await event(convex, '7');
  await settle(convex);

  const { activities, jobs } = await state(convex);
  assert.deepEqual(provider.reads, ['activity 7', 'activity 7']);
  assert.equal(activities[0]!.dto?.name, 'Second name');
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.requested, jobs[0]!.claims],
    ['idle', 2, 2],
  );
});

void test('a run that started before a handoff publishes nothing after it', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'));
  provider.during = () =>
    convex.mutation(internal.owners.setWriter, {
      ...actor,
      writer: 'handoff',
      expectedEpoch: 1,
    });

  await event(convex, '7');
  await settle(convex);

  let { activities, jobs } = await state(convex);
  assert.deepEqual(provider.reads, ['activity 7']);
  assert.equal(activities.length, 0);
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.error, jobs[0]!.lease, jobs[0]!.attempt],
    ['queued', 'fenced', undefined, 0],
  );

  // Nothing runs for the owner while another store writes, however long.
  await advance(convex, 24 * 60 * 60_000);
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'postgres',
    expectedEpoch: 2,
  });
  await advance(convex, 24 * 60 * 60_000);
  assert.deepEqual(provider.reads, ['activity 7']);
  await assert.rejects(event(convex, '7', 'update'));

  // Convex writes again: the waiting job is scheduled and finishes.
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'convex',
    expectedEpoch: 3,
  });
  await settle(convex);
  ({ activities, jobs } = await state(convex));
  assert.equal(activities[0]!.dto?.name, 'Morning ride');
  assert.equal(jobs[0]!.status, 'idle');

  // A run that is already scheduled when the owner is handed off is not
  // even started.
  const reads = provider.reads.length;
  await event(convex, '7', 'update');
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'handoff',
    expectedEpoch: 4,
  });
  await advance(convex, 60 * 60_000);
  assert.equal(provider.reads.length, reads);
  assert.equal((await state(convex)).jobs[0]!.status, 'queued');
});

void test('a lost run is retried, and its late publication changes nothing', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Current name', { manual: true }));

  await event(convex, '7');
  // A worker takes the job and is never heard from in time.
  const { job } = await convex.run(async (ctx) => ({
    job: (await ctx.db.query('ingestionJobs').first())!._id,
  }));
  const lost = await convex.mutation(internal.ingestion.claim, { job });
  assert.equal(lost?.claim, 1);
  await settle(convex);
  assert.deepEqual(provider.reads, []);

  await advance(convex, LEASE_MS);
  let { jobs } = await state(convex);
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.error, jobs[0]!.attempt, jobs[0]!.lease],
    ['queued', 'lease_expired', 1, undefined],
  );
  await advance(convex, 60_000);
  let { activities } = await state(convex);
  ({ jobs } = await state(convex));
  assert.equal(activities[0]!.dto?.name, 'Current name');
  assert.equal(jobs[0]!.status, 'idle');
  const revision = activities[0]!.sourceRevision;

  // The lost worker comes back with what it read long ago.
  const late = await convex.mutation(internal.ingestion.publishSource, {
    job,
    claim: lost!.claim,
    dto: { ...activities[0]!.dto!, name: 'Old name' },
    photos: [],
  });
  assert.equal(late, null);
  await convex.mutation(internal.ingestion.fail, {
    job,
    claim: lost!.claim,
    failure: { kind: 'permanent', reason: 'late' },
  });
  ({ activities, jobs } = await state(convex));
  assert.equal(activities[0]!.dto?.name, 'Current name');
  assert.equal(activities[0]!.sourceRevision, revision);
  assert.equal(jobs[0]!.status, 'idle');
});

void test('nothing is read or written without gateway settings', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'));
  delete process.env.ACTIVITYMAP_PROVIDER_GATEWAY_SECRET;

  await event(convex, '7');
  await settle(convex);

  const { activities, jobs } = await state(convex);
  assert.deepEqual(provider.reads, []);
  assert.equal(activities.length, 0);
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.attempt, jobs[0]!.error],
    ['queued', 1, 'The provider gateway is not configured'],
  );
});

const manual = (id: number, name: string) => detail(id, name, { manual: true });

void test('a sweep finds an activity, a change and a deletion that no event reported', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  // The first sweep ran when Convex became the writer, on an empty list.
  assert.deepEqual(provider.lists, ['page 1']);
  for (const activity of [
    manual(1, 'Unchanged'),
    manual(3, 'Old name'),
    manual(4, 'Goes away'),
  ]) {
    provider.set(activity);
    await ingest(convex, String(activity.id));
  }
  assert.equal(provider.reads.length, 3);

  provider.set(manual(2, 'Missed'));
  provider.set(manual(3, 'New name'));
  provider.remove('4');
  await advance(convex, SWEEP_INTERVAL_MS);

  let { activities, sweep } = await state(convex);
  assert.deepEqual(provider.lists.slice(1), ['page 1', 'page 2']);
  // The unchanged activity is not read again.
  assert.deepEqual(provider.reads.slice(3).sort(), [
    'activity 2',
    'activity 3',
    'activity 4',
  ]);
  assert.deepEqual(
    activities
      .map(
        (row) =>
          `${Number(row.key)} ${row.deleted ? 'deleted' : row.dto?.name}`,
      )
      .sort(),
    ['1 Unchanged', '2 Missed', '3 New name', '4 deleted'],
  );
  assert.deepEqual(
    [sweep!.phase, sweep!.number, sweep!.lease, sweep!.dueAt - Date.now()],
    ['idle', 2, undefined, SWEEP_INTERVAL_MS],
  );
  assert.equal(sweep!.listReadAt, Date.now());

  // Nothing changed: the next sweep reads the list and nothing else.
  await advance(convex, SWEEP_INTERVAL_MS);
  assert.equal(provider.reads.length, 6);
  assert.equal(provider.lists.length, 5);

  // A later change is found by its fingerprint.
  provider.set(manual(1, 'Renamed'));
  await advance(convex, SWEEP_INTERVAL_MS);
  assert.deepEqual(provider.reads.slice(6), ['activity 1']);
  ({ activities, sweep } = await state(convex));
  assert.equal(
    activities.find((row) => Number(row.key) === 1)!.dto?.name,
    'Renamed',
  );
  assert.equal(sweep!.number, 4);
});

void test('the list counts as read when a scan reaches its end, not when one starts', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(manual(1, 'Ride'));
  const readAt = (await state(convex)).sweep!.listReadAt;
  assert.equal(readAt, Date.now());

  provider.fail({ kind: 'upstream_error', status: 503, retryable: true });
  await advance(convex, SWEEP_INTERVAL_MS);
  let { sweep } = await state(convex);
  assert.deepEqual([sweep!.phase, sweep!.listReadAt], ['scanning', readAt]);

  await advance(convex, 60_000);
  ({ sweep } = await state(convex));
  assert.equal(sweep!.listReadAt, Date.now());
});

void test('activities missing from the list are confirmed a bounded number at a time', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  const count = CONFIRM_LIMIT + 5;
  for (let id = 1; id <= count; id++) {
    provider.set(manual(id, `Ride ${id}`));
    await ingest(convex, String(id));
  }
  assert.equal(provider.reads.length, count);

  // The list comes back empty, although only some activities are gone.
  const gone = new Set([3, 22]);
  const hidden = provider.hide();
  for (const id of gone) provider.remove(String(id));
  await advance(convex, SWEEP_INTERVAL_MS);
  assert.equal(provider.reads.length, count + CONFIRM_LIMIT);
  assert.equal((await state(convex)).sweep!.phase, 'confirming');

  await advance(convex, CONFIRM_INTERVAL_MS - 1000);
  assert.equal(provider.reads.length, count + CONFIRM_LIMIT);
  await advance(convex, 1000);
  assert.equal(provider.reads.length, 2 * count);

  const { activities, sweep } = await state(convex);
  assert.equal(sweep!.phase, 'idle');
  // Only what the provider confirmed as gone is deleted.
  assert.deepEqual(
    activities
      .filter((row) => row.deleted)
      .map((row) => Number(row.key))
      .sort((a, b) => a - b),
    [...gone],
  );
  hidden.restore();
});

void test('a sweep waits out a rate limit and never trusts a list of another athlete', async () => {
  const provider = fakeProvider();
  provider.fail({ kind: 'rate_limited', retryAfterSeconds: 300 }, 'activities');
  const convex = await owner();
  let { sweep } = await state(convex);
  assert.deepEqual(
    [sweep!.phase, sweep!.error, sweep!.attempt, sweep!.dueAt - Date.now()],
    ['scanning', 'rate_limited', 0, 300_000],
  );
  await advance(convex, 300_000);
  ({ sweep } = await state(convex));
  assert.deepEqual([sweep!.phase, sweep!.error], ['idle', undefined]);

  provider.set(detail(7, 'Not mine', { athlete: { id: 43 }, manual: true }));
  await advance(convex, SWEEP_INTERVAL_MS);
  const after = await state(convex);
  assert.deepEqual(provider.reads, []);
  assert.equal(after.jobs.length, 0);
  assert.deepEqual(
    [after.sweep!.phase, after.sweep!.error, after.sweep!.attempt],
    ['scanning', 'foreign_activity', 1],
  );
});

void test('a sweep stops with its writer and goes on when Convex writes again', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(manual(7, 'Missed'));
  provider.during = () =>
    convex.mutation(internal.owners.setWriter, {
      ...actor,
      writer: 'handoff',
      expectedEpoch: 1,
    });

  await advance(convex, SWEEP_INTERVAL_MS);
  let { jobs, sweep } = await state(convex);
  // The page was read, but nothing was recorded from it.
  assert.deepEqual(provider.lists, ['page 1', 'page 1']);
  assert.equal(jobs.length, 0);
  assert.deepEqual(
    [sweep!.phase, sweep!.error, sweep!.lease, sweep!.page],
    ['scanning', 'fenced', undefined, 1],
  );
  await advance(convex, SWEEP_INTERVAL_MS);
  assert.equal(provider.lists.length, 2);

  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'convex',
    expectedEpoch: 2,
  });
  await settle(convex);
  ({ jobs, sweep } = await state(convex));
  assert.deepEqual(provider.reads, ['activity 7']);
  assert.equal(sweep!.phase, 'idle');
  assert.equal(jobs[0]!.status, 'idle');
});

void test('a lost sweep run is retried and its late page is ignored', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(manual(7, 'Missed'));
  const ownerId = (await state(convex)).sweep!.owner;
  mock.timers.tick(SWEEP_INTERVAL_MS);
  const lost = await convex.mutation(internal.ingestionSweep.claim, {
    owner: ownerId,
  });
  assert.equal(lost?.phase, 'scanning');
  await settle(convex);
  assert.equal(provider.lists.length, 1);

  await advance(convex, LEASE_MS);
  assert.equal((await state(convex)).sweep!.error, 'lease_expired');
  await advance(convex, 60_000);
  assert.equal((await state(convex)).sweep!.phase, 'idle');
  assert.deepEqual(provider.reads, ['activity 7']);

  const late = await convex.mutation(internal.ingestionSweep.applyPage, {
    owner: ownerId,
    claim: lost!.claim,
    page: 1,
    items: [],
  });
  assert.equal(late, null);
  assert.equal((await state(convex)).sweep!.phase, 'idle');
});

void test('old event receipts are removed', async () => {
  fakeProvider();
  const convex = await owner();
  await event(convex, '7');
  await advance(convex, 29 * 86_400_000);
  await event(convex, '8');
  await advance(convex, 2 * 86_400_000);

  assert.equal(
    await convex.mutation(internal.maintenance.expireProviderEvents, {}),
    1,
  );
  const left = await convex.run((ctx) =>
    ctx.db.query('providerEvents').collect(),
  );
  assert.deepEqual(
    left.map((row) => Number(row.activity)),
    [8],
  );
});

const peak: PlaceRow = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Synthetic',
  kinds: ['peak'],
  subtypes: ['peak'],
  location: { longitude: 8.123456789, latitude: 46.987654321 },
  elevationM: 100,
};
const sampled = (data: unknown[]) => ({
  data,
  original_size: data.length,
  resolution: 'high',
  series_type: 'time',
});
/** A short track along a line of latitude through a point. */
const track = (latitude: number, longitude: number) =>
  ({
    latlng: sampled(
      [-0.0001, 0, 0.0001].map((dx) => [latitude, longitude + dx]),
    ),
    time: sampled([0, 10, 20]),
    distance: sampled([0, 10, 20]),
    altitude: sampled([100, 100, 100]),
  }) as RawActivityStreams;
const pastThePeak = track(peak.location.latitude, peak.location.longitude);

const synthetic = createSyntheticCatalogue();
const snapshotId = synthetic.manifest.catalogue_snapshot_id;

/** A rowset of the synthetic catalogue at `revision`, usable once
 * `complete` has run. */
async function rowset(convex: Convex, revision: string, places: PlaceRow[]) {
  const version = versionFor({ snapshotId, revision });
  const dataset = await datasetFor(snapshotId, revision);
  const metadata = await convex.run((ctx) =>
    ctx.storage.store(
      new Blob([
        JSON.stringify({
          manifest: synthetic.manifest,
          coverage: synthetic.coverage,
        }),
      ]),
    ),
  );
  await convex.mutation(internal.places.begin, {
    dataset,
    snapshotId,
    revision,
    count: places.length,
    metadata,
  });
  const { digest } = await convex.mutation(internal.places.importBatch, {
    dataset,
    after: '',
    places,
  });
  const complete = () =>
    convex.mutation(internal.places.complete, { dataset, digest });
  return { identity: catalogueIdentity(version), version, complete };
}

/** An owner whose matching version names a rowset with one peak. */
async function matchingOwner() {
  const version = versionFor({ snapshotId, revision: '7' });
  const convex = await owner({
    catalogue: catalogueIdentity(version),
    matchingVersion: version,
  });
  return { convex, ...(await rowset(convex, '7', [peak])) };
}

void test('a new recording is matched against the owner’s place catalogue', async () => {
  const provider = fakeProvider();
  const { convex, identity, version, complete } = await matchingOwner();
  await complete();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  provider.set(detail(8, 'Elsewhere'));
  provider.record('8', track(46.5, 8.5));

  await ingest(convex, '7', '8');

  let { activities, recordings, changes, jobs } = await state(convex);
  const matchOf = (id: number) =>
    activities.find((row) => Number(row.key) === id)!.projection?.match;
  assert.equal(matchOf(7)?.catalogue, identity);
  assert.deepEqual(
    [
      matchOf(7)!.value.status,
      matchOf(7)!.value.places.length,
      matchOf(7)!.value.matchingVersion,
      matchOf(7)!.value.streamRevision,
    ],
    ['complete', 1, version, '1'],
  );
  assert.equal(
    matchOf(7)!.value.streamGeneration,
    recordings.find(
      (row) =>
        row._id ===
        activities.find((activity) => Number(activity.key) === 7)!.recording,
    )!.generation,
  );
  assert.deepEqual(
    [matchOf(8)!.value.status, matchOf(8)!.value.places.length],
    ['complete', 0],
  );
  // Source, recording and match each tell clients once.
  assert.equal(changes.filter((row) => row.entityId === '7').length, 3);
  assert.deepEqual(
    jobs.map((job) => [job.status, job.phase]),
    [
      ['idle', 'source'],
      ['idle', 'source'],
    ],
  );

  // A new title keeps recording and match; nothing is matched again.
  const before = matchOf(7)!.value.resultRevision;
  provider.set(detail(7, 'Renamed'));
  mock.timers.tick(1000);
  await event(convex, '7', 'update');
  await settle(convex);
  ({ activities, recordings, changes, jobs } = await state(convex));
  assert.equal(matchOf(7)!.value.resultRevision, before);

  // A new recording is matched again, for its own revision.
  provider.set(detail(7, 'Renamed', { distance: 2000 }));
  provider.record('7', track(46.5, 8.5));
  mock.timers.tick(1000);
  await event(convex, '7', 'update');
  await settle(convex);
  ({ activities, recordings, changes, jobs } = await state(convex));
  assert.deepEqual(
    [
      matchOf(7)!.value.streamRevision,
      matchOf(7)!.value.places.length,
      matchOf(7)!.catalogue,
    ],
    ['2', 0, identity],
  );
});

/** The catalogue tiles recorded for each activity's match. */
async function placeTiles(convex: Convex) {
  const tiles = new Map<number, string[]>();
  for (const row of await convex.run((ctx) =>
    ctx.db.query('activityPlaceTiles').collect(),
  ))
    tiles.set(Number(row.activity), [
      ...(tiles.get(Number(row.activity)) ?? []),
      row.tile,
    ]);
  for (const list of tiles.values()) list.sort();
  return tiles;
}

void test('a match records the catalogue tiles it read, and they go with the match', async () => {
  const provider = fakeProvider();
  const { convex, complete } = await matchingOwner();
  await complete();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  provider.set(detail(8, 'Elsewhere'));
  provider.record('8', track(46.5, 8.5));
  await ingest(convex, '7', '8');

  // Each activity has the tiles of its own track, the peak's among them.
  let tiles = await placeTiles(convex);
  const peakTile = `${Math.floor((peak.location.longitude + 180) * 4)},${Math.floor((peak.location.latitude + 90) * 4)}`;
  const elsewhere = tiles.get(8)!;
  assert(tiles.get(7)!.includes(peakTile));
  assert(elsewhere.length > 0 && !elsewhere.includes(peakTile));

  // A new recording drops the tiles with the match until it is matched
  // again, which replaces them.
  let between: Map<number, string[]> | undefined;
  provider.during = async () => {
    // The activity has been read; the samples are next.
    provider.during = async () => {
      between = await placeTiles(convex);
    };
  };
  provider.set(detail(7, 'Past the peak', { distance: 2000 }));
  provider.record('7', track(46.5, 8.5));
  mock.timers.tick(1000);
  await event(convex, '7', 'update');
  await settle(convex);
  assert.equal(between!.get(7), undefined);
  tiles = await placeTiles(convex);
  assert.deepEqual(tiles.get(7), elsewhere);
  assert.deepEqual(tiles.get(8), elsewhere);

  // A deleted activity has none.
  provider.remove('7');
  mock.timers.tick(1000);
  await event(convex, '7', 'delete');
  await settle(convex);
  tiles = await placeTiles(convex);
  assert.deepEqual([...tiles.keys()], [8]);

  // Nor does an erased account.
  await convex.mutation(internal.erasure.start, actor);
  await settle(convex);
  assert.equal((await placeTiles(convex)).size, 0);
});

void test('matches are recounted for libraries from before the counts, while writes go on', async () => {
  const provider = fakeProvider();
  const { convex, complete } = await matchingOwner();
  await complete();
  for (const id of ['7', '8']) {
    provider.set(detail(Number(id), 'Past the peak'));
    provider.record(id, pastThePeak);
  }
  await ingest(convex, '7', '8');
  await convex.run(async (ctx) => {
    const row = (await ctx.db.query('placeMatchCounts').first())!;
    await ctx.db.delete('placeMatchCounts', row._id);
  });
  // Uncounted, not wrong, until the recount.
  provider.set(detail(9, 'Past the peak'));
  provider.record('9', pastThePeak);
  await ingest(convex, '9');
  assert.equal(await matchCounts(convex), null);

  await convex.mutation(internal.placeCounts.rebuild, {});
  // Deleted before the recount reaches it.
  provider.remove('9');
  await convex.mutation(internal.ingestion.apply, {
    scope,
    id: '9',
    dto: null,
  });
  assert.equal((await matchCounts(convex))!.matched, 0);
  await settle(convex);
  const { matched, rebuildAfter } = (await matchCounts(convex))!;
  assert.deepEqual([matched, rebuildAfter], [2, undefined]);
  // Repeating it changes nothing.
  await convex.mutation(internal.placeCounts.rebuild, {});
  await convex.mutation(internal.placeCounts.rebuild, {});
  await settle(convex);
  assert.equal((await matchCounts(convex))!.matched, 2);
});

void test('a match result that started at an older or the same catalogue revision is dropped', async () => {
  const provider = fakeProvider();
  const { convex, complete } = await matchingOwner();
  await complete();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');
  const stored = async () =>
    (await state(convex)).activities[0]!.projection!.match!;
  const first = await stored();
  assert.equal(first.revision, 0);
  const tiles = (await placeTiles(convex)).get(7);
  const { activities, jobs } = await state(convex);
  const { resultRevision: _revision, ...result } = first.value;

  /** A worker's result for activity 7, as if it held the job's lease. */
  const publish = async (revision: number, tiles: string[]) => {
    const claim = jobs[0]!.claims + 1;
    await convex.run((ctx) =>
      ctx.db.patch('ingestionJobs', jobs[0]!._id, {
        claims: claim,
        lease: {
          claim,
          expiresAt: Date.now() + LEASE_MS,
          requested: jobs[0]!.requested,
        },
      }),
    );
    jobs[0]!.claims = claim;
    await convex.mutation(internal.ingestion.matched, {
      job: jobs[0]!._id,
      claim,
      recording: activities[0]!.recording!,
      result,
      revision,
      tiles,
    });
  };

  // The same revision changes nothing: not the match, not its tiles.
  await publish(0, ['1,1']);
  assert.equal(
    (await stored()).value.resultRevision,
    first.value.resultRevision,
  );
  assert.deepEqual((await placeTiles(convex)).get(7), tiles);

  // A newer one replaces both.
  await publish(2, ['1,1']);
  const second = await stored();
  assert.equal(second.revision, 2);
  assert.notEqual(second.value.resultRevision, first.value.resultRevision);
  assert.deepEqual((await placeTiles(convex)).get(7), ['1,1']);

  // An older one is dropped.
  await publish(1, ['2,2']);
  assert.deepEqual(await stored(), second);
  assert.deepEqual((await placeTiles(convex)).get(7), ['1,1']);

  // Tiles that no match can have read are refused.
  await assert.rejects(publish(3, ['x']), /Invalid match tiles/);
  await assert.rejects(
    publish(
      3,
      Array.from({ length: 257 }, (_, x) => `${x},0`),
    ),
    /Invalid match tiles/,
  );
});

void test('a new catalogue moves every library to it and matches every recording again', async () => {
  const provider = fakeProvider();
  const { convex, identity, complete } = await matchingOwner();
  await complete();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  provider.set(detail(8, 'Elsewhere'));
  provider.record('8', track(46.5, 8.5));
  provider.set(detail(9, 'Typed in by hand', { manual: true }));
  provider.noStreams('9');
  await ingest(convex, '7', '8', '9');
  const reads = provider.reads.length;
  const matches = async () => {
    const { activities } = await state(convex);
    return new Map(
      activities.map((row) => [Number(row.key), row.projection?.match]),
    );
  };
  const before = await matches();
  assert.equal(before.get(7)!.catalogue, identity);
  assert.equal(before.get(7)!.value.places[0]!.id, peak.id);

  // The same place under another ID, and one more place on the other track.
  const renamed = { ...peak, id: '22222222-2222-4222-8222-222222222222' };
  const other: PlaceRow = {
    ...peak,
    id: '33333333-3333-4333-8333-333333333333',
    displayName: 'Other',
    location: { longitude: 8.5, latitude: 46.5 },
  };
  const next = await rowset(convex, '8', [renamed, other]);
  // An incomplete rowset is not adopted.
  assert.equal(
    (await convex.action(internal.catalogueWorker.adopt, {})).libraries,
    0,
  );
  await next.complete();
  const feed = async () =>
    (
      await convex.query(internal.sync.read, {
        ...scope,
        operation: { kind: 'head' },
      })
    ).sequence;
  const sequence = await feed();
  const adopted = await convex.action(internal.catalogueWorker.adopt, {});
  assert.deepEqual(adopted, { snapshotId, revision: '8', libraries: 1 });
  const moved = await convex.run((ctx) => ctx.db.query('owners').first());
  assert.deepEqual(
    [moved!.catalogue, moved!.matchingVersion],
    [next.identity, next.version],
  );

  await settle(convex);
  const after = await matches();
  for (const [id, place] of [
    [7, renamed.id],
    [8, other.id],
  ] as const) {
    const match = after.get(id)!;
    assert.equal(match.catalogue, next.identity);
    assert.equal(match.value.matchingVersion, next.version);
    assert.deepEqual(
      match.value.places.map((item) => item.id),
      [place],
    );
  }
  assert.equal((await matchCounts(convex))!.matched, 3);
  // Clients are told; the provider is not asked for anything.
  assert((await feed()) > sequence);
  assert.equal(provider.reads.length, reads);
  const { jobs } = await state(convex);
  assert(jobs.every((job) => job.status === 'idle'));

  // Adopting again changes nothing.
  const settled = await feed();
  assert.equal(
    (await convex.action(internal.catalogueWorker.adopt, {})).libraries,
    0,
  );
  await settle(convex);
  assert.equal(await feed(), settled);

  // An activity that arrives later is matched against the new catalogue.
  provider.set(detail(10, 'Later'));
  provider.record('10', pastThePeak);
  await ingest(convex, '10');
  assert.deepEqual(
    (await matches()).get(10)!.value.places.map((item) => item.id),
    [renamed.id],
  );
});

void test('a catalogue change during a run is matched afterwards without another provider read', async () => {
  const provider = fakeProvider();
  const { convex, complete } = await matchingOwner();
  await complete();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');
  const renamed = { ...peak, id: '22222222-2222-4222-8222-222222222222' };
  const next = await rowset(convex, '8', [renamed]);
  await next.complete();

  // An update is being read from the provider when the catalogue changes
  // and the walk over the library reaches the activity.
  provider.set(detail(7, 'Renamed'));
  const reads = provider.reads.length;
  let marked: boolean | undefined;
  provider.during = async () => {
    await convex.action(internal.catalogueWorker.adopt, {});
    await convex.mutation(internal.catalogue.next, {
      scope,
      catalogue: next.identity,
      writer: 'convex',
    });
    marked = (await state(convex)).jobs[0]!.rematch;
  };
  mock.timers.tick(1000);
  await event(convex, '7', 'update');
  await settle(convex);

  assert.equal(marked, true);
  const { activities, jobs } = await state(convex);
  const match = activities[0]!.projection!.match!;
  assert.equal(activities[0]!.dto!.name, 'Renamed');
  assert.equal(match.catalogue, next.identity);
  assert.deepEqual(
    match.value.places.map((item) => item.id),
    [renamed.id],
  );
  // The update's own read of the activity, and nothing for the rematch.
  assert.deepEqual(provider.reads.slice(reads), ['activity 7']);
  assert.deepEqual(
    jobs.map((job) => [job.status, job.phase, job.rematch, job.requested]),
    [['idle', 'source', undefined, 2]],
  );
});

void test('an adoption that a newer one overtook moves no library back', async () => {
  const convex = convexTest(schema, modules);
  const owners = 33;
  for (let index = 1; index <= owners; index++) {
    const who = { userId: `owner-${index}`, athleteId: String(100 + index) };
    await convex.mutation(internal.owners.provision, {
      ...who,
      epoch: `test-owner-epoch-${String(index).padStart(2, '0')}`,
      backend: 'convex',
      generation: 'test-generation-01',
      catalogue: 'a'.repeat(64),
      matchingVersion: 'b'.repeat(64),
    });
    await convex.mutation(internal.owners.setWriter, {
      ...who,
      writer: 'convex',
      expectedEpoch: 0,
    });
  }
  await settle(convex);
  const on = async () => {
    const rows = await convex.run((ctx) => ctx.db.query('owners').collect());
    return [...new Set(rows.map((row) => row.catalogue))];
  };
  const adopt = (
    target: { identity: string; version: string },
    revision: string,
    cursor?: string,
  ) =>
    convex.mutation(internal.catalogue.adopt, {
      catalogue: target.identity,
      matchingVersion: target.version,
      snapshotId,
      revision,
      cursor,
    });

  // The first adoption moves a page of owners and leaves the rest to a
  // continuation, which has not run when the next catalogue is adopted.
  const first = await rowset(convex, '7', [peak]);
  await first.complete();
  assert.equal(await adopt(first, '7'), 32);
  const second = await rowset(convex, '8', [peak]);
  await second.complete();
  assert.equal(await adopt(second, '8'), 32);
  await settle(convex);
  assert.deepEqual(await on(), [second.identity]);

  // The first adoption's second page, arriving after all of that.
  const { continueCursor } = await convex.run((ctx) =>
    ctx.db.query('owners').paginate({ numItems: 32, cursor: null }),
  );
  assert.equal(await adopt(first, '7', continueCursor), 0);
  await settle(convex);
  assert.deepEqual(await on(), [second.identity]);

  // Nor does an adoption that starts late, for a rowset no longer newest.
  assert.equal(await adopt(first, '7'), 0);
  await settle(convex);
  assert.deepEqual(await on(), [second.identity]);
});

const liveVersion = versionFor(LIVE_CATALOGUE);
let publications = 0;

/** Begin a publication of `places` as the whole live catalogue, under the
 * synthetic manifest of a new snapshot, and write its rows; `complete`
 * finishes it. */
async function beginLive(convex: Convex, places: PlaceRow[]) {
  const artifact = createSyntheticCatalogue({
    dataAsOf: `2026-11-${String(++publications).padStart(2, '0')}T00:00:00Z`,
  });
  const liveSnapshot = artifact.manifest.catalogue_snapshot_id;
  const metadata = await convex.run((ctx) =>
    ctx.storage.store(
      new Blob([
        JSON.stringify({
          manifest: artifact.manifest,
          coverage: artifact.coverage,
        }),
      ]),
    ),
  );
  let setDigest = EMPTY_SET_DIGEST;
  for (const place of places)
    setDigest = addToSetDigest(setDigest, await rowHash(place));
  const current = await convex.query(internal.livePlaces.state, {});
  const begun = await convex.mutation(internal.livePlaces.beginApply, {
    expectCurrent: current?.snapshotId ?? null,
    snapshotId: liveSnapshot,
    metadata,
    count: places.length,
    setDigest,
  });
  assert(begun.ok);
  const keys = new Set(places.map((place) => place.id));
  const deletes = (
    await convex.run((ctx) => ctx.db.query('livePlaces').collect())
  )
    .map((row) => row.key)
    .filter((key) => !keys.has(key));
  await convex.mutation(internal.livePlaces.applyBatch, {
    snapshotId: liveSnapshot,
    upserts: places,
    deletes,
    tiles: [],
  });
  const complete = async () => {
    const completed = await convex.mutation(internal.livePlaces.completeApply, {
      snapshotId: liveSnapshot,
    });
    assert(completed.ok);
    return completed.revision;
  };
  return { snapshotId: liveSnapshot, complete };
}

async function publishLive(convex: Convex, places: PlaceRow[]) {
  const publication = await beginLive(convex, places);
  return { ...publication, revision: await publication.complete() };
}

/** An owner on the live catalogue, as one provisioned after its first
 * publication. */
const liveOwner = () =>
  owner({
    catalogue: catalogueIdentity(liveVersion),
    matchingVersion: liveVersion,
  });

async function matches(convex: Convex) {
  const { activities } = await state(convex);
  return new Map(
    activities.map((row) => [Number(row.key), row.projection?.match]),
  );
}

const other: PlaceRow = {
  ...peak,
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Other',
  location: { longitude: 8.5, latitude: 46.5 },
};

void test('an owner keeps its rowset after the live publication until adoption moves it to the live table', async () => {
  const provider = fakeProvider();
  const { convex, identity, version, complete } = await matchingOwner();
  await complete();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');

  // The live catalogue holds the same place under another ID.
  const renamed = { ...peak, id: '22222222-2222-4222-8222-222222222222' };
  const live = await publishLive(convex, [renamed]);
  await settle(convex);
  // Its walk asks for nothing: a rowset match is never stale by revision.
  assert.deepEqual(
    (await state(convex)).jobs.map((job) => job.claims),
    [1],
  );
  provider.set(detail(8, 'Same track'));
  provider.record('8', pastThePeak);
  await ingest(convex, '8');
  for (const match of (await matches(convex)).values())
    assert.deepEqual(
      [
        match!.catalogue,
        match!.revision,
        match!.value.matchingVersion,
        match!.value.catalogueSnapshotId,
        match!.value.places.map((place) => place.id),
      ],
      [identity, 0, version, snapshotId, [peak.id]],
    );
  const reads = provider.reads.length;

  // Adoption moves the owner to the live table and matches every recording
  // there, which also records its tiles.
  assert.deepEqual(await convex.action(internal.catalogueWorker.adopt, {}), {
    ...LIVE_CATALOGUE,
    libraries: 1,
  });
  const moved = await convex.run((ctx) => ctx.db.query('owners').first());
  assert.deepEqual(
    [moved!.catalogue, moved!.matchingVersion],
    [catalogueIdentity(liveVersion), liveVersion],
  );
  await convex.run(async (ctx) => {
    for (const row of await ctx.db.query('activityPlaceTiles').collect())
      await ctx.db.delete('activityPlaceTiles', row._id);
  });
  await settle(convex);
  for (const match of (await matches(convex)).values())
    assert.deepEqual(
      [
        match!.catalogue,
        match!.revision,
        match!.value.matchingVersion,
        match!.value.catalogueSnapshotId,
        match!.value.places.map((place) => place.id),
      ],
      [
        catalogueIdentity(liveVersion),
        live.revision,
        liveVersion,
        live.snapshotId,
        [renamed.id],
      ],
    );
  assert.deepEqual([...(await placeTiles(convex)).keys()].sort(), [7, 8]);
  assert.equal(provider.reads.length, reads);
});

void test('only activities in changed tiles are matched again, and their old matches stay until then', async () => {
  const provider = fakeProvider();
  const convex = await liveOwner();
  await publishLive(convex, [peak, other]);
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  provider.set(detail(8, 'Past the other'));
  provider.record(
    '8',
    track(other.location.latitude, other.location.longitude),
  );
  await ingest(convex, '7', '8');
  const before = await matches(convex);
  assert.deepEqual([before.get(7)!.revision, before.get(8)!.revision], [1, 1]);
  const claims = async () =>
    new Map(
      (await state(convex)).jobs.map((job) => [
        Number(job.activity),
        job.claims,
      ]),
    );
  const ran = await claims();
  const reads = provider.reads.length;

  // The peak is renamed: only its tile changes.
  const second = await beginLive(convex, [
    { ...peak, displayName: 'Renamed peak' },
    other,
  ]);
  const revision = await second.complete();
  // Until the walk has matched it again, the old match is what clients see.
  assert.deepEqual(await matches(convex), before);
  const published = (await publicationRows(convex)).at(-1)!;
  assert.deepEqual(
    [published.revision, published.tiles, published.tilesDone],
    [revision, 1, 0],
  );

  await settle(convex);
  await advance(convex, 2_000);
  const after = await matches(convex);
  assert.deepEqual(
    [
      after.get(7)!.revision,
      after.get(7)!.value.catalogueSnapshotId,
      after.get(7)!.value.places.map((place) => place.name),
    ],
    [revision, second.snapshotId, ['Renamed peak']],
  );
  assert.notEqual(
    after.get(7)!.value.resultRevision,
    before.get(7)!.value.resultRevision,
  );
  assert.deepEqual(after.get(8), before.get(8));
  const now = await claims();
  assert.deepEqual(
    [now.get(7)! - ran.get(7)!, now.get(8)! - ran.get(8)!],
    [1, 0],
  );
  assert.equal(provider.reads.length, reads);
  const counted = (await matchCounts(convex))!;
  assert.deepEqual(
    [counted.matched, counted.revision, counted.rematched],
    [2, revision, 1],
  );
  const walked = (await publicationRows(convex)).at(-1)!;
  assert.equal(walked.tilesDone, 1);
  assert(walked.walkedAt! >= walked.completedAt!);
  // The walk has consumed the revision's tiles.
  assert.deepEqual(
    await convex.run((ctx) => ctx.db.query('placeTileChanges').collect()),
    [],
  );
});

void test('an activity outside the coverage is matched as uncovered and still records its tiles', async () => {
  const provider = fakeProvider();
  const convex = await liveOwner();
  await publishLive(convex, [peak]);
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  // Far outside the synthetic coverage.
  provider.set(detail(9, 'Elsewhere entirely'));
  provider.record('9', track(35.1, 139.1));
  await ingest(convex, '7', '9');

  const found = await matches(convex);
  assert.deepEqual(
    [found.get(7)!.value.status, found.get(9)!.value.status],
    ['complete', 'uncovered'],
  );
  // Its tiles are the demand for a region that covers it, and what a later
  // coverage change there matches again.
  const far = `${Math.floor((139.1 + 180) * 4)},${Math.floor((35.1 + 90) * 4)}`;
  const tiles = await placeTiles(convex);
  assert.deepEqual(tiles.get(9), [far]);
  const demand = await convex.query(internal.livePlaces.demandTiles, {
    cursor: null,
  });
  assert.deepEqual(
    demand.page.find((entry) => entry.tile === far),
    { tile: far, activities: 1 },
  );
});

void test('a match that overlapped an apply is matched again', async () => {
  const provider = fakeProvider();
  const convex = await liveOwner();
  await publishLive(convex, [peak]);

  // Activity 7 is matched while the next publication's rows are written:
  // it reads them, at the revision current when it started.
  const second = await beginLive(convex, [
    { ...peak, displayName: 'Renamed peak' },
  ]);
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');
  let match = (await matches(convex)).get(7)!;
  assert.deepEqual(
    [match.revision, match.value.places.map((place) => place.name)],
    [1, ['Renamed peak']],
  );
  const revision = await second.complete();
  await settle(convex);
  await advance(convex, 2_000);
  match = (await matches(convex)).get(7)!;
  assert.deepEqual(
    [match.revision, match.value.catalogueSnapshotId],
    [revision, second.snapshotId],
  );

  // A result that started before a publication completed, and arrives
  // after its walk passed, is matched again too.
  const third = await publishLive(convex, [
    { ...peak, displayName: 'Renamed peak' },
    other,
  ]);
  await settle(convex);
  const { jobs, activities } = await state(convex);
  const { resultRevision: _revision, ...result } = match.value;
  const claim = jobs[0]!.claims + 1;
  await convex.run((ctx) =>
    ctx.db.patch('ingestionJobs', jobs[0]!._id, {
      claims: claim,
      lease: {
        claim,
        expiresAt: Date.now() + LEASE_MS,
        requested: jobs[0]!.requested,
      },
    }),
  );
  await convex.mutation(internal.ingestion.matched, {
    job: jobs[0]!._id,
    claim,
    recording: activities[0]!.recording!,
    result,
    revision,
    tiles: [],
  });
  await settle(convex);
  match = (await matches(convex)).get(7)!;
  assert.equal(match.revision, third.revision);
});

void test('a match whose catalogue metadata a publication replaced meanwhile is retried', async () => {
  const provider = fakeProvider();
  const convex = await liveOwner();
  await publishLive(convex, [peak]);
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');
  const { activities } = await state(convex);
  const row = activities[0]!;
  await convex.run(async (ctx) => {
    await ctx.db.patch('activities', row._id, {
      projection: { ...row.projection!, match: undefined },
    });
    const counts = (await ctx.db.query('placeMatchCounts').first())!;
    await ctx.db.patch('placeMatchCounts', counts._id, { matched: 0 });
  });

  // The worker has its step and reads the recording when the next
  // publication completes and deletes the metadata the step names.
  let next: Awaited<ReturnType<typeof publishLive>> | undefined;
  const read = Blob.prototype.arrayBuffer;
  mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
    Blob.prototype.arrayBuffer = read;
    next = await publishLive(convex, [{ ...peak, displayName: 'Renamed' }]);
    return read.call(this);
  });
  await convex.run((ctx) => requestMatch(ctx, row.owner, row.key));
  await settle(convex);
  assert(next);
  let { jobs } = await state(convex);
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.phase, jobs[0]!.error],
    ['queued', 'match', 'Catalogue metadata missing'],
  );
  assert.equal((await matches(convex)).get(7), undefined);

  // The retry reads the new publication.
  await advance(convex, 60_000);
  const match = (await matches(convex)).get(7)!;
  assert.deepEqual(
    [match.revision, match.value.places.map((place) => place.name)],
    [next.revision, ['Renamed']],
  );
  ({ jobs } = await state(convex));
  assert.equal(jobs[0]!.status, 'idle');
});

void test('dropRowsets removes rowsets with their files, and only after the cutover', async () => {
  const provider = fakeProvider();
  const { convex, complete } = await matchingOwner();
  await complete();
  // More rows than one step deletes.
  const dataset = await datasetFor(snapshotId, '7');
  await convex.run(async (ctx) => {
    for (let index = 0; index < 1100; index++)
      await ctx.db.insert('places', {
        dataset,
        key: `extra-${index}`,
        tile: '0,0',
        place: peak,
      });
  });
  const files = () =>
    convex.run(async (ctx) =>
      (await ctx.db.system.query('_storage').collect()).map((file) => file._id),
    );
  const rowsetFile = (await convex.run((ctx) =>
    ctx.db.query('placeCatalogues').first(),
  ))!.metadata;
  const drop = () => convex.mutation(internal.places.dropRowsets, {});

  // Before the live catalogue, and before libraries move to it, matching
  // still needs the rowsets.
  assert.deepEqual(await drop(), {
    ok: false,
    reason: 'no_live_catalogue',
  });
  await publishLive(convex, [peak]);
  await settle(convex);
  assert.deepEqual(await drop(), { ok: false, reason: 'not_adopted' });
  await convex.action(internal.catalogueWorker.adopt, {});
  await settle(convex);

  assert.deepEqual(await drop(), {
    ok: true,
    places: 1024,
    catalogues: 0,
    more: true,
  });
  await settle(convex);
  const left = await convex.run(async (ctx) => ({
    places: (await ctx.db.query('places').collect()).length,
    catalogues: (await ctx.db.query('placeCatalogues').collect()).length,
  }));
  assert.deepEqual(left, { places: 0, catalogues: 0 });
  assert(!(await files()).includes(rowsetFile));
  const liveFile = (await convex.run((ctx) =>
    ctx.db.query('placeCatalogueState').unique(),
  ))!.metadata!;
  assert((await files()).includes(liveFile));
  assert.deepEqual(await drop(), {
    ok: true,
    places: 0,
    catalogues: 0,
    more: false,
  });

  // Matching goes on from the live table.
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');
  assert.equal((await matches(convex)).get(7)!.value.places[0]!.id, peak.id);
});

void test('the re-match walk continues within a tile, leaves pending tiles alone and is harmless twice', async () => {
  const provider = fakeProvider();
  const convex = await liveOwner();
  await publishLive(convex, [peak]);
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  await ingest(convex, '7');
  const { activities, jobs } = await state(convex);
  const tile = tileOf(peak.location);
  // More activities in the peak's tile than one step looks at, ahead of 7.
  await convex.run(async (ctx) => {
    for (let index = 0; index < 40; index++)
      await ctx.db.insert('activityPlaceTiles', {
        owner: activities[0]!.owner,
        activity: `000000000000000000000${String(index).padStart(2, '0')}`,
        tile,
      });
  });
  const walk = (revision: number) =>
    convex.mutation(internal.catalogue.rematchTiles, { revision });
  const left = (revision: number) =>
    convex.run(async (ctx) =>
      (
        await ctx.db
          .query('placeTileChanges')
          .withIndex('by_revision_tile', (q) => q.eq('revision', revision))
          .collect()
      ).map((row) => row.tile),
    );

  // A pending revision is not walked.
  const second = await beginLive(convex, [
    { ...peak, displayName: 'Renamed peak' },
  ]);
  assert.deepEqual(await walk(2), { done: true });
  assert.deepEqual(await left(2), [tile]);
  const revision = await second.complete();

  // A step looks at a page of the tile and keeps it; a second walk runs
  // alongside the one the completion started.
  assert.deepEqual(await walk(revision), { done: false });
  assert.deepEqual(await left(revision), [tile]);
  assert.equal((await state(convex)).jobs[0]!.claims, jobs[0]!.claims);
  await settle(convex);
  await advance(convex, 2_000);
  await advance(convex, 2_000);
  assert.deepEqual(await left(revision), []);
  const match = (await matches(convex)).get(7)!;
  assert.equal(match.revision, revision);
  const { tiles, tilesDone } = (await publicationRows(convex)).at(-1)!;
  assert.deepEqual([tiles, tilesDone], [1, 1]);
  assert.equal((await matchCounts(convex))!.rematched, 1);
  // Matched once, however many walks asked.
  assert.equal((await state(convex)).jobs[0]!.claims, jobs[0]!.claims + 1);

  // An owner Convex does not ingest for is skipped.
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'handoff',
    expectedEpoch: 1,
  });
  await publishLive(convex, [{ ...peak, displayName: 'Again' }]);
  await settle(convex);
  await advance(convex, 2_000);
  assert.equal((await matches(convex)).get(7)!.revision, revision);
  assert.equal((await state(convex)).jobs[0]!.status, 'idle');
});

void test('a match is not published after a handoff or by a worker that lost the job', async () => {
  const provider = fakeProvider();
  const { convex, complete } = await matchingOwner();
  provider.set(detail(7, 'Past the peak'));
  provider.record('7', pastThePeak);
  // The rowset is not complete yet: recorded, but not matched.
  await event(convex, '7');
  await settle(convex);
  let { activities, recordings, jobs } = await state(convex);
  assert.equal(activities[0]!.projection?.match, undefined);
  assert.equal(jobs[0]!.status, 'idle');
  await complete();

  // A second activity on the same track gives a result to publish.
  provider.set(detail(9, 'Same track'));
  provider.record('9', pastThePeak);
  await event(convex, '9');
  await settle(convex);
  ({ activities, recordings, jobs } = await state(convex));
  const other = activities.find((row) => Number(row.key) === 9)!;
  const seven = activities.find((row) => Number(row.key) === 7)!;
  const recording = recordings.find((row) => row._id === seven.recording)!;
  const { resultRevision: _revision, ...value } =
    other.projection!.match!.value;
  const result = {
    ...value,
    activityId: '7',
    streamGeneration: recording.generation,
    streamRevision: recording.revision,
  };

  // A worker takes activity 7 as far as its match step.
  const job = jobs.find((row) => Number(row.activity) === 7)!._id;
  await event(convex, '7', 'update');
  const source = await convex.mutation(internal.ingestion.claim, { job });
  const step = await convex.mutation(internal.ingestion.publishSource, {
    job,
    claim: source!.claim,
    dto: seven.dto!,
    photos: [],
  });
  assert.equal(step?.phase, 'match');
  await settle(convex);

  // The owner is handed off before the worker publishes.
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'handoff',
    expectedEpoch: 1,
  });
  const publish = () =>
    convex.mutation(internal.ingestion.matched, {
      job,
      claim: source!.claim,
      recording: recording._id,
      result,
      revision: 0,
      tiles: [],
    });
  await assert.rejects(publish(), /written by another store/);
  const unmatched = async () =>
    (await state(convex)).activities.find((row) => Number(row.key) === 7)!
      .projection?.match;
  assert.equal(await unmatched(), undefined);

  // Convex writes again; the lost run is recovered and the job matches.
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'convex',
    expectedEpoch: 2,
  });
  await advance(convex, LEASE_MS);
  await advance(convex, 60_000);
  const matched = await unmatched();
  assert.equal(matched?.value.places.length, 1);

  // The first worker's result arrives late and changes nothing.
  await publish();
  assert.equal(
    (await unmatched())?.value.resultRevision,
    matched!.value.resultRevision,
  );
  assert.deepEqual(
    provider.reads.filter((read) => read.startsWith('streams')),
    ['streams 7', 'streams 9'],
  );
});

void test('erasing an account fences it at once and removes everything it had here', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Morning ride'), ['p1', 'p2']);
  provider.set(detail(8, 'Evening ride'));
  await ingest(convex, '7', '8');
  await convex.mutation(internal.shares.create, {
    scope,
    tokenHash: 'h'.repeat(43),
    expiresAt: Date.now() + 60 * 60_000,
    fields: { showRouteEnds: false },
    activityIds: ['7'],
  });
  // Another account, which must not be touched.
  const other = {
    userId: 'other',
    athleteId: '43',
    epoch: 'other-owner-epoch-01',
  };
  await convex.mutation(internal.owners.provision, {
    ...other,
    backend: 'convex',
    generation: 'other-generation-01',
    catalogue: 'a'.repeat(64),
    matchingVersion: 'b'.repeat(64),
  });
  const counts = () =>
    convex.run(async (ctx) => {
      const tables = [
        'owners',
        'ownerHeads',
        'ownerStats',
        'placeMatchCounts',
        'ownerEpochs',
        'activities',
        'recordings',
        'photos',
        'photoSets',
        'changes',
        'ingestionJobs',
        'ingestionSweeps',
        'providerEvents',
        'shareLinks',
      ] as const;
      const result: Record<string, number> = {
        files: (await ctx.db.system.query('_storage').collect()).length,
      };
      for (const table of tables)
        result[table] = (await ctx.db.query(table).collect()).length;
      return result;
    });
  const before = await counts();
  assert.deepEqual(
    [before.activities, before.recordings, before.files, before.photos],
    [2, 2, 2, 2],
  );
  assert.deepEqual([before.owners, before.shareLinks], [2, 1]);

  // An unknown user has nothing to erase; the wrong athlete is refused.
  assert.equal(
    await convex.mutation(internal.erasure.start, {
      userId: 'nobody',
      athleteId: '1',
    }),
    false,
  );
  await assert.rejects(
    convex.mutation(internal.erasure.start, { ...actor, athleteId: '43' }),
  );
  assert.deepEqual(await counts(), before);

  assert.equal(await convex.mutation(internal.erasure.start, actor), true);
  // Before a single document is deleted, nothing works for the account.
  await assert.rejects(event(convex, '7', 'update'));
  await assert.rejects(
    convex.mutation(internal.ingestion.apply, {
      scope,
      id: '7',
      dto: null,
    }),
  );
  const reads = provider.reads.length;

  await settle(convex);
  await advance(convex, 7 * 24 * 60 * 60_000);

  const after = await counts();
  assert.deepEqual(after, {
    ...Object.fromEntries(Object.keys(before).map((table) => [table, 0])),
    owners: 1,
    ownerHeads: 1,
    ownerStats: 1,
    placeMatchCounts: 1,
    ownerEpochs: 1,
  });
  assert.equal(
    await convex.query(internal.erasure.status, { userId: actor.userId }),
    null,
  );
  assert.deepEqual(
    await convex.query(internal.erasure.status, { userId: 'other' }),
    { revoked: false },
  );
  // No job or sweep of the erased account asked the provider for anything.
  assert.equal(provider.reads.length, reads);

  // The same person can start again from nothing.
  await convex.mutation(internal.owners.provision, {
    ...scope,
    epoch: 'test-owner-epoch-02',
    backend: 'convex',
    generation: 'test-generation-02',
    catalogue: 'a'.repeat(64),
    matchingVersion: 'b'.repeat(64),
  });
  assert.equal((await counts()).owners, 2);
});

void test('a sweep finishes activities that were copied incomplete, a bounded number at a time', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  const count = CONFIRM_LIMIT + 2;
  for (let id = 1; id <= count; id++) {
    provider.set(manual(id, `Ride ${id}`));
    await ingest(convex, String(id));
  }
  // As the mirror copies an activity Postgres had only as a list entry:
  // never read in full.
  await convex.run(async (ctx) => {
    for (const row of await ctx.db.query('activities').collect())
      await ctx.db.patch('activities', row._id, {
        dto: { ...row.dto!, geometry_state: 'summary' },
      });
  });
  const summaryOnly = async () =>
    (await state(convex)).activities.filter(
      (row) => row.dto?.geometry_state !== 'detailed',
    ).length;
  assert.equal(await summaryOnly(), count);
  const before = provider.reads.length;

  // The list agrees with what is stored, so the scan asks for nothing; the
  // walk that follows asks for the incomplete ones.
  await advance(convex, SWEEP_INTERVAL_MS);
  assert.equal(provider.reads.length - before, CONFIRM_LIMIT);
  assert.equal((await state(convex)).sweep!.phase, 'confirming');
  assert.equal(await summaryOnly(), 2);
  await advance(convex, CONFIRM_INTERVAL_MS);
  assert.equal(provider.reads.length - before, count);
  assert.equal(await summaryOnly(), 0);

  const status = (await convex.query(internal.sync.read, {
    ...scope,
    operation: { kind: 'statusSummary' },
  })) as {
    counts: Record<string, number>;
    active: boolean;
    sweep: { phase: string } | null;
  };
  assert.deepEqual(
    [
      status.counts.total,
      status.counts.runnable,
      status.counts.withoutData,
      status.active,
      status.sweep?.phase,
    ],
    [count, 0, count, true, 'idle'],
  );

  // Complete now: the next sweep reads the list and nothing else.
  await advance(convex, SWEEP_INTERVAL_MS);
  assert.equal(provider.reads.length - before, count);
});

void test('the import command starts the sweep now, but not twice in a row', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(manual(7, 'Missed'));
  // The first sweep finished at the handoff; the next is days away.
  assert.equal(provider.lists.length, 1);
  const now = () =>
    convex.mutation(internal.ingestionSweep.requestNow, { scope });

  // Right after a sweep there is nothing new to find.
  assert.equal(await now(), false);
  await advance(convex, 10 * 60_000);
  assert.equal(provider.lists.length, 1);

  // Settings may ask only an hour after the last sweep; the first fetch
  // after sign-up only five minutes after.
  const explicit = () =>
    convex.mutation(internal.ingestionSweep.requestNow, {
      scope,
      explicit: true,
    });
  assert.equal(await explicit(), false);
  assert.notEqual(
    (
      await convex.query(internal.ingestionSweep.status, {
        userId: scope.userId,
      })
    )?.requestableAt,
    null,
  );
  await advance(convex, EXPLICIT_REQUEST_COOLDOWN_MS);
  assert.equal(
    (
      await convex.query(internal.ingestionSweep.status, {
        userId: scope.userId,
      })
    )?.requestableAt,
    null,
  );
  assert.equal(await explicit(), true);
  assert.equal(await explicit(), false);
  await settle(convex);
  assert.equal(provider.lists.length, 3);
  await advance(convex, 10 * 60_000);

  assert.equal(await now(), true);
  // Asked again before it has run: one sweep, not two.
  assert.equal(await now(), false);
  await settle(convex);
  assert.deepEqual(provider.reads, ['activity 7']);
  assert.equal(provider.lists.length, 5);
  assert.equal((await state(convex)).sweep!.phase, 'idle');

  // Not for an owner another store writes.
  await convex.mutation(internal.owners.setWriter, {
    ...actor,
    writer: 'handoff',
    expectedEpoch: 1,
  });
  await assert.rejects(now());
});

void test('a new library appears from the list at once and is completed newest first, a bounded number at a time', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  // The account's whole history at the provider; nothing here yet.
  const count = CONFIRM_LIMIT + 5;
  for (let id = 1; id <= count; id++) provider.set(manual(id, `Ride ${id}`));
  await advance(convex, 10 * 60_000);
  assert.equal(
    await convex.mutation(internal.ingestionSweep.requestNow, { scope }),
    true,
  );
  await settle(convex);

  let { activities, changes, sweep } = await state(convex);
  // Every activity is in the library after the scan, from the list alone.
  assert.equal(activities.length, count);
  assert.equal(
    changes.filter((row) => row.entityType === 'activity').length >= count,
    true,
  );
  // Only the newest were read in full so far.
  const read = provider.reads.map((entry) => Number(entry.split(' ')[1]));
  assert.equal(read.length, CONFIRM_LIMIT);
  assert.deepEqual(
    [...read].sort((a, b) => b - a),
    Array.from({ length: CONFIRM_LIMIT }, (_, index) => count - index),
  );
  const summaryOnly = () =>
    activities
      .filter((row) => row.dto?.geometry_state === 'summary')
      .map((row) => Number(row.key))
      .sort((a, b) => a - b);
  assert.deepEqual(summaryOnly(), [1, 2, 3, 4, 5]);
  assert.equal(sweep!.phase, 'confirming');
  assert.equal(
    activities.find((row) => Number(row.key) === 1)!.dto?.name,
    'Ride 1',
  );

  await advance(convex, CONFIRM_INTERVAL_MS);
  ({ activities, changes, sweep } = await state(convex));
  assert.equal(provider.reads.length, count);
  assert.deepEqual(summaryOnly(), []);
  assert.equal(sweep!.phase, 'idle');
});

void test('an explicit import retries a repaired gateway configuration without waiting for its backoff', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(manual(7, 'Waiting for configuration'));
  await convex.run(async (ctx) => {
    const sweep = await ctx.db.query('ingestionSweeps').first();
    await ctx.db.patch('ingestionSweeps', sweep!._id, {
      phase: 'scanning',
      page: 1,
      error: 'The provider gateway is not configured',
      attempt: 10,
      dueAt: Date.now() + 6 * 60 * 60_000,
    });
  });
  assert.equal(
    await convex.mutation(internal.ingestionSweep.requestNow, { scope }),
    true,
  );
  assert.equal(
    await convex.mutation(internal.ingestionSweep.requestNow, { scope }),
    false,
  );
  await settle(convex);
  assert.equal((await state(convex)).activities.length, 1);
});

void test('an explicit import never bypasses provider rate limits or rejected credentials', async () => {
  fakeProvider();
  const convex = await owner();
  for (const error of ['rate_limited', 'credentials_rejected']) {
    const dueAt = Date.now() + 60_000;
    await convex.run(async (ctx) => {
      const sweep = await ctx.db.query('ingestionSweeps').first();
      await ctx.db.patch('ingestionSweeps', sweep!._id, {
        phase: 'scanning',
        page: 1,
        error,
        dueAt,
      });
    });
    assert.equal(
      await convex.mutation(internal.ingestionSweep.requestNow, { scope }),
      false,
    );
    assert.equal((await state(convex)).sweep!.dueAt, dueAt);
  }
});
