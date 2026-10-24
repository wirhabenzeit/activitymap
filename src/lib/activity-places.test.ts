import assert from 'node:assert/strict';

import test from 'node:test';

import type {
  ActivityPlacesResponse,
  MatchedPlace,
} from '~/contracts/activity-places';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';

import {
  activityPlacesQueryKey,
  elevationPlaceMarkers,
  placesMatchProfile,
  selectedMatchedPlaces,
  syncedActivityPlaces,
} from './activity-places';
import {
  createPlaceRequestQueue,
  fetchActivityPlaces,
} from './activity-places-client';

const place: MatchedPlace = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Peak',
  kinds: ['peak'],
  longitude: 8,
  latitude: 46,
  elevationM: 150,
  visits: [{ distanceM: 50 }, { distanceM: 150 }, { distanceM: null }],
};
const response = (activityId = '1', userId = 'u'): ActivityPlacesResponse => ({
  userId,
  activityId,
  status: 'complete',
  streamGeneration: 'g',
  streamRevision: '2',
  catalogueSnapshotId: 's',
  matcherVersion: 'm',
  places: [place],
});
void test('selection aggregation deduplicates place identities and drops hidden, old-account and incomplete results', () => {
  const input = [
    response(),
    response('2'),
    response('3'),
    response('1', 'other'),
    { ...response('4'), status: 'partial' as const },
  ];
  const before = structuredClone(input);
  const result = selectedMatchedPlaces(input, 'u', new Set(['1', '2', '4']));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.activityIds, ['1', '2']);
  assert.deepEqual(input, before);
  assert.deepEqual(selectedMatchedPlaces(input, 'u', new Set()), []);
});
void test('profile annotations use the exact stream generation/revision and retain separate repeated visits', () => {
  const metadata = {
    generation: 'g',
    revision: '2',
    state: 'current',
  } as StreamMetadata;
  assert.equal(placesMatchProfile(response(), metadata), true);
  for (const changed of [
    { ...metadata, generation: 'new' },
    { ...metadata, revision: '3' },
    { ...metadata, state: 'stale' as const },
  ])
    assert.equal(placesMatchProfile(response(), changed), false);
  assert.notDeepEqual(
    activityPlacesQueryKey('u', '1', metadata),
    activityPlacesQueryKey('other', '1', metadata),
  );
  assert.notDeepEqual(
    activityPlacesQueryKey('u', '1', metadata),
    activityPlacesQueryKey('u', '1', { ...metadata, revision: '3' }),
  );
  const markers = elevationPlaceMarkers(
    { distance: [0, 100, 200], altitude: [100, 200, 100] },
    [place],
  );
  assert.deepEqual(
    markers.map((m) => [m.distanceM, m.altitudeM, m.visitIndex]),
    [
      [50, 150, 0],
      [150, 150, 1],
    ],
  );
  assert.equal(new Set(markers.map((m) => m.key)).size, 2);
});
void test('endpoint bucket means clamp real endpoint encounters without using the mapped peak elevation', () => {
  const result = elevationPlaceMarkers(
    { distance: [10, 90], altitude: [100, 200] },
    [
      {
        ...place,
        elevationM: 9999,
        visits: [{ distanceM: 0 }, { distanceM: 100 }],
      },
    ],
  );
  assert.deepEqual(
    result.map((m) => [m.distanceM, m.altitudeM]),
    [
      [10, 100],
      [90, 200],
    ],
  );
});
void test('request queue bounds concurrency and cancels queued deselected work before fetch', async () => {
  const run = createPlaceRequestQueue(1);
  let release!: () => void;
  let calls = 0;
  const first = run(new AbortController().signal, async () => {
    calls++;
    await new Promise<void>((resolve) => (release = resolve));
    return 1;
  });
  await Promise.resolve();
  const cancelled = new AbortController();
  const second = run(cancelled.signal, async () => {
    calls++;
    return 2;
  });
  const rejection = assert.rejects(second, { name: 'AbortError' });
  cancelled.abort();
  await rejection;
  const third = run(new AbortController().signal, async () => {
    calls++;
    return 3;
  });
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 1);
  assert.equal(await third, 3);
  assert.equal(calls, 2);
});
void test('client fetch validates actor/activity scope and never accepts a cached public response', async () => {
  for (const wrong of [response('2'), response('1', 'other')])
    await assert.rejects(
      fetchActivityPlaces({
        userId: 'u',
        activityId: '1',
        signal: new AbortController().signal,
        fetchImpl: async () => Response.json(wrong),
      }),
      /account or activity changed/,
    );
  const result = await fetchActivityPlaces({
    userId: 'u',
    activityId: '1',
    signal: new AbortController().signal,
    fetchImpl: async (url, init) => {
      assert.equal(url, '/api/activities/1/places');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'same-origin');
      return Response.json(response());
    },
  });
  assert.deepEqual(result, response());
});

void test('an inspected route moves ahead of the remaining selected-route queue', async () => {
  const run = createPlaceRequestQueue(1);
  let release!: () => void;
  const order: string[] = [];
  const first = run(
    new AbortController().signal,
    async () => {
      await new Promise<void>((resolve) => (release = resolve));
    },
    'running',
  );
  await Promise.resolve();
  const earlier = run(
    new AbortController().signal,
    async () => {
      order.push('earlier');
    },
    'earlier',
  );
  const inspected = run(
    new AbortController().signal,
    async () => {
      order.push('inspected');
    },
    'inspected',
  );
  run.prioritize('inspected');
  release();
  await Promise.all([first, earlier, inspected]);
  assert.deepEqual(order, ['inspected', 'earlier']);
});

void test('synchronized results require the account, activity, global version and current stream inputs', () => {
  const version = 'a'.repeat(64);
  const matches = { ...response(), matchingVersion: version };
  const activity = {
    id: '1',
    placeMatches: matches,
    streams: { generation: 'g', revision: '2', state: 'current' },
  } as ActivityDTO;
  assert.equal(syncedActivityPlaces(activity, 'u', version), matches);
  assert.equal(syncedActivityPlaces(activity, 'other', version), undefined);
  assert.equal(syncedActivityPlaces(activity, 'u', 'b'.repeat(64)), undefined);
  assert.equal(
    syncedActivityPlaces({ ...activity, id: '2' }, 'u', version),
    undefined,
  );
  assert.equal(syncedActivityPlaces(activity, 'u', undefined), undefined);
  for (const streams of [
    { ...activity.streams!, generation: 'new' },
    { ...activity.streams!, revision: '3' },
    { ...activity.streams!, state: 'stale' as const },
  ])
    assert.equal(
      syncedActivityPlaces({ ...activity, streams }, 'u', version),
      undefined,
    );
  assert.deepEqual(
    syncedActivityPlaces(
      { ...activity, placeMatches: { ...matches, places: [] } },
      'u',
      version,
    )?.places,
    [],
  );
});
