import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test, { afterEach, beforeEach, mock } from 'node:test';

import { createProviderGatewayHandler } from '../../src/app/api/internal/provider/v1/handler';
import type {
  GatewayFailure,
  GatewayOperation,
} from '../../src/server/provider-gateway/contract';
import type { RawActivityStreams } from '../../src/server/strava/streams';
import { internal } from '../convex/_generated/api';
import { LEASE_MS, MAX_ATTEMPTS } from '../convex/ingestion';
import {
  CONFIRM_INTERVAL_MS,
  CONFIRM_LIMIT,
  SWEEP_INTERVAL_MS,
} from '../convex/ingestionSweep';
import schema from '../convex/schema';

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
  './ingestion.ts': () => import('../convex/ingestion'),
  './ingestionSweep.ts': () => import('../convex/ingestionSweep'),
  './ingestionWorker.ts': () => import('../convex/ingestionWorker'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './providerEvents.ts': () => import('../convex/providerEvents'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
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

function detail(id: number, name: string, overrides: object = {}) {
  return {
    id,
    resource_state: 3,
    athlete: { id: 42 },
    name,
    description: null,
    distance: 1000,
    moving_time: 600,
    elapsed_time: 660,
    total_elevation_gain: 10,
    elev_high: null,
    elev_low: null,
    sport_type: 'Ride',
    start_date: '2026-11-01T08:00:00Z',
    start_date_local: '2026-11-01T09:00:00Z',
    timezone: '(GMT+01:00) Europe/Zurich',
    start_latlng: null,
    end_latlng: null,
    achievement_count: 0,
    kudos_count: 0,
    comment_count: 0,
    athlete_count: 1,
    photo_count: 0,
    total_photo_count: 0,
    map: { id: `a${id}`, polyline: null, summary_polyline: null },
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    flagged: false,
    workout_type: null,
    upload_id: null,
    average_speed: 1.6,
    max_speed: 3,
    has_kudoed: false,
    hide_from_home: false,
    gear_id: null,
    kilojoules: null,
    average_watts: null,
    device_watts: null,
    max_watts: null,
    weighted_average_watts: null,
    calories: null,
    device_name: null,
    pr_count: 0,
    ...overrides,
  };
}

function photo(uniqueId: string, activityId: number) {
  return {
    unique_id: uniqueId,
    activity_id: activityId,
    activity_name: null,
    resource_state: 2,
    caption: null,
    type: 1,
    source: 1,
    post_id: null,
    uploaded_at: null,
    created_at: null,
    urls: { '256': 'https://cdn.test/s.jpg', '5000': 'https://cdn.test/l.jpg' },
    sizes: { '256': [256, 192], '5000': [2048, 1536] },
    default_photo: false,
    location: null,
  };
}

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
    /** Answer the next read (of this kind, if given) with a failure. */
    fail: (failure: GatewayFailure, kind?: GatewayOperation['kind']) =>
      failures.push({ failure, kind }),
    /** Runs once, while the next read is under way: after the provider has
     * decided its answer and before the worker receives it. */
    during: null as null | (() => Promise<unknown>),
  };
  const handler = createProviderGatewayHandler({
    config: () => ({ keys: { k1: secret }, owners: [actor.userId] }),
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
            return streams;
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
}

async function advance(convex: Convex, ms: number) {
  mock.timers.tick(ms);
  await settle(convex);
}

/** An owner that reads from Convex and that Convex writes for. */
async function owner() {
  const convex = convexTest(schema, modules);
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'test-generation-01',
    catalogue: 'a'.repeat(64),
    matchingVersion: 'b'.repeat(64),
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

void test('activities without samples finish without a recording', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  provider.set(detail(7, 'Typed in by hand', { manual: true }));
  provider.set(detail(8, 'No samples'));
  provider.noStreams('8');

  await event(convex, '7');
  await event(convex, '8');
  await settle(convex);

  const { activities, recordings, jobs } = await state(convex);
  // The manual activity is never asked for samples.
  assert.deepEqual(provider.reads.sort(), [
    'activity 7',
    'activity 8',
    'streams 8',
  ]);
  assert.equal(activities.length, 2);
  assert.equal(recordings.length, 0);
  assert.deepEqual(
    jobs.map((job) => job.status),
    ['idle', 'idle'],
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
    await event(convex, String(activity.id));
  }
  await settle(convex);
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

void test('activities missing from the list are confirmed a bounded number at a time', async () => {
  const provider = fakeProvider();
  const convex = await owner();
  const count = CONFIRM_LIMIT + 5;
  for (let id = 1; id <= count; id++) {
    provider.set(manual(id, `Ride ${id}`));
    await event(convex, String(id));
  }
  await settle(convex);
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
    activities.filter((row) => row.deleted).map((row) => Number(row.key)),
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
