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
    readInputs: async (candidates) => ({
      consumed: candidates.length,
      inputs: new Map(
        (
          await Promise.all(
            candidates.map(
              async (candidate) =>
                [
                  candidate.activityId,
                  await repository.readInput(candidate),
                ] as const,
            ),
          )
        ).filter(
          (entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] =>
            entry[1] !== null,
        ),
      ),
    }),
    commitMany: async (token, catalogue, writes) => ({
      committed: (
        await Promise.all(
          writes.map(async (write) =>
            (await repository.commit(
              token,
              catalogue,
              write.candidate,
              write.response,
            ))
              ? write.candidate.activityId
              : null,
          ),
        )
      ).filter((id): id is string => id !== null),
      fenceLost: false,
    }),
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
  await assert.rejects(
    processPlaceMatching(failed),
    /temporary storage failure/,
  );
  assert(
    !failed.calls.includes('failed'),
    'A failed bulk read must not mark unread activities as matching failures',
  );
  assert.equal(failed.calls.at(-1), 'release');
});

void test('each bounded group shares one scoped catalogue and track inputs are read once', async () => {
  const f = fixture();
  const count = PLACE_MATCHING_GROUP_ACTIVITIES + 2;
  const candidates = Array.from({ length: count }, (_, i) => ({
    ...candidate,
    activityId: String(i + 1),
    locationHint: { start: [46.9, 8] },
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
    activityLimit: count,
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

void test('spatial lookahead chooses work beyond the first batch while preserving the work limit and oldest seed', async () => {
  const f = fixture();
  const located = (id: string, longitude: number) => ({
    ...candidate,
    activityId: id,
    locationHint: { start: [47, longitude] },
  });
  const candidates = [
    located('1', 8),
    located('2', 13),
    located('3', 8.001),
    located('4', 8.002),
  ];
  let requested = 0;
  f.repository.candidates = async (_catalogue, limit) => {
    requested = limit;
    return candidates;
  };
  const read: string[] = [];
  f.repository.readInput = async (candidate) => {
    read.push(candidate.activityId);
    return { generation: 'g', revision: '1', payload: {} };
  };
  const result = await processPlaceMatching({ ...f, activityLimit: 3 });
  assert.equal(requested, 12);
  assert.deepEqual(read, ['1', '3', '4']);
  assert.equal(result.selected, 3);
  assert.equal(result.saved, 3);
  assert.equal(result.groups, 1);
  assert.equal(result.stopReason, 'batch_limit');
});

void test('sparse regions share a bounded pull rather than producing singleton queries', async () => {
  const f = fixture();
  f.repository.candidates = async () => [
    { ...candidate, locationHint: { start: [47, 8] } },
    { ...candidate, activityId: '2', locationHint: { start: [52, 13] } },
  ];
  const result = await processPlaceMatching(f);
  assert.equal(result.saved, 2);
  assert.equal(result.groups, 1);
});

void test('all 500 nearby short tracks share one place pull', async () => {
  const f = fixture();
  f.repository.candidates = async () =>
    Array.from({ length: 500 }, (_, i) => ({
      ...candidate,
      activityId: String(i + 1),
      locationHint: { start: [46.9, 8] },
    }));
  const stream = (data: unknown[]) => ({
    data,
    resolution: 'high',
    series_type: 'time',
    original_size: data.length,
  });
  f.repository.readInput = async () => ({
    generation: 'g',
    revision: '1',
    payload: {
      latlng: stream([
        [46.9, 8],
        [46.9, 8.0001],
      ]),
      time: stream([0, 10]),
      distance: stream([0, 10]),
    },
  });
  const result = await processPlaceMatching(f);
  assert.equal(result.saved, 500);
  assert.equal(result.groups, 1);
  assert.equal(f.calls.filter((call) => call === 'load').length, 1);
});

void test('larger groups stop when nearby candidates run out', async () => {
  const f = fixture();
  f.repository.candidates = async () => [
    ...Array.from({ length: 40 }, (_, i) => ({
      ...candidate,
      activityId: String(i + 1),
      locationHint: { start: [47, 8] },
    })),
    { ...candidate, activityId: '41', locationHint: { start: [52, 13] } },
  ];
  const result = await processPlaceMatching(f);
  assert.equal(result.saved, 41);
  assert.equal(result.groups, 2);
});

void test('missing location hints cannot grow a group beyond the sparse fill size', async () => {
  const f = fixture();
  f.repository.candidates = async () =>
    Array.from({ length: 26 }, (_, i) => ({
      ...candidate,
      activityId: String(i + 1),
    }));
  const result = await processPlaceMatching(f);
  assert.equal(result.saved, 26);
  assert.equal(result.groups, 2);
});

void test('computed results are checkpointed when matching reaches the run deadline', async () => {
  const f = fixture();
  f.repository.candidates = async () =>
    Array.from({ length: 500 }, (_, i) => ({
      ...candidate,
      activityId: String(i + 1),
      locationHint: { start: [47, 8] },
    }));
  let now = 0;
  const result = await processPlaceMatching({
    ...f,
    clock: () => now++,
    timeMs: 100,
  });
  assert(result.saved > 0, 'A deadline must not discard the completed prefix');
  assert(result.groups > 1);
  assert.equal(result.stopReason, 'deadline');
  assert.equal(f.calls.at(-1), 'release');
});

void test('worker reads and writes batches directly and resumes sample-budget deferrals without duplicates', async () => {
  const f = fixture();
  const candidates = Array.from({ length: 60 }, (_, i) => ({
    ...candidate,
    activityId: String(i + 1),
    locationHint: { start: [47, 8] },
  }));
  f.repository.candidates = async () => candidates;
  f.repository.readInput = async () => {
    throw new Error('Per-activity reads are forbidden');
  };
  f.repository.commit = async () => {
    throw new Error('Per-activity writes are forbidden');
  };
  const reads: number[] = [],
    writes: string[][] = [];
  f.repository.readInputs = async (candidates) => {
    reads.push(candidates.length);
    const selected = candidates.slice(0, 20);
    return {
      consumed: selected.length,
      inputs: new Map(
        selected.map((candidate) => [
          candidate.activityId,
          { generation: 'g', revision: '1', payload: {} },
        ]),
      ),
    };
  };
  f.repository.commitMany = async (_token, _catalogue, batch) => {
    const ids = batch.map((write) => write.candidate.activityId);
    writes.push(ids);
    return { committed: ids, fenceLost: false };
  };
  const result = await processPlaceMatching(f);
  assert.deepEqual(reads, [60, 40, 20]);
  assert.equal(result.saved, 60);
  assert.equal(result.inputBatches, 3);
  assert.equal(result.commitBatches, 3);
  assert.equal(new Set(writes.flat()).size, 60);
});
