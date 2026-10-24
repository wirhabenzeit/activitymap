import assert from 'node:assert/strict';

import test from 'node:test';

import { createSyntheticCatalogue } from '~/server/places/catalogue.fixture';
import { SERVER_MATCHER_POLICY } from '~/server/places/matching-version';
import {
  type PlaceQueryWindow,
  placeQueryWindows,
} from '~/server/places/query-windows';
import { prepareTrack } from '~/server/places/track-sections';
import type {
  MatchingCandidate,
  PlaceMatchingRepository,
} from '~/server/repositories/place-matching';

import {
  PLACE_MATCHING_GROUP_ACTIVITIES,
  processPlaceMatching,
} from './place-matching';

const catalogue = createSyntheticCatalogue();
const snapshot = { catalogue, revision: '1', places: [] };
const candidate: MatchingCandidate = {
  activityId: '1',
  userId: 'owner',
  athleteId: 123,
  generation: 'g',
  revision: '1',
  sourceVersion: 'source',
};
function fixture() {
  const calls: string[] = [];
  const repository: PlaceMatchingRepository = {
    acquire: async () => {
      calls.push('acquire');
      return 'token';
    },
    release: async () => {
      calls.push('release');
    },
    catalogue: async () => ({
      snapshotId: catalogue.manifest.catalogue_snapshot_id,
      revision: '1',
    }),
    candidates: async () => [candidate],
    readInput: async () => ({ generation: 'g', revision: '1', payload: {} }),
    commit: async (_token, _catalogue, _candidate, result) => {
      calls.push(result ? result.status : 'failed');
      return true;
    },
    read: async () => {
      throw new Error('unused');
    },
    sync: async () => {
      throw new Error('unused');
    },
    version: async () => {
      throw new Error('unused');
    },
  };
  return {
    repository,
    calls,
    loadSnapshot: async () => {
      calls.push('load');
      return snapshot;
    },
  };
}
void test('busy and empty cycles never load the place catalogue', async () => {
  for (const busy of [true, false]) {
    const f = fixture();
    if (busy) f.repository.acquire = async () => null;
    else f.repository.candidates = async () => [];
    const result = await processPlaceMatching(f);
    assert.equal(result.stopReason, busy ? 'busy' : 'complete');
    assert(!f.calls.includes('load'));
    assert.equal(f.calls.includes('release'), !busy);
  }
});
void test('bounded runs pin one snapshot, persist empty checks and release the lease', async () => {
  const f = fixture();
  f.repository.candidates = async () => [
    candidate,
    { ...candidate, activityId: '2' },
  ];
  const result = await processPlaceMatching({ ...f, activityLimit: 2 });
  assert.equal(result.saved, 2);
  assert.equal(result.stopReason, 'batch_limit');
  assert.deepEqual(f.calls, [
    'acquire',
    'load',
    'missing_streams',
    'missing_streams',
    'release',
  ]);
});
void test('deadline leaves unfinished activities eligible and always releases the lease', async () => {
  const f = fixture();
  let now = 0;
  f.repository.readInput = async () => {
    now = 100;
    return { generation: 'g', revision: '1', payload: {} };
  };
  const result = await processPlaceMatching({
    ...f,
    clock: () => now,
    timeMs: 50,
  });
  assert.equal(result.saved, 0);
  assert.equal(result.stopReason, 'deadline');
  assert.equal(result.elapsedMs, 100);
  assert.equal(f.calls.at(-1), 'release');
});
void test('input changes fence a batch; missing streams skip locally and failures back off', async () => {
  const changed = fixture();
  changed.loadSnapshot = async () => ({ ...snapshot, revision: '2' });
  assert.equal(
    (await processPlaceMatching(changed)).stopReason,
    'inputs_changed',
  );
  const missing = fixture();
  missing.repository.readInput = async () => null;
  assert.equal((await processPlaceMatching(missing)).superseded, 1);
  assert(!missing.calls.includes('missing_streams'));
  const failed = fixture();
  failed.repository.readInput = async () => {
    throw new Error('temporary storage failure');
  };
  assert.equal((await processPlaceMatching(failed)).failed, 1);
  assert(failed.calls.includes('failed'));
  assert.equal(failed.calls.at(-1), 'release');
});

void test('each bounded group shares one scoped catalogue and track inputs are read once', async () => {
  const f = fixture();
  const count = PLACE_MATCHING_GROUP_ACTIVITIES + 2;
  const candidates = Array.from({ length: count }, (_, i) => ({
    ...candidate,
    activityId: String(i + 1),
  }));
  f.repository.candidates = async () => candidates;
  let reads = 0;
  const stream = (data: unknown[]) => ({
    data,
    resolution: 'high',
    series_type: 'time',
    original_size: data.length,
  });
  const payload = {
    latlng: stream([
      [46.9, 8],
      [46.9, 8.0001],
    ]),
    time: stream([0, 10]),
    distance: stream([0, 10]),
  };
  f.repository.readInput = async () => {
    reads++;
    return { generation: 'g', revision: '1', payload };
  };
  const selections: { windows: readonly PlaceQueryWindow[] }[] = [];
  const result = await processPlaceMatching({
    ...f,
    loadSnapshot: async (selection) => {
      selections.push(selection);
      return { ...snapshot, windows: selection.windows };
    },
  });
  assert.equal(reads, count);
  assert.equal(result.saved, count);
  assert.equal(result.groups, 2);
  const expected = placeQueryWindows(
    prepareTrack(payload, SERVER_MATCHER_POLICY).geometry,
    SERVER_MATCHER_POLICY.discoveryRadiusM,
  );
  for (const selection of selections)
    assert.deepEqual(
      selection.windows,
      expected,
      'Repeated routes share deduplicated boxes',
    );
});

void test('the prepared sample budget bounds groups independently of activity count', async () => {
  const f = fixture();
  f.repository.candidates = async () =>
    Array.from({ length: 3 }, (_, i) => ({
      ...candidate,
      activityId: String(i + 1),
    }));
  const payload = {
    latlng: {
      data: Array.from({ length: 60_000 }, () => [46.9, 8]),
      resolution: 'high',
      series_type: 'time',
      original_size: 60_000,
    },
  };
  f.repository.readInput = async () => ({
    generation: 'g',
    revision: '1',
    payload,
  });
  const result = await processPlaceMatching(f);
  assert.equal(result.saved, 3);
  assert.equal(result.groups, 2);
});
