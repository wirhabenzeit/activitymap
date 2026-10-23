import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import test from 'node:test';

import { createSyntheticCatalogue } from '../places/catalogue.fixture';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
} from '../places/policy';
import type {
  ActivityMatchInput,
  ActivityRunRecord,
  CandidatePlace,
  PlaceMatch,
} from '../places/run-types';
import {
  type ActivityMatchReport,
  type MatchingRepositories,
  runActivityPlaceMatching,
} from './activity-places';

function fixture() {
  const catalogue = createSyntheticCatalogue();
  const actor = {
    userId: 'synthetic',
    athleteId: 42,
    authentication: 'bearer' as const,
  };
  const identity = {
    runId: randomUUID(),
    catalogueSnapshotId: catalogue.manifest.catalogue_snapshot_id,
    matcherVersion: MATCHER_VERSION,
    parametersHash: parametersHash(DEFAULT_MATCHER_POLICY),
  };
  const metadata = {
    resolution: 'high',
    series_type: 'time',
    original_size: 3,
  };
  const payload = {
    latlng: {
      ...metadata,
      data: [
        [46.8, 8.298],
        [46.8, 8.3],
        [46.8, 8.302],
      ],
    },
    time: { ...metadata, data: [0, 30, 60] },
  };
  const input: ActivityMatchInput = {
    activityId: '9007199254740993',
    tokens: { generation: 'gen1', revision: '1', sourceVersion: 'source1' },
    payload,
  };
  const candidates: CandidatePlace[] = [
    {
      id: randomUUID(),
      displayName: 'Test hut',
      kinds: ['hut'],
      subtypes: ['alpine_hut'],
      location: { longitude: 8.3, latitude: 46.8 },
    },
  ];
  const events: string[] = [];
  const records: ActivityRunRecord[] = [];
  const reports: ActivityMatchReport[] = [];
  const publications: PlaceMatch[][] = [];
  const repositories: MatchingRepositories = {
    places: {
      async assertCatalogue() {
        events.push('catalogue');
      },
      async discover() {
        return { candidates, covered: true, truncated: false };
      },
    },
    activityPlaces: {
      async withAthleteRunLock(_actor, work) {
        events.push('lock');
        try {
          return await work();
        } finally {
          events.push('unlock');
        }
      },
      async readInput() {
        return input;
      },
      async publish(_actor, _input, _identity, matches) {
        events.push('publish');
        publications.push(matches);
        return 'published';
      },
    },
  };
  const options = {
    actor,
    catalogue,
    policy: DEFAULT_MATCHER_POLICY,
    identity,
    repositories,
    activityIds: [input.activityId],
    apply: true,
    onReport: async (report: ActivityMatchReport) => {
      events.push('report');
      reports.push(report);
    },
    onRecord: async (record: ActivityRunRecord) => {
      events.push('record');
      records.push(record);
    },
  };
  return {
    options,
    input,
    candidates,
    records,
    reports,
    events,
    publications,
    repositories,
  };
}

function pausedPayload(invalidGps = false) {
  const xy = (metres: number) => [
    46.8,
    8.3 + metres / (111_195 * Math.cos((46.8 * Math.PI) / 180)),
  ];
  const points: (number[] | null)[] = [-200, -80, -10, 10, 80, 200].map(xy);
  const times = [0, 20, 40, 3_600, 3_620, 3_640];
  if (invalidGps) {
    points.push(null, xy(250));
    times.push(3_660, 3_680);
  }
  const metadata = {
    resolution: 'high',
    series_type: 'time',
    original_size: points.length,
  };
  return {
    latlng: { ...metadata, data: points },
    time: { ...metadata, data: times },
    altitude: { ...metadata, data: points.map(() => 1_000) },
  };
}

void test('manual run defaults to report-only and preserves original input tokens', async () => {
  const f = fixture();
  await runActivityPlaceMatching({ ...f.options, apply: undefined });
  assert.equal(f.publications.length, 0);
  assert.equal(f.records[0]?.outcome, 'complete');
  assert.equal(f.records[0]?.published, false);
  assert.deepEqual(f.records[0]?.input, f.input.tokens);
});

void test('complete run writes diagnostics before publication and outcome after commit', async () => {
  const f = fixture();
  await runActivityPlaceMatching(f.options);
  assert.deepEqual(f.events, [
    'lock',
    'catalogue',
    'report',
    'publish',
    'record',
    'unlock',
  ]);
  assert.equal(f.records[0]?.published, true);
  assert.deepEqual(
    f.publications[0]?.[0]?.evidence.encounters[0]?.fragments[0]?.closest,
    {
      kind: 'sample',
      index: 1,
    },
  );
});

void test('complete zero-match recomputation is published, partial and uncovered are retained only in reports', async () => {
  for (const state of ['zero', 'partial', 'uncovered'] as const) {
    const f = fixture();
    f.repositories.places.discover = async () => ({
      candidates: [],
      covered: state !== 'uncovered',
      truncated: state === 'partial',
    });
    await runActivityPlaceMatching(f.options);
    assert.equal(f.records[0]?.outcome, state === 'zero' ? 'complete' : state);
    assert.equal(f.publications.length, state === 'zero' ? 1 : 0);
    if (state === 'zero') assert.deepEqual(f.publications[0], []);
  }
});

void test('recording pauses do not block publishing locally supported hut and summit encounters', async () => {
  for (const kind of ['hut', 'peak'] as const) {
    const f = fixture();
    f.input.payload = pausedPayload();
    if (kind === 'peak') {
      f.candidates[0] = {
        ...f.candidates[0]!,
        displayName: 'Test summit',
        kinds: ['peak'],
        subtypes: ['peak'],
        elevationM: 1_000,
      };
    }
    await runActivityPlaceMatching(f.options);
    assert.equal(f.records[0]!.outcome, 'complete', kind);
    assert.equal(f.records[0]!.published, true, kind);
    assert.deepEqual(f.records[0]!.reasons, ['time_gap']);
    assert.deepEqual(f.reports[0]!.reasons, ['time_gap']);
    assert.equal(f.publications.length, 1);
    const evidence = f.publications[0]![0]!.evidence;
    assert.deepEqual(evidence.supported_relations, [
      kind === 'peak' ? 'reached_peak' : 'arrived_at_hut',
    ]);
    assert.equal(evidence.encounters.length, 1);
    assert.equal(evidence.encounters[0]!.fragments.length, 2);
    assert.deepEqual(evidence.encounters[0]!.pauses[0]!.elapsed_s, {
      start: 40,
      end: 3_600,
    });
    assert.equal(f.reports[0]!.geometry.geometries.length, 2);
  }
});

void test('a supported pass visit can be published without claiming a crossing', async () => {
  const f = fixture();
  f.input.payload = pausedPayload();
  f.candidates[0] = {
    ...f.candidates[0]!,
    displayName: 'Test pass',
    kinds: ['pass'],
    subtypes: ['road_trail_pass'],
    elevationM: 1_000,
  };
  await runActivityPlaceMatching(f.options);
  assert.equal(f.records[0]!.outcome, 'complete');
  assert.equal(f.records[0]!.published, true);
  assert.deepEqual(f.records[0]!.reasons, ['time_gap']);
  const evidence = f.publications[0]![0]!.evidence;
  assert.deepEqual(evidence.supported_relations, ['visited_pass']);
  assert.equal(evidence.encounters.length, 1);
  assert.deepEqual(evidence.encounters[0]!.relation_assessments, [
    {
      relation: 'visited_pass',
      status: 'supported',
      reason_codes: ['proximity_visit'],
    },
  ]);
});

void test('local discontinuities do not excuse processing truncation or incomplete discovery', async () => {
  for (const blocker of [
    'sample_limit',
    'candidate_limit',
    'invalid_gps_sample',
  ] as const) {
    const f = fixture();
    f.input.payload = pausedPayload(blocker === 'invalid_gps_sample');
    const policy = {
      ...f.options.policy,
      ...(blocker === 'sample_limit' ? { maxSamples: 5 } : {}),
    };
    if (blocker === 'candidate_limit') {
      f.repositories.places.discover = async () => ({
        candidates: f.candidates,
        covered: true,
        truncated: true,
      });
    }
    await runActivityPlaceMatching({
      ...f.options,
      policy,
      identity: {
        ...f.options.identity,
        parametersHash: parametersHash(policy),
      },
    });
    assert.equal(
      f.records[0]!.outcome,
      blocker === 'invalid_gps_sample' ? 'complete' : 'partial',
      blocker,
    );
    assert.equal(
      f.records[0]!.published,
      blocker === 'invalid_gps_sample',
      blocker,
    );
    assert(f.records[0]!.reasons.includes('time_gap'), blocker);
    assert(f.records[0]!.reasons.includes(blocker), blocker);
    assert.equal(
      f.publications.length,
      blocker === 'invalid_gps_sample' ? 1 : 0,
      blocker,
    );
    assert.deepEqual(f.reports[0]!.matches[0]!.evidence.supported_relations, [
      'arrived_at_hut',
    ]);
  }
});

void test('processing all recorded sections can complete with zero matches while retaining the recording-gap diagnostic', async () => {
  const f = fixture();
  f.input.payload = pausedPayload();
  f.repositories.places.discover = async () => ({
    candidates: [],
    covered: true,
    truncated: false,
  });
  await runActivityPlaceMatching(f.options);
  assert.equal(f.records[0]!.outcome, 'complete');
  assert.equal(f.records[0]!.published, true);
  assert.equal(f.records[0]!.matchCount, 0);
  assert.deepEqual(f.records[0]!.reasons, ['time_gap']);
  assert.deepEqual(f.publications, [[]]);
  assert.equal(f.reports[0]!.sections.length, 2);
  assert.deepEqual(f.reports[0]!.reasons, ['time_gap']);
});

void test('missing stored streams never trigger publication or discovery', async () => {
  const f = fixture();
  f.repositories.activityPlaces.readInput = async () => null;
  f.repositories.places.discover = async () => {
    throw new Error('must not run');
  };
  await runActivityPlaceMatching(f.options);
  assert.equal(f.records[0]?.outcome, 'missing_streams');
  assert.equal(f.publications.length, 0);
});

void test('concurrent changes are reported as superseded; database errors do not become zero matches', async () => {
  const f = fixture();
  f.repositories.activityPlaces.publish = async () => 'superseded';
  await runActivityPlaceMatching(f.options);
  assert.equal(f.records[0]?.outcome, 'superseded');
  assert.equal(f.records[0]?.published, false);
  const g = fixture();
  g.repositories.activityPlaces.readInput = async () => {
    throw new Error('private SQL payload');
  };
  await runActivityPlaceMatching(g.options);
  assert.equal(g.records[0]?.outcome, 'failed');
  assert(!JSON.stringify(g.records).includes('private SQL'));
});

void test('report write failure aborts without publishing and releases the run lock', async () => {
  const f = fixture();
  await assert.rejects(
    runActivityPlaceMatching({
      ...f.options,
      onReport: async () => {
        throw new Error('disk full');
      },
    }),
    /disk full/,
  );
  assert.equal(f.publications.length, 0);
  assert.equal(f.records.length, 0);
  assert.equal(f.events.at(-1), 'unlock');
});

void test('manifest write failure after commit aborts with no fabricated completion', async () => {
  const f = fixture();
  await assert.rejects(
    runActivityPlaceMatching({
      ...f.options,
      onRecord: async () => {
        throw new Error('disk full');
      },
    }),
    /disk full/,
  );
  assert.equal(f.publications.length, 1);
  assert.equal(f.records.length, 0);
  assert.equal(f.events.at(-1), 'unlock');
});

void test('bad policy identity or duplicate activity scope is rejected before database work', async () => {
  const f = fixture();
  await assert.rejects(
    runActivityPlaceMatching({
      ...f.options,
      identity: { ...f.options.identity, parametersHash: '0'.repeat(64) },
    }),
    /identity/,
  );
  await assert.rejects(
    runActivityPlaceMatching({
      ...f.options,
      activityIds: [f.input.activityId, f.input.activityId],
    }),
    /Duplicate/,
  );
  assert.deepEqual(f.events, []);
});
