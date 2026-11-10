import assert from 'node:assert/strict';

import { convexTest } from 'convex-test';
import test, { mock } from 'node:test';

import {
  type ActivitiesServiceDeps,
  ActivityMutationError,
} from '../../src/server/application/activities';
import {
  type ConvexActivityCommandDeps,
  refreshActivityThroughConvex,
  updateActivityThroughConvex,
} from '../../src/server/application/convex-activity-commands';
import type { Actor } from '../../src/server/auth/actor';
import type { Activity, Photo } from '../../src/server/db/schema';
import { StravaApiError } from '../../src/server/strava/client';
import {
  transformStravaActivity,
  transformStravaPhoto,
} from '../../src/server/strava/transforms';
import type {
  StravaActivity,
  StravaPhoto,
} from '../../src/server/strava/types';
import { convexActivityCommands } from '../../src/server/sync/convex-commands';
import { convexWriteBridge } from '../../src/server/sync/convex-writer';
import { internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { activitySource } from '../ingestion/provider';
import { stravaDetail, stravaPhoto } from './fixtures';

/**
 * Edit and refresh for an account Convex writes for, end to end: the app's
 * command functions, the signed write bridge and backend/convex in
 * convex-test, with a stand-in for the Strava client.
 */

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './activityWrites.ts': () => import('../convex/activityWrites'),
  './bridge.ts': () => import('../convex/bridge'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './http.ts': () => import('../convex/http'),
  './importer.ts': () => import('../convex/importer'),
  './ingestion.ts': () => import('../convex/ingestion'),
  './ingestionSweep.ts': () => import('../convex/ingestionSweep'),
  './ingestionWorker.ts': () => import('../convex/ingestionWorker'),
  './maintenance.ts': () => import('../convex/maintenance'),
  './owners.ts': () => import('../convex/owners'),
  './places.ts': () => import('../convex/places'),
  './providerEvents.ts': () => import('../convex/providerEvents'),
  './recordingWorker.ts': () => import('../convex/recordingWorker'),
  './sync.ts': () => import('../convex/sync'),
};

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
};
const scope = {
  userId: actor.userId,
  athleteId: '42',
  epoch: 'test-owner-epoch-01',
};
const secret = 'f'.repeat(64);
const manual = (id: number, name: string, overrides: object = {}) =>
  stravaDetail(id, name, { manual: true, ...overrides }) as StravaActivity;

/** Scheduled functions are not run: these tests look at what the command
 * itself writes. */
mock.timers.enable({ apis: ['setTimeout'] });

async function setup(t: test.TestContext, writer: 'convex' | 'postgres') {
  const convex = convexTest(schema, modules);
  const env = {
    ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
    ACTIVITYMAP_CONVEX_WRITER_KEY_ID: 'writer',
    ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY: secret,
    ACTIVITYMAP_BRIDGE_WRITER_KEYS: JSON.stringify({ writer: secret }),
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  await convex.mutation(internal.owners.provision, {
    ...scope,
    backend: 'convex',
    generation: 'test-generation-01',
    catalogue: 'a'.repeat(64),
    matchingVersion: 'b'.repeat(64),
  });
  if (writer === 'convex')
    await convex.mutation(internal.owners.setWriter, {
      userId: scope.userId,
      athleteId: scope.athleteId,
      writer,
      expectedEpoch: 0,
    });

  /** Put an activity in the library as its writer would. */
  const seed = (activity: StravaActivity, revision = 1) =>
    convex.mutation(internal.activityWrites.applySource, {
      scope,
      id: String(activity.id),
      generation: 'test-generation-01',
      sourceRevision: revision,
      writer,
      dto: activitySource(
        activity,
        { id: String(activity.id), athleteId: '42' },
        { photosCurrent: true, observedAt: new Date(0) },
      ),
    });

  const strava = {
    updates: [] as { id: number; name?: string }[],
    fetches: [] as number[],
    /** What Strava holds; an absent activity answers "Record Not Found". */
    activities: new Map<number, StravaActivity>(),
    photos: new Map<number, StravaPhoto[]>(),
    photosFail: false,
  };
  const missing = () => new StravaApiError('Record Not Found', 404);
  const deps: ConvexActivityCommandDeps = {
    commands: (owner) =>
      convexActivityCommands(owner, (url, init) =>
        convex.fetch(new URL(String(url)).pathname, init),
      ),
    resolveAccount: (async () => ({
      access_token: 'token',
      accountId: '42',
      revokedAt: null,
      scheduledErasureAt: null,
    })) as unknown as ConvexActivityCommandDeps['resolveAccount'],
    createClient: () => ({
      updateActivity: async (id, data) => {
        strava.updates.push({ id, name: data.name });
        const current = strava.activities.get(id);
        if (!current) throw missing();
        const next = { ...current, ...(data.name && { name: data.name }) };
        strava.activities.set(id, next);
        return next;
      },
    }),
    fetchActivities: (async (input) => {
      const id = input.activityIds![0]!;
      strava.fetches.push(id);
      assert.equal(input.persist, false);
      const current = strava.activities.get(id);
      if (!current) return { activities: [], photos: [], notFoundIds: [id] };
      const complete = !strava.photosFail;
      return {
        activities: [
          {
            ...transformStravaActivity(current, true, {
              photosCurrent: complete,
            }),
            athlete: 42,
          } as Activity,
        ],
        photos: complete
          ? (strava.photos.get(id) ?? []).flatMap(
              (item) => transformStravaPhoto(item, 42) ?? [],
            )
          : ([] as Photo[]),
        notFoundIds: [],
        photoRefreshAuthoritativeIds: complete ? [id] : [],
        photoRefreshFailedIds: complete ? [] : [id],
        photoRefreshFailures: complete
          ? []
          : [{ activityId: id, error: new StravaApiError('down', 503) }],
      };
    }) as NonNullable<ActivitiesServiceDeps['fetchActivities']>,
  };
  const state = () =>
    convex.run(async (ctx) => ({
      activities: await ctx.db.query('activities').collect(),
      photos: await ctx.db.query('photos').collect(),
      changes: await ctx.db.query('changes').collect(),
      jobs: await ctx.db.query('ingestionJobs').collect(),
    }));
  return { convex, seed, strava, deps, state };
}

const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    assert(error instanceof ActivityMutationError, String(error));
    return error;
  }
  assert.fail('The command did not fail');
};

void test('an edit is sent to Strava and its result is written to Convex', async (t) => {
  const { seed, strava, deps, state } = await setup(t, 'convex');
  const original = manual(7, 'Old name');
  strava.activities.set(7, original);
  await seed(original);
  const before = await state();

  const edited = await updateActivityThroughConvex(
    actor,
    { id: 7, name: 'New name' },
    deps,
  );

  assert.deepEqual(strava.updates, [{ id: 7, name: 'New name' }]);
  assert.equal(edited.name, 'New name');
  assert.equal(edited.id, '7');
  const after = await state();
  assert.equal(after.activities[0]!.dto?.name, 'New name');
  assert(
    after.activities[0]!.sourceRevision > before.activities[0]!.sourceRevision,
  );
  assert.equal(after.changes.length, before.changes.length + 1);
  // The edit did not read photos: what was known about them stands.
  assert.equal(edited.photos_state, 'current');
  // A manual activity needs nothing further.
  assert.deepEqual(
    after.jobs.map((job) => job.status),
    ['idle'],
  );
});

void test('a command for an activity outside the library changes nothing at Strava', async (t) => {
  const { strava, deps, state } = await setup(t, 'convex');
  strava.activities.set(8, manual(8, 'Not imported'));

  const edit = await failure(
    updateActivityThroughConvex(actor, { id: 8, name: 'Renamed' }, deps),
  );
  const refresh = await failure(refreshActivityThroughConvex(actor, 8, deps));

  assert.deepEqual(
    [edit.code, edit.status, refresh.code, refresh.status],
    ['activity_unavailable', 404, 'activity_unavailable', 404],
  );
  assert.deepEqual([strava.updates, strava.fetches], [[], []]);
  assert.equal((await state()).activities.length, 0);
});

void test('an activity Strava no longer has is deleted by the command that finds out', async (t) => {
  const { seed, deps, state } = await setup(t, 'convex');
  await seed(manual(7, 'Deleted at Strava'));
  await seed(manual(9, 'Also deleted'));

  const edit = await failure(
    updateActivityThroughConvex(actor, { id: 7, name: 'Renamed' }, deps),
  );
  const refresh = await failure(refreshActivityThroughConvex(actor, 9, deps));

  assert.deepEqual(
    [edit.code, refresh.code],
    ['activity_unavailable', 'activity_unavailable'],
  );
  assert.deepEqual(
    (await state()).activities.map((row) => row.deleted),
    [true, true],
  );
});

void test('Convex refuses a command for an owner it does not write for', async (t) => {
  const { seed, strava, deps, state } = await setup(t, 'postgres');
  const original = manual(7, 'Old name');
  strava.activities.set(7, original);
  await seed(original);

  const edit = await failure(
    updateActivityThroughConvex(actor, { id: 7, name: 'New name' }, deps),
  );

  // Refused before Strava was asked to change anything.
  assert.deepEqual(
    [edit.code, edit.details],
    [
      'local_persistence_failed',
      { upstreamSucceeded: false, recovery: 'reconcile_or_retry_explicitly' },
    ],
  );
  assert.deepEqual(strava.updates, []);
  assert.equal((await state()).activities[0]!.dto?.name, 'Old name');
});

void test('a refresh replaces the activity and a complete photo set, and keeps photos it could not read', async (t) => {
  const { seed, strava, deps, state } = await setup(t, 'convex');
  await seed(manual(7, 'Old name'));
  strava.activities.set(7, manual(7, 'New name', { total_photo_count: 2 }));
  strava.photos.set(7, [stravaPhoto('p1', 7), stravaPhoto('p2', 7)]);

  const complete = await refreshActivityThroughConvex(actor, 7, deps);
  assert.equal(complete.activity.name, 'New name');
  assert.equal(complete.photosStatus, 'complete');
  assert.deepEqual(complete.photos.map((item) => item.unique_id).sort(), [
    'p1',
    'p2',
  ]);
  assert.equal(complete.photosError, null);
  assert.equal((await state()).photos.length, 2);

  // The next refresh cannot read the photos.
  strava.activities.set(7, manual(7, 'Newer name', { total_photo_count: 1 }));
  strava.photos.set(7, [stravaPhoto('p1', 7)]);
  strava.photosFail = true;
  const partial = await refreshActivityThroughConvex(actor, 7, deps);
  assert.equal(partial.activity.name, 'Newer name');
  assert.deepEqual(
    [partial.photosStatus, partial.photos, partial.photosError?.retryable],
    ['partial', [], true],
  );
  const { activities, photos } = await state();
  assert.equal(photos.length, 2);
  // What was known about the photos is not overwritten by a guess.
  assert.equal(activities[0]!.dto?.photos_state, 'current');
});

void test('a job run that read the activity before a command loses to it', async (t) => {
  const { convex, seed, strava, deps, state } = await setup(t, 'convex');
  const original = manual(7, 'Old name');
  strava.activities.set(7, original);
  await seed(original);
  // A provider event starts a job, and a worker claims it.
  await convex.mutation(internal.providerEvents.record, {
    scope,
    events: [{ event: 'e1', activityId: '7', aspect: 'update', eventTime: 1 }],
  });
  const job = (await state()).jobs[0]!._id;
  const step = await convex.mutation(internal.ingestion.claim, { job });
  assert.equal(step?.phase, 'source');

  await updateActivityThroughConvex(actor, { id: 7, name: 'New name' }, deps);

  // The worker publishes what it read before the edit.
  await convex.mutation(internal.ingestion.publishSource, {
    job,
    claim: step!.claim,
    dto: (await state()).activities[0]!.dto && {
      ...(await state()).activities[0]!.dto!,
      name: 'Old name',
    },
    photos: [],
  });
  assert.equal((await state()).activities[0]!.dto?.name, 'New name');
});

void test('a command queues the job when the activity now needs a recording', async (t) => {
  const { seed, strava, deps, state } = await setup(t, 'convex');
  const original = stravaDetail(7, 'With samples') as StravaActivity;
  strava.activities.set(7, original);
  await seed(original);

  await updateActivityThroughConvex(actor, { id: 7, name: 'Renamed' }, deps);

  const { jobs } = await state();
  assert.deepEqual(
    [jobs[0]!.status, jobs[0]!.phase, jobs[0]!.requested],
    ['queued', 'recording', 0],
  );
});

void test('the handoff changes the Convex writer through the bridge, by epoch', async (t) => {
  const { convex, seed, strava, deps } = await setup(t, 'convex');
  const bridge = convexWriteBridge(actor, (url, init) =>
    convex.fetch(new URL(String(url)).pathname, init),
  )!;
  const state = () =>
    bridge.write<{ writer: string; writerEpoch: number }>({ kind: 'state' });
  const set = (writer: string, expectedEpoch: number) =>
    bridge.write<number | null>({ kind: 'setWriter', writer, expectedEpoch });
  assert.deepEqual(
    [(await state()).writer, (await state()).writerEpoch],
    ['convex', 1],
  );

  // An epoch that has moved on changes nothing.
  assert.equal(await set('postgres', 0), null);
  assert.equal((await state()).writer, 'convex');

  assert.equal(await set('handoff', 1), 2);
  assert.deepEqual(
    [(await state()).writer, (await state()).writerEpoch],
    ['handoff', 2],
  );
  // While nobody writes, a command is refused before it reaches Strava.
  const original = manual(7, 'Old name');
  strava.activities.set(7, original);
  await assert.rejects(seed(original));
  await failure(
    updateActivityThroughConvex(actor, { id: 7, name: 'New name' }, deps),
  );
  assert.deepEqual(strava.updates, []);

  assert.equal(await set('postgres', 2), 3);
  assert.equal((await state()).writer, 'postgres');
});
