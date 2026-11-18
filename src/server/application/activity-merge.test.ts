import assert from 'node:assert/strict';

import { Decoder, Stream } from '@garmin/fitsdk';
import test from 'node:test';

import type { MergeStreams } from '~/server/activity-merge/streams';
import type { Actor } from '~/server/auth/actor';
import type { StravaUpload } from '~/server/strava/client';
import type { StravaActivity } from '~/server/strava/types';

import { ActivityMutationError } from './activities';
import {
  type ActivityMergeDeps,
  buildMergedFile,
  continueMergeUpload,
  duplicateOf,
  mergeActivities,
} from './activity-merge';

const actor: Actor = { userId: 'u1', athleteId: 42, authentication: 'cookie' };

function activity(
  id: number,
  start: string,
  elapsed: number,
  overrides: Partial<StravaActivity> = {},
): StravaActivity {
  return {
    id,
    name: `Part ${id}`,
    description: null,
    sport_type: 'Ride',
    start_date: start,
    start_date_local: start.replace('Z', ''),
    elapsed_time: elapsed,
    moving_time: elapsed,
    distance: elapsed * 5,
    total_elevation_gain: 10,
    manual: false,
    trainer: false,
    private: false,
    start_latlng: [46, 8],
    end_latlng: [46, 8],
    kudos_count: 0,
    comment_count: 0,
    total_photo_count: 0,
    map: {
      id: 'm',
      polyline: null,
      summary_polyline: 'abc',
      resource_state: 2,
    },
    gear_id: 'b1',
    ...overrides,
  } as StravaActivity;
}

function streams(count: number): MergeStreams {
  const time = Array.from({ length: count }, (_, index) => index);
  return {
    time: { data: time },
    distance: { data: time.map((value) => value * 5) },
    latlng: { data: time.map(() => [46, 8] as [number, number]) },
  };
}

function fixture(
  activities: StravaActivity[],
  options: {
    known?: (id: string) => boolean;
    neighbours?: StravaActivity[];
    uploads?: StravaUpload[];
    updateFails?: boolean;
    streams?: (id: string) => MergeStreams;
  } = {},
) {
  const calls: { method: string; args: unknown[] }[] = [];
  const uploads = [...(options.uploads ?? [])];
  let clock = Date.parse('2026-06-02T00:00:00Z');
  const deps: ActivityMergeDeps = {
    resolveAccount: (async () => ({
      access_token: 'token',
      accountId: '42',
      revokedAt: null,
      scheduledErasureAt: null,
    })) as unknown as ActivityMergeDeps['resolveAccount'],
    commands: () => ({
      known: async (id: string) => options.known?.(id) ?? true,
    }),
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
    createClient: () => ({
      getActivity: async (id: number | string) => {
        calls.push({ method: 'getActivity', args: [id] });
        return activities.find((value) => String(value.id) === String(id))!;
      },
      getActivities: async (params) => {
        calls.push({ method: 'getActivities', args: [params] });
        return options.neighbours ?? activities;
      },
      getActivityStreamsForMerge: async (id: string) => {
        calls.push({ method: 'streams', args: [id] });
        return options.streams?.(id) ?? streams(11);
      },
      createUpload: async (input) => {
        calls.push({ method: 'createUpload', args: [input] });
        return {
          id: '900',
          externalId: input.externalId ?? null,
          error: null,
          status: 'Your activity is still being processed.',
          activityId: null,
        };
      },
      getUpload: async (id: string) => {
        calls.push({ method: 'getUpload', args: [id] });
        return (
          uploads.shift() ?? {
            id,
            externalId: null,
            error: null,
            status: 'Your activity is still being processed.',
            activityId: null,
          }
        );
      },
      updateActivity: async (id, data) => {
        calls.push({ method: 'updateActivity', args: [id, data] });
        if (options.updateFails) throw new Error('nope');
        return activities[0]!;
      },
    }),
  };
  return { deps, calls };
}

const parts = [
  activity(2, '2026-06-01T09:00:00Z', 3600),
  activity(1, '2026-06-01T07:00:00Z', 3600),
];
const metadata = {
  name: 'Merged',
  description: 'Both',
  sport_type: 'GravelRide' as const,
  gear_id: 'b1',
};

void test('builds a FIT file from the parts in start order', async () => {
  const { deps, calls } = fixture(parts);
  const file = await buildMergedFile(actor, { activity_ids: ['2', '1'] }, deps);
  assert.equal(file.fileName, 'merged-2026-06-01-1-2.fit');
  assert.deepEqual(
    file.sources.map((source) => source.id),
    [1, 2],
  );
  assert.equal(file.sport, 'Ride');
  // FIT files start with a 14-byte header naming ".FIT".
  assert.equal(new TextDecoder().decode(file.bytes.slice(8, 12)), '.FIT');
  assert.deepEqual(
    calls
      .filter((call) => call.method === 'streams')
      .map((call) => call.args[0]),
    ['1', '2'],
  );
});

void test('refuses activities outside the library before calling Strava', async () => {
  const { deps, calls } = fixture(parts, { known: (id) => id !== '2' });
  await assert.rejects(
    buildMergedFile(actor, { activity_ids: ['1', '2'] }, deps),
    (error) =>
      error instanceof ActivityMutationError &&
      error.code === 'activity_unavailable',
  );
  assert.deepEqual(calls, []);
});

void test('refuses a selection with another activity in between', async () => {
  const { deps } = fixture(parts, {
    neighbours: [...parts, activity(3, '2026-06-01T08:30:00Z', 600)],
  });
  await assert.rejects(
    buildMergedFile(actor, { activity_ids: ['1', '2'] }, deps),
    (error) =>
      error instanceof ActivityMutationError &&
      error.code === 'merge_not_allowed' &&
      error.status === 422 &&
      error.message.includes('between'),
  );
});

void test('uploads, waits for processing and applies the settings', async () => {
  const { deps, calls } = fixture(parts, {
    uploads: [
      {
        id: '900',
        externalId: null,
        error: null,
        status: 'Your activity is ready.',
        activityId: '555',
      },
    ],
  });
  const state = await mergeActivities(
    actor,
    { activity_ids: ['1', '2'], ...metadata },
    deps,
  );
  assert.deepEqual(state, {
    upload_id: '900',
    status: 'ready',
    activity_id: '555',
    error: null,
    duplicate_of: null,
    metadata_applied: true,
  });
  const upload = calls.find((call) => call.method === 'createUpload')!
    .args[0] as { name: string; dataType: string; externalId: string };
  assert.equal(upload.name, 'Merged');
  assert.equal(upload.dataType, 'fit');
  assert.match(upload.externalId, /^activitymap-merge-1-2-\d+$/);
  const update = calls.find((call) => call.method === 'updateActivity')!;
  assert.deepEqual(update.args, [
    555,
    {
      name: 'Merged',
      description: 'Both',
      sport_type: 'GravelRide',
      gear_id: 'b1',
    },
  ]);
});

void test('shifts the whole Strava FIT timeline by a stable offset for the same parts', async () => {
  const { deps, calls } = fixture(parts);
  const request = { activity_ids: ['1', '2'], ...metadata };
  const download = await buildMergedFile(actor, request, deps);
  await mergeActivities(actor, request, { ...deps, processingWaitMs: 0 });
  await mergeActivities(
    actor,
    { ...request, activity_ids: ['2', '1'] },
    {
      ...deps,
      processingWaitMs: 0,
      now: () => new Date('2026-06-03T00:00:00Z'),
    },
  );

  function decode(bytes: Uint8Array) {
    const decoder = new Decoder(Stream.fromByteArray(bytes));
    assert.equal(decoder.checkIntegrity(), true);
    const { messages, errors } = decoder.read({
      convertDateTimesToDates: false,
    });
    assert.deepEqual(errors, []);
    return messages;
  }

  const [upload, retry] = calls
    .filter((call) => call.method === 'createUpload')
    .map((call) => decode((call.args[0] as { file: Uint8Array }).file));
  const original = decode(download.bytes);
  const start = Number(original.sessionMesgs![0]!.startTime);
  assert.equal(start, Date.parse(parts[1]!.start_date) / 1000 - 631_065_600);
  const shiftedStart = Number(upload!.sessionMesgs![0]!.startTime);
  const shift = shiftedStart - start;
  assert.ok(shift >= 5 && shift <= 30);
  assert.equal(retry!.sessionMesgs![0]!.startTime, shiftedStart);

  const timestampFields = ['timestamp', 'startTime', 'localTimestamp'] as const;
  for (const messages of Object.values(upload!) as Partial<
    Record<(typeof timestampFields)[number], number>
  >[][]) {
    for (const message of messages) {
      for (const field of timestampFields) {
        if (message[field] !== undefined) message[field] -= shift;
      }
    }
  }
  // All timings relative to the start, samples and FIT identity are preserved.
  assert.deepEqual(upload, original);
});

void test('a slow upload is reported as processing and can be continued', async () => {
  const slow = fixture(parts);
  const state = await mergeActivities(
    actor,
    { activity_ids: ['1', '2'], ...metadata },
    { ...slow.deps, processingWaitMs: 3000 },
  );
  assert.equal(state.status, 'processing');
  assert.equal(
    slow.calls.some((call) => call.method === 'updateActivity'),
    false,
  );

  const ready = fixture(parts, {
    uploads: [
      {
        id: '900',
        externalId: null,
        error: null,
        status: 'Your activity is ready.',
        activityId: '555',
      },
    ],
    updateFails: true,
  });
  const continued = await continueMergeUpload(
    actor,
    '900',
    metadata,
    ready.deps,
  );
  assert.equal(continued.status, 'ready');
  // The activity exists even when its settings could not be applied.
  assert.equal(continued.metadata_applied, false);
});

void test('a duplicate rejection names the duplicated activity', async () => {
  const { deps } = fixture(parts, {
    uploads: [
      {
        id: '900',
        externalId: null,
        error:
          "merged.fit duplicate of <a href='/activities/12345678' target='_blank'>Part 1</a>",
        status: 'There was an error processing your activity.',
        activityId: null,
      },
    ],
  });
  const state = await mergeActivities(
    actor,
    { activity_ids: ['1', '2'], ...metadata },
    deps,
  );
  assert.equal(state.status, 'failed');
  assert.equal(state.duplicate_of, '12345678');
});

void test('duplicateOf reads both of Strava’s wordings', () => {
  assert.equal(duplicateOf('duplicate of activity 98765432'), '98765432');
  assert.equal(duplicateOf('Improperly formatted data.'), null);
  assert.equal(duplicateOf(null), null);
});

void test('refuses a partially empty recording before uploading anything', async () => {
  for (const emptyId of ['1', '2']) {
    const { deps, calls } = fixture(parts, {
      streams: (id) => streams(id === emptyId ? 0 : 11),
    });
    await assert.rejects(
      mergeActivities(actor, { ...metadata, activity_ids: ['1', '2'] }, deps),
      (error) =>
        error instanceof ActivityMutationError &&
        error.code === 'merge_not_allowed' &&
        error.status === 422 &&
        error.details?.activityId === emptyId,
    );
    assert.equal(
      calls.some((call) => call.method === 'createUpload'),
      false,
    );
  }
});
