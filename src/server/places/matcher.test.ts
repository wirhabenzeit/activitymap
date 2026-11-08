import assert from 'node:assert/strict';

import test from 'node:test';

import { matchEncounters } from './encounters';
import {
  DEFAULT_MATCHER_POLICY,
  type MatcherPolicy,
  hasBlockingMatchReasons,
  parametersHash,
  validatePolicy,
} from './policy';
import type { CandidatePlace } from './run-types';
import { prepareTrack } from './track-sections';

const policy = DEFAULT_MATCHER_POLICY;
const point = { longitude: 8, latitude: 46 };
const xy = (x: number, y = 0) => [
  point.latitude + y / 111_195,
  point.longitude + x / (111_195 * Math.cos((point.latitude * Math.PI) / 180)),
];
function payload(
  points: unknown[],
  options: {
    times?: unknown[] | null;
    distances?: unknown[];
    altitudes?: unknown[] | null;
  } = {},
) {
  const metadata = {
    resolution: 'high',
    series_type: 'time',
    original_size: points.length,
  };
  return {
    latlng: { ...metadata, data: points },
    ...(options.times === null
      ? {}
      : {
          time: {
            ...metadata,
            data: options.times ?? points.map((_, i) => i * 20),
          },
        }),
    ...(options.distances
      ? { distance: { ...metadata, data: options.distances } }
      : {}),
    ...(options.altitudes === null
      ? {}
      : {
          altitude: {
            ...metadata,
            data: options.altitudes ?? points.map(() => 100),
          },
        }),
  };
}
const peak: CandidatePlace = {
  id: 'peak',
  displayName: 'Peak',
  kinds: ['peak'],
  subtypes: ['peak'],
  location: point,
  elevationM: 100,
};
const pass: CandidatePlace = {
  ...peak,
  id: 'pass',
  displayName: 'Pass',
  kinds: ['pass'],
  subtypes: ['natural_saddle', 'road_trail_pass'],
};
const hut: CandidatePlace = {
  id: 'hut',
  displayName: 'Hut',
  kinds: ['hut'],
  subtypes: ['alpine_hut'],
  location: point,
};
const run = (
  data: unknown,
  candidates: CandidatePlace[] = [peak],
  custom: MatcherPolicy = policy,
) => matchEncounters(prepareTrack(data, custom), candidates, custom);

void test('policy is bounded, cross-validated and canonically hashed', () => {
  assert.equal(
    parametersHash(policy),
    parametersHash(
      Object.fromEntries(Object.entries(policy).reverse()) as MatcherPolicy,
    ),
  );
  assert.notEqual(
    parametersHash(policy),
    parametersHash({ ...policy, peakRadiusM: 30 }),
  );
  for (const change of [
    { entryRadiusM: 400 },
    { exitRadiusM: 400 },
    { peakRadiusM: 101 },
    { maxCandidates: 10_000 },
    { maxSamples: Infinity },
    { maxComparisons: 0 },
    { maxInterpolationDistanceM: 501 },
    { ignored: 1 },
  ]) {
    assert.throws(() => validatePolicy({ ...policy, ...change }));
  }
});

void test('metadata must establish full-resolution GPS and auxiliary alignment', () => {
  const missing = prepareTrack({}, policy);
  assert.equal(missing.partial, false);
  assert.deepEqual(missing.reasons, ['missing_gps']);
  const empty = prepareTrack(payload([]), policy);
  assert.equal(empty.partial, false);
  assert.deepEqual(empty.reasons, ['missing_gps']);
  const source = payload([xy(-40), xy(40)]);
  for (const changes of [{ resolution: 'medium' }, { original_size: 3 }]) {
    const track = prepareTrack(
      { ...source, latlng: { ...source.latlng, ...changes } },
      policy,
    );
    assert.equal(track.sections.length, 0);
    assert.deepEqual(track.reasons, ['gps_sampling_unverified']);
  }
  const result = run({
    ...source,
    altitude: { ...source.altitude, series_type: 'distance' },
  });
  const encounter = result.matches[0]!.evidence.encounters[0]!.fragments[0]!;
  assert.equal(encounter.recorded_altitude_m, undefined);
  assert.equal(encounter.relation_assessments[0]!.status, 'supported');
  assert(encounter.quality_flags.includes('altitude_unaligned'));
});

void test('invalid GPS samples preserve original indices and never bridge a gap', () => {
  const source = payload([xy(-200), null, xy(200)]);
  const track = prepareTrack(source, policy);
  assert.deepEqual(
    track.sections.map((section) =>
      section.samples.map((sample) => sample.index),
    ),
    [[0], [2]],
  );
  assert.deepEqual(
    track.geometry.geometries.map((geometry) => geometry.type),
    ['Point', 'Point'],
  );
  assert.equal(track.partial, false);
  assert.deepEqual(matchEncounters(track, [peak], policy).matches, []);
});

void test('duplicate/backwards times, long pauses, spatial jumps and date line crossings split', () => {
  const backwards = prepareTrack(
    payload([xy(-20), xy(0), xy(20), xy(0), xy(-20)], {
      times: [0, 10, 10, 5, 20],
    }),
    policy,
  );
  assert.deepEqual(
    backwards.sections.map((section) =>
      section.samples.map((sample) => sample.index),
    ),
    [[0, 1], [2], [3, 4]],
  );
  assert(backwards.qualityFlags.includes('time_non_monotonic'));
  assert(backwards.sections.every((section) => !section.continuousTime));
  for (const [source, reason] of [
    [payload([xy(-20), xy(20)], { times: [0, 121] }), 'time_gap'],
    [payload([xy(-400), xy(400)]), 'spatial_gap'],
    [payload([xy(-40), xy(40)], { times: [0, 1] }), 'speed_gap'],
    [
      payload([
        [0, 179.999],
        [0, -179.999],
      ]),
      'antimeridian_gap',
    ],
    [
      payload([xy(-20), xy(20)], { distances: [0, 1_000] }),
      'provider_distance_gap',
    ],
  ] as const) {
    const track = prepareTrack(source, policy);
    assert.equal(track.sections.length, 2, reason);
    assert(track.reasons.includes(reason), reason);
  }
});

void test('between-sample evidence interpolates only aligned channels and keeps zero values', () => {
  const result = run(
    payload([xy(-40), xy(40)], {
      times: [0, 10],
      distances: [0, 80],
      altitudes: [90, 110],
    }),
  );
  const evidence = result.matches[0]!.evidence;
  const encounter = evidence.encounters[0]!.fragments[0]!;
  assert.equal(result.partial, false);
  assert.deepEqual(evidence.supported_relations, ['reached_peak']);
  assert.equal(encounter.closest.kind, 'segment');
  assert.equal(encounter.start_gps_index, 0);
  assert.equal(encounter.end_gps_index, 1);
  assert(Math.abs(encounter.elapsed_s!.closest - 5) < 1e-6);
  assert.equal(encounter.elapsed_s!.start, 0);
  assert.equal(encounter.route_distance_m!.basis, 'provider_distance');
  assert(Math.abs(encounter.route_distance_m!.closest - 40) < 1e-5);
  assert(Math.abs(encounter.recorded_altitude_m! - 100) < 1e-6);
  assert.deepEqual(encounter.source.point, point);
});

void test('passes are visited by proximity regardless of approach, departure or altitude', () => {
  for (const points of [
    [xy(-200), xy(0), xy(200)],
    [xy(-200), xy(0), xy(-200)],
    [xy(-200), xy(0)],
    [xy(140, -50), xy(60, -20), xy(0), xy(60, 100), xy(100, 120)],
  ]) {
    const evidence = run(payload(points, { altitudes: null }), [pass])
      .matches[0]!.evidence;
    assert.deepEqual(evidence.supported_relations, ['visited_pass']);
    assert.equal(evidence.encounters[0]!.relation_assessments.length, 1);
  }
});

void test('peak elevation check is generous and optional, while sparse chords stay uncertain', () => {
  for (const [source, status] of [
    [payload([xy(-40), xy(40)], { altitudes: null }), 'supported'],
    [payload([xy(-40), xy(40)], { times: null }), 'supported'],
    [payload([xy(-40), xy(40)], { altitudes: [190, 190] }), 'supported'],
    [payload([xy(-40), xy(40)], { altitudes: [-100, -100] }), 'nearby'],
    [payload([xy(-200), xy(200)]), 'uncertain'],
  ] as const) {
    const evidence = run(source).matches[0]!.evidence;
    assert.deepEqual(
      evidence.supported_relations,
      status === 'supported' ? ['reached_peak'] : [],
    );
    assert.equal(
      evidence.encounters[0]!.relation_assessments[0]!.status,
      status,
    );
  }
  const unmapped = { ...peak };
  delete unmapped.elevationM;
  assert.deepEqual(
    run(payload([xy(-20), xy(20)]), [unmapped]).matches[0]!.evidence
      .supported_relations,
    ['reached_peak'],
  );
});

void test('hut evidence describes vicinity and does not require a mapped altitude', () => {
  const evidence = run(payload([xy(-40), xy(40)], { altitudes: null }), [hut])
    .matches[0]!.evidence;
  assert.deepEqual(evidence.supported_relations, ['arrived_at_hut']);
  assert.deepEqual(
    evidence.encounters[0]!.fragments[0]!.relation_assessments[0]!.reason_codes,
    ['hut_vicinity_only'],
  );
  assert.equal(
    evidence.encounters[0]!.fragments[0]!.source.mapped_elevation_m,
    undefined,
  );
});

void test('real exits create repeat episodes without duplicating supported summaries', () => {
  const source = payload([xy(-200), xy(0), xy(200), xy(0), xy(-200)]);
  const result = run(source, [pass, peak]);
  assert.deepEqual(result, run(source, [peak, pass]));
  const episodes = result.matches.find((match) => match.placeId === pass.id)!
    .evidence.encounters;
  assert.deepEqual(
    episodes.map(({ fragments: [episode] }) => [
      episode!.start_gps_index,
      episode!.end_gps_index,
    ]),
    [
      [0, 2],
      [2, 4],
    ],
  );
  assert.equal(
    episodes[0]!.fragments[0]!.route_distance_m!.basis,
    'section_gps',
  );
  assert.deepEqual(result.matches[0]!.evidence.supported_relations, [
    'visited_pass',
  ]);
});

void test('all work limits report partial without inventing complete zero matches', () => {
  const source = payload([xy(-200), xy(0), xy(200), xy(0), xy(-200)]);
  for (const [change, reason] of [
    [{ maxSamples: 2 }, 'sample_limit'],
    [{ maxComparisons: 1 }, 'comparison_limit'],
    [{ maxEpisodesPerPlace: 1 }, 'place_episode_limit'],
    [{ maxTotalEpisodes: 1 }, 'total_episode_limit'],
  ] as const) {
    const result = run(source, [peak], { ...policy, ...change });
    assert.equal(result.partial, true, reason);
    assert(result.reasons.includes(reason), reason);
  }
  const tooMany = run(source, [peak, pass], { ...policy, maxCandidates: 1 });
  assert.deepEqual(tooMany.matches, []);
  assert(tooMany.reasons.includes('candidate_limit'));
  const sections = prepareTrack(payload([xy(0), null, xy(0)]), {
    ...policy,
    maxSections: 1,
  });
  assert.equal(sections.sections.length, 1);
  assert(sections.reasons.includes('section_limit'));
});

void test('unaligned/regressing distance falls back to section distance; candidate duplicates are checked', () => {
  const source = payload([xy(-40), xy(40)], { distances: [100, 0] });
  const result = run(source, [peak, peak]);
  assert.equal(result.matches.length, 1);
  assert.equal(
    result.matches[0]!.evidence.encounters[0]!.fragments[0]!.route_distance_m!
      .basis,
    'section_gps',
  );
  assert.throws(
    () => run(source, [peak, { ...peak, elevationM: 101 }]),
    /Conflicting/,
  );
  assert.throws(() => run(source, [{ ...peak, kinds: ['hut'] }]), /consistent/);
});

void test('summit arrival and departure across a long pause form one encounter with untouched fragments', () => {
  const source = payload(
    [xy(-200), xy(-80), xy(-10), xy(10), xy(80), xy(200)],
    {
      times: [0, 20, 40, 7_200, 7_220, 7_240],
    },
  );
  const track = prepareTrack(source, policy);
  assert.equal(track.sections[1]!.breakBefore, 'time_gap');
  const result = matchEncounters(track, [peak], policy);
  const evidence = result.matches[0]!.evidence;
  assert.equal(evidence.encounters.length, 1);
  const encounter = evidence.encounters[0]!;
  assert.equal(encounter.fragments.length, 2);
  assert.equal(encounter.pauses.length, 1);
  assert.deepEqual(encounter.pauses[0]!.elapsed_s, { start: 40, end: 7_200 });
  assert.deepEqual(
    encounter.fragments.map((fragment) => fragment.closest),
    [
      { kind: 'sample', index: 2 },
      { kind: 'sample', index: 3 },
    ],
  );
  assert(
    encounter.fragments.every(
      (fragment) => fragment.min_horizontal_distance_m > 9,
    ),
  );
  assert.equal(encounter.fragments[1]!.route_distance_m!.start, 0);
  assert.equal(Object.hasOwn(encounter, 'elapsed_s'), false);
  assert.equal(Object.hasOwn(encounter, 'route_distance_m'), false);
  assert.deepEqual(evidence.supported_relations, ['reached_peak']);
  assert(encounter.quality_flags.includes('recording_pause_grouped'));
  assert.equal(result.partial, false);
  assert.deepEqual(result.reasons, ['time_gap']);
});

void test('local discontinuities are non-blocking but unfinished processing is blocking', () => {
  assert.equal(hasBlockingMatchReasons([]), false);
  assert.equal(hasBlockingMatchReasons(['time_gap']), false);
  for (const reason of [
    'invalid_gps_sample',
    'invalid_time_gap',
    'non_increasing_time_gap',
    'speed_gap',
    'spatial_gap',
    'provider_distance_gap',
    'antimeridian_gap',
  ])
    assert.equal(hasBlockingMatchReasons([reason]), false, reason);
  for (const reason of [
    'sample_limit',
    'section_limit',
    'candidate_limit',
    'comparison_limit',
    'place_episode_limit',
    'total_episode_limit',
    'unknown_future_reason',
  ]) {
    assert.equal(hasBlockingMatchReasons(['time_gap', reason]), true, reason);
  }
});

void test('a pause away from a well-recorded visit does not suppress local support', () => {
  const source = payload([xy(-80), xy(-10), xy(-200), xy(-300), xy(-310)], {
    times: [0, 20, 40, 7_200, 7_220],
  });
  const track = prepareTrack(source, policy);
  const result = matchEncounters(track, [peak, hut], policy);
  assert.equal(track.partial, false);
  assert.equal(result.partial, false);
  assert.deepEqual(result.reasons, ['time_gap']);
  assert.equal(track.geometry.geometries.length, 2);
  assert.deepEqual(
    result.matches.map((match) => match.evidence.supported_relations),
    [['arrived_at_hut'], ['reached_peak']],
  );
  assert(
    result.matches.every(
      (match) => match.evidence.encounters[0]!.pauses.length === 0,
    ),
  );
});

void test('a time gap never supplies a missing visit or local continuity', () => {
  const across = run(payload([xy(-200), xy(200)], { times: [0, 10_000] }));
  assert.equal(across.partial, false);
  assert.deepEqual(across.matches, []);
  const isolated = run(payload([xy(-10), xy(10)], { times: [0, 10_000] }));
  assert.equal(isolated.partial, false);
  assert.deepEqual(isolated.matches[0]!.evidence.supported_relations, []);
  assert.equal(
    isolated.matches[0]!.evidence.encounters[0]!.relation_assessments[0]!
      .status,
    'uncertain',
  );
});

void test('local invalid samples preserve other visits while exhausted work stays partial', () => {
  const invalid = run(
    payload([xy(-80), xy(-10), xy(10), xy(20), null, xy(30)], {
      times: [0, 20, 10_000, 10_020, 10_040, 10_060],
    }),
  );
  assert.equal(invalid.partial, false);
  assert.deepEqual(invalid.reasons, ['invalid_gps_sample', 'time_gap']);
  const limited = run(
    payload([xy(-80), xy(-10), xy(10), xy(20)], {
      times: [0, 20, 10_000, 10_020],
    }),
    [peak],
    { ...policy, maxComparisons: 3 },
  );
  assert.equal(limited.partial, true);
  assert.deepEqual(limited.reasons, ['comparison_limit', 'time_gap']);
});

void test('visits either side of a pause group without claiming a crossing', () => {
  const result = run(
    payload([xy(-200), xy(-80), xy(-10), xy(10), xy(80), xy(200)], {
      times: [0, 20, 40, 3_600, 3_620, 3_640],
    }),
    [pass],
  );
  const evidence = result.matches[0]!.evidence;
  assert.equal(evidence.encounters.length, 1);
  assert.deepEqual(evidence.supported_relations, ['visited_pass']);
  assert(
    !evidence.encounters[0]!.relation_assessments.some(
      (a) => a.relation === 'crossed_pass',
    ),
  );
});

void test('hut pauses group across multiple sections, including an isolated sample and overnight stop', () => {
  const result = run(
    payload([xy(-80), xy(-20), xy(-25), xy(-30), xy(-80)], {
      times: [0, 20, 10_000, 90_000, 90_020],
      distances: [0, 60, 60, 60, 110],
    }),
    [hut],
  );
  const encounter = result.matches[0]!.evidence.encounters[0]!;
  assert.equal(result.matches[0]!.evidence.encounters.length, 1);
  assert.equal(encounter.fragments.length, 3);
  assert.equal(encounter.pauses.length, 2);
  assert.equal(
    encounter.fragments[1]!.relation_assessments[0]!.status,
    'uncertain',
  );
  assert.equal(encounter.relation_assessments[0]!.status, 'supported');
});

void test('pause joining uses the entry radius on both endpoints, without changing relation support', () => {
  for (const [before, after, expected] of [
    [90, 90, 1],
    [110, 20, 2],
    [20, 110, 2],
  ]) {
    const result = run(
      payload([xy(20), xy(before!), xy(after!), xy(20)], {
        times: [0, 20, 1_000, 1_020],
      }),
      [hut],
    );
    assert.equal(result.matches[0]!.evidence.encounters.length, expected);
  }
  const nearby = run(
    payload([xy(90), xy(90), xy(90), xy(90)], {
      times: [0, 20, 1_000, 1_020],
    }),
    [hut],
  ).matches[0]!.evidence;
  assert.equal(nearby.encounters.length, 1);
  assert.deepEqual(nearby.supported_relations, []);
});

void test('a genuine exit and return remain separate even when the return spans a pause', () => {
  const result = run(
    payload([xy(-80), xy(-20), xy(-200), xy(-80), xy(-20), xy(-25), xy(-80)], {
      times: [0, 20, 40, 60, 80, 10_000, 10_020],
    }),
    [hut],
  );
  assert.deepEqual(
    result.matches[0]!.evidence.encounters.map(
      (encounter) => encounter.fragments.length,
    ),
    [1, 2],
  );
});

void test('known travel during the recording gap prevents joining nearby endpoints', () => {
  for (const travel of [200, 600]) {
    const result = run(
      payload([xy(-80), xy(-20), xy(-25), xy(-80)], {
        times: [0, 20, 1_000, 1_020],
        distances: [0, 60, 60 + travel, 115 + travel],
      }),
      [hut],
    );
    assert.equal(result.matches[0]!.evidence.encounters.length, 2);
  }
});

void test('invalid GPS, bad times and speed jumps are not treated as recording pauses', () => {
  const sources = [
    payload([xy(-20), xy(-10), null, xy(10), xy(20)], {
      times: [0, 20, 30, 1_000, 1_020],
    }),
    payload([xy(-20), xy(-10), xy(10), xy(20)], { times: [0, 20, 20, 40] }),
    payload([xy(-20), xy(-10), xy(10), xy(20)], { times: [0, 20, null, 40] }),
    payload([xy(-90), xy(-80), xy(80), xy(90)], { times: [0, 20, 21, 41] }),
  ];
  for (const source of sources) {
    const result = run(source, [hut]);
    assert(result.matches[0]!.evidence.encounters.length >= 2);
    assert(
      result.matches[0]!.evidence.encounters.every(
        (encounter) => encounter.pauses.length === 0,
      ),
    );
  }
});

void test('fragment work limits still apply when pauses collapse logical encounters', () => {
  const result = run(
    payload([xy(-20), xy(-10), xy(10), xy(20), xy(10), xy(20)], {
      times: [0, 20, 1_000, 1_020, 2_000, 2_020],
    }),
    [peak],
    { ...policy, maxEpisodesPerPlace: 2 },
  );
  assert(result.reasons.includes('place_episode_limit'));
  assert.equal(result.matches[0]!.evidence.encounters.length, 1);
  assert.equal(result.matches[0]!.evidence.encounters[0]!.fragments.length, 2);
});

void test('a speed spike is excluded locally and cannot invent a visit along its chord', () => {
  const source = payload(
    [xy(-90), xy(-80), xy(80), xy(90), xy(20), xy(0), xy(20)],
    {
      times: [0, 20, 21, 41, 61, 81, 101],
    },
  );
  const track = prepareTrack(source, policy);
  const result = matchEncounters(track, [peak], policy);
  assert.equal(result.partial, false);
  assert.deepEqual(result.reasons, ['speed_gap']);
  assert.equal(track.geometry.geometries.length, 2);
  const fragments = result.matches[0]!.evidence.encounters.flatMap(
    (encounter) => encounter.fragments,
  );
  assert.deepEqual(fragments[0]!.relation_assessments[0]!.status, 'nearby');
  assert.deepEqual(fragments[1]!.closest, { kind: 'sample', index: 5 });
  assert.deepEqual(result.matches[0]!.evidence.supported_relations, [
    'reached_peak',
  ]);
  const onlyJump = run(
    payload([xy(-90), xy(-80), xy(80), xy(90)], { times: [0, 20, 21, 41] }),
  );
  assert.deepEqual(onlyJump.matches[0]!.evidence.supported_relations, []);
});

void test('peak scoring finds a better spatial point without replacing closest-point evidence', () => {
  const custom = { ...policy, peakVerticalToleranceM: 20 };
  const result = run(
    payload([xy(0), xy(20)], { altitudes: [0, 100], distances: [0, 20] }),
    [peak],
    custom,
  );
  const fragment = result.matches[0]!.evidence.encounters[0]!.fragments[0]!;
  assert.deepEqual(result.matches[0]!.evidence.supported_relations, [
    'reached_peak',
  ]);
  assert.equal(fragment.recorded_altitude_m, 0);
  assert.equal(fragment.min_horizontal_distance_m, 0);
  assert(fragment.peak_match!.weighted_score < 1);
  assert(fragment.peak_match!.horizontal_distance_m > 19);
  assert(fragment.peak_match!.recorded_altitude_m! > 95);
  assert(fragment.peak_match!.route_distance_m!.closest > 19);
  assert.equal(fragment.peak_match!.uses_elevation, true);
});

void test('combined peak score rejects a point inside both individual limits', () => {
  const result = run(
    payload([xy(-2, 28), xy(2, 28)], { altitudes: [180, 180] }),
  );
  const fragment = result.matches[0]!.evidence.encounters[0]!.fragments[0]!;
  assert(fragment.min_horizontal_distance_m < policy.peakRadiusM);
  assert(
    Math.abs(fragment.altitude_difference_m!) < policy.peakVerticalToleranceM,
  );
  assert(fragment.peak_match!.weighted_score > 1);
  assert.deepEqual(result.matches[0]!.evidence.supported_relations, []);
  assert(
    fragment.relation_assessments[0]!.reason_codes.includes(
      'outside_spatial_tolerance',
    ),
  );
});

void test('missing, unaligned or partially missing elevation falls back to horizontal scoring', () => {
  const absent = { ...peak };
  delete absent.elevationM;
  const unaligned = payload([xy(-20), xy(20)]);
  const cases = [
    { data: payload([xy(-20), xy(20)], { altitudes: null }), place: peak },
    { data: payload([xy(-20), xy(20)]), place: absent },
    {
      data: {
        ...unaligned,
        altitude: { ...unaligned.altitude, resolution: 'low' },
      },
      place: peak,
    },
    {
      data: payload([xy(0), xy(20)], { altitudes: [null, 1000] }),
      place: peak,
    },
  ];
  for (const { data, place } of cases) {
    const result = run(data, [place]);
    const scoring =
      result.matches[0]!.evidence.encounters[0]!.fragments[0]!.peak_match!;
    assert.deepEqual(result.matches[0]!.evidence.supported_relations, [
      'reached_peak',
    ]);
    assert.equal(scoring.uses_elevation, false);
    assert.equal(scoring.spatial_distance_m, undefined);
    assert.equal(scoring.altitude_difference_m, undefined);
    assert(
      Math.abs(
        scoring.weighted_score -
          scoring.horizontal_distance_m / policy.peakRadiusM,
      ) < 1e-12,
    );
  }
});

void test('a reliable endpoint can support a peak when a better sparse interior cannot', () => {
  const result = run(payload([xy(-200), xy(20)]));
  const fragment = result.matches[0]!.evidence.encounters[0]!.fragments[0]!;
  assert.deepEqual(result.matches[0]!.evidence.supported_relations, [
    'reached_peak',
  ]);
  assert.equal(fragment.closest.kind, 'segment');
  assert.equal(fragment.peak_match!.closest.kind, 'sample');
  assert.equal(fragment.peak_match!.reliable, true);
});

void test('peak scores never combine horizontal proximity with elevation from outside the radius or across recording gaps', () => {
  const custom = { ...policy, peakVerticalToleranceM: 20 };
  const acrossGap = run(
    payload([xy(0), xy(80)], { altitudes: [0, 100], times: [0, 121] }),
    [peak],
    custom,
  );
  assert.deepEqual(acrossGap.matches[0]!.evidence.supported_relations, []);
  assert(
    acrossGap.matches[0]!.evidence.encounters[0]!.fragments.every(
      (f) => f.relation_assessments[0]!.status !== 'supported',
    ),
  );
  const sameSection = run(
    payload([xy(0), xy(80)], { altitudes: [0, 100] }),
    [peak],
    custom,
  );
  assert.deepEqual(sameSection.matches[0]!.evidence.supported_relations, []);
});

void test('mixed peak and hut candidates keep their independent scoring points', () => {
  const mixed: CandidatePlace = {
    ...peak,
    kinds: ['peak', 'hut'],
    subtypes: ['peak', 'alpine_hut'],
  };
  const result = run(
    payload([xy(0), xy(80)], { altitudes: [0, 100] }),
    [mixed],
    { ...policy, peakVerticalToleranceM: 20 },
  );
  const fragment = result.matches[0]!.evidence.encounters[0]!.fragments[0]!;
  assert.equal(fragment.min_horizontal_distance_m, 0);
  assert(fragment.peak_match!.horizontal_distance_m > 50);
  assert.deepEqual(result.matches[0]!.evidence.supported_relations, [
    'arrived_at_hut',
  ]);
});
