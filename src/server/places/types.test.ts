import assert from 'node:assert/strict';

import test from 'node:test';

import {
  type PlaceEncounterFragment,
  type PlaceEncounterPause,
  activityPlaceEvidenceSchema,
  buildActivityPlaceEvidence,
  normalizedPlaceSchema,
  parseActivityPlaceEvidence,
  placeEncounterFragmentSchema,
  placeEncounterPauseSchema,
  placeEncounterSchema,
  placeTagsSchema,
} from './types';

void test('raw tag records preserve reserved-looking own keys without prototype mutation', () => {
  const tags: unknown = JSON.parse(
    '{"__proto__":"literal OSM tag","constructor":"also a tag","empty":""}',
  );
  const result = placeTagsSchema.parse(tags);
  assert.deepEqual(result, tags);
  assert.notEqual(result, tags);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__, 'literal OSM tag');
  for (const invalid of [
    null,
    [],
    { ele: 3 },
    { ' ': 'blank key' },
    new Date(),
    Object.create({ inherited: 'tag' }),
  ]) {
    assert.equal(placeTagsSchema.safeParse(invalid).success, false);
  }
});

const encounter = (
  changes: Partial<PlaceEncounterFragment> = {},
): PlaceEncounterFragment => ({
  section_id: 0,
  start_gps_index: 0,
  end_gps_index: 2,
  closest: { kind: 'segment', start_index: 0, end_index: 1, fraction: 0.5 },
  elapsed_s: { start: 0, closest: 5, end: 20 },
  route_distance_m: { basis: 'section_gps', start: 0, closest: 5, end: 20 },
  min_horizontal_distance_m: 0,
  source: { point: { longitude: 8, latitude: 46 }, mapped_elevation_m: 0 },
  recorded_altitude_m: 0,
  altitude_difference_m: 0,
  relation_assessments: [
    {
      relation: 'crossed_pass',
      status: 'supported',
      reason_codes: ['continuous_crossing'],
    },
  ],
  quality_flags: [],
  ...changes,
});

void test('preserves zero indices, time, distance, altitude and segment endpoints', () => {
  const value = encounter({
    closest: { kind: 'segment', start_index: 0, end_index: 1, fraction: 0 },
  });
  assert.deepEqual(placeEncounterFragmentSchema.parse(value), value);
  assert.equal(
    placeEncounterFragmentSchema.parse(
      encounter({
        closest: { kind: 'segment', start_index: 1, end_index: 2, fraction: 1 },
      }),
    ).closest.kind,
    'segment',
  );
});

void test('sample-only references do not invent a segment or unknown channels', () => {
  const value = {
    section_id: 1,
    start_gps_index: 7,
    end_gps_index: 7,
    closest: { kind: 'sample', index: 7 },
    min_horizontal_distance_m: 12,
    source: { point: { longitude: 8, latitude: 46 } },
    relation_assessments: [
      {
        relation: 'reached_peak',
        status: 'uncertain',
        reason_codes: ['altitude_unavailable'],
      },
    ],
    quality_flags: ['missing_altitude'],
  };
  const evidence = buildActivityPlaceEvidence([value]);
  assert.deepEqual(evidence.supported_relations, []);
  assert.equal(
    Object.hasOwn(evidence.encounters[0]!.fragments[0]!, 'recorded_altitude_m'),
    false,
  );
  assert.equal(
    Object.hasOwn(evidence.encounters[0]!.fragments[0]!, 'elapsed_s'),
    false,
  );
  assert.equal(
    Object.hasOwn(evidence.encounters[0]!.fragments[0]!, 'route_distance_m'),
    false,
  );
});

void test('rejects skipped GPS indices, out-of-bounds references and inverted episodes', () => {
  for (const value of [
    encounter({
      closest: { kind: 'segment', start_index: 0, end_index: 2, fraction: 0.5 },
    }),
    encounter({
      closest: { kind: 'segment', start_index: 2, end_index: 3, fraction: 0.5 },
    }),
    encounter({ closest: { kind: 'sample', index: 3 } }),
    encounter({ start_gps_index: 2, end_gps_index: 1 }),
    encounter({
      closest: { kind: 'segment', start_index: 0, end_index: 1, fraction: 1.1 },
    }),
  ])
    assert.equal(placeEncounterFragmentSchema.safeParse(value).success, false);
});

void test('rejects nonfinite/negative metrics and backwards time or distance', () => {
  for (const value of [
    encounter({ min_horizontal_distance_m: -1 }),
    encounter({ min_horizontal_distance_m: Infinity }),
    encounter({ recorded_altitude_m: NaN }),
    encounter({ elapsed_s: { start: 0, closest: 21, end: 20 } }),
    encounter({ elapsed_s: { start: -1, closest: 0, end: 20 } }),
    encounter({
      route_distance_m: { basis: 'section_gps', start: 3, closest: 2, end: 4 },
    }),
  ])
    assert.equal(placeEncounterFragmentSchema.safeParse(value).success, false);
});

void test('altitude delta requires both sources and the recorded-minus-mapped sign', () => {
  assert.equal(
    placeEncounterFragmentSchema.safeParse(
      encounter({ recorded_altitude_m: undefined }),
    ).success,
    false,
  );
  assert.equal(
    placeEncounterFragmentSchema.safeParse(
      encounter({ source: { point: { longitude: 8, latitude: 46 } } }),
    ).success,
    false,
  );
  assert.equal(
    placeEncounterFragmentSchema.safeParse(
      encounter({ recorded_altitude_m: -100, altitude_difference_m: 100 }),
    ).success,
    false,
  );
  assert.equal(
    placeEncounterFragmentSchema.parse(
      encounter({ recorded_altitude_m: -100, altitude_difference_m: -100 }),
    ).altitude_difference_m,
    -100,
  );
  assert.equal(
    placeEncounterFragmentSchema.safeParse(
      encounter({
        source: {
          point: { longitude: 8, latitude: 46 },
          mapped_elevation_m: 0.2,
        },
        recorded_altitude_m: 0.3,
        altitude_difference_m: 0.1,
      }),
    ).success,
    true,
  );
});

void test('keeps saddle/pass assessments and repeated episodes without double-counting relations', () => {
  const first = encounter({
    relation_assessments: [
      {
        relation: 'crossed_pass',
        status: 'supported',
        reason_codes: ['continuous_crossing'],
      },
      {
        relation: 'reached_saddle',
        status: 'supported',
        reason_codes: ['close_with_altitude_agreement'],
      },
    ],
  });
  const second = encounter({
    section_id: 1,
    start_gps_index: 10,
    end_gps_index: 12,
    closest: { kind: 'segment', start_index: 10, end_index: 11, fraction: 0.5 },
    elapsed_s: { start: 100, closest: 105, end: 120 },
    // A new continuous section may restart GPS-derived route distance at zero.
    route_distance_m: { basis: 'section_gps', start: 0, closest: 5, end: 20 },
  });
  const evidence = buildActivityPlaceEvidence([first, second]);
  assert.equal(evidence.encounters.length, 2);
  assert.deepEqual(evidence.supported_relations, [
    'reached_saddle',
    'crossed_pass',
  ]);
  assert.deepEqual(parseActivityPlaceEvidence(evidence), evidence);
});

void test('rejects overlapping/reversed episodes and global distance resets across gaps', () => {
  const first = encounter();
  const second = encounter({
    section_id: 1,
    start_gps_index: 10,
    end_gps_index: 12,
    closest: { kind: 'sample', index: 11 },
    elapsed_s: { start: 30, closest: 35, end: 40 },
  });
  assert.throws(() => buildActivityPlaceEvidence([first, first]));
  assert.throws(() => buildActivityPlaceEvidence([second, first]));
  assert.throws(() =>
    buildActivityPlaceEvidence([
      encounter({
        route_distance_m: {
          basis: 'provider_distance',
          start: 100,
          closest: 105,
          end: 120,
        },
      }),
      {
        ...second,
        route_distance_m: {
          basis: 'provider_distance',
          start: 0,
          closest: 5,
          end: 20,
        },
      },
    ]),
  );
});

void test('episodes may share a boundary sample while retaining distinct closest observations', () => {
  const second = encounter({
    start_gps_index: 2,
    end_gps_index: 4,
    closest: { kind: 'segment', start_index: 2, end_index: 3, fraction: 0.5 },
    elapsed_s: { start: 20, closest: 25, end: 40 },
    route_distance_m: { basis: 'section_gps', start: 20, closest: 25, end: 40 },
  });
  assert.equal(
    buildActivityPlaceEvidence([encounter(), second]).encounters.length,
    2,
  );
});

void test('summary cannot invent or omit supported relations; nearby/uncertain do not count', () => {
  const evidence = buildActivityPlaceEvidence([
    encounter({
      relation_assessments: [
        {
          relation: 'crossed_pass',
          status: 'nearby',
          reason_codes: ['outside_crossing_evidence'],
        },
        {
          relation: 'reached_saddle',
          status: 'uncertain',
          reason_codes: ['insufficient_evidence'],
        },
      ],
    }),
  ]);
  assert.deepEqual(evidence.supported_relations, []);
  assert.equal(
    activityPlaceEvidenceSchema.safeParse({
      ...evidence,
      supported_relations: ['crossed_pass'],
    }).success,
    false,
  );
  const supported = buildActivityPlaceEvidence([encounter()]);
  assert.equal(
    activityPlaceEvidenceSchema.safeParse({
      ...supported,
      supported_relations: [],
    }).success,
    false,
  );
  assert.equal(
    activityPlaceEvidenceSchema.safeParse({
      ...supported,
      supported_relations: ['crossed_pass', 'crossed_pass'],
    }).success,
    false,
  );
  assert.equal(
    activityPlaceEvidenceSchema.safeParse({ ...supported, evidence_version: 1 })
      .success,
    false,
  );
});

void test('rejects duplicate assessments, empty explanations and probability fields', () => {
  const first = encounter();
  assert.equal(
    placeEncounterFragmentSchema.safeParse({
      ...first,
      relation_assessments: [
        ...first.relation_assessments,
        ...first.relation_assessments,
      ],
    }).success,
    false,
  );
  assert.equal(
    placeEncounterFragmentSchema.safeParse({
      ...first,
      relation_assessments: [
        { relation: 'crossed_pass', status: 'supported', reason_codes: [] },
      ],
    }).success,
    false,
  );
  assert.equal(
    placeEncounterFragmentSchema.safeParse({ ...first, probability: 0.99 })
      .success,
    false,
  );
  assert.throws(() => buildActivityPlaceEvidence([]));
});

const pause = (
  changes: Partial<PlaceEncounterPause> = {},
): PlaceEncounterPause => ({
  before_gps_index: 2,
  after_gps_index: 3,
  elapsed_s: { start: 20, end: 6_020 },
  before_distance_m: 13,
  after_distance_m: 28,
  radius_m: 100,
  ...changes,
});

const resumed = (
  changes: Partial<PlaceEncounterFragment> = {},
): PlaceEncounterFragment =>
  encounter({
    section_id: 1,
    start_gps_index: 3,
    end_gps_index: 5,
    closest: { kind: 'sample', index: 3 },
    elapsed_s: { start: 6_020, closest: 6_020, end: 6_060 },
    route_distance_m: { basis: 'section_gps', start: 0, closest: 0, end: 100 },
    ...changes,
  });

void test('recording pauses group fragments while preserving section-local evidence exactly', () => {
  const before = encounter({ quality_flags: ['time_gap'] });
  const after = resumed({ quality_flags: ['hut_vicinity_only'] });
  const evidence = buildActivityPlaceEvidence([before, after], [pause()]);
  assert.equal(evidence.evidence_version, 2);
  assert.equal(evidence.encounters.length, 1);
  const group = evidence.encounters[0]!;
  assert.deepEqual(group.fragments, [before, after]);
  assert.deepEqual(group.pauses, [pause()]);
  assert.deepEqual(group.quality_flags, [
    'hut_vicinity_only',
    'recording_pause_grouped',
    'time_gap',
  ]);
  assert.deepEqual(group.relation_assessments, before.relation_assessments);
  for (const field of [
    'section_id',
    'closest',
    'elapsed_s',
    'route_distance_m',
  ])
    assert.equal(Object.hasOwn(group, field), false, field);
  assert.deepEqual(parseActivityPlaceEvidence(evidence), evidence);
  assert.equal(
    buildActivityPlaceEvidence([before, after]).encounters.length,
    2,
  );
});

void test('multiple pauses chain only explicitly linked fragments and retain true returns', () => {
  const after = resumed();
  const later = resumed({
    section_id: 2,
    start_gps_index: 6,
    end_gps_index: 8,
    closest: { kind: 'sample', index: 6 },
    elapsed_s: { start: 7_000, closest: 7_000, end: 7_040 },
  });
  const laterPause = pause({
    before_gps_index: 5,
    after_gps_index: 6,
    elapsed_s: { start: 6_060, end: 7_000 },
  });
  const all = buildActivityPlaceEvidence(
    [encounter(), after, later],
    [laterPause, pause()],
  );
  assert.equal(all.encounters.length, 1);
  assert.deepEqual(all.encounters[0]!.pauses, [pause(), laterPause]);
  const separate = buildActivityPlaceEvidence(
    [encounter(), after, later],
    [laterPause],
  );
  assert.deepEqual(
    separate.encounters.map((group) => group.fragments.length),
    [1, 2],
  );
});

void test('grouping selects one strongest assessment and cannot manufacture a pass crossing', () => {
  const first = encounter({
    relation_assessments: [
      {
        relation: 'crossed_pass',
        status: 'uncertain',
        reason_codes: ['departure_missing'],
      },
      {
        relation: 'reached_saddle',
        status: 'nearby',
        reason_codes: ['altitude_mismatch'],
      },
    ],
  });
  const second = resumed({
    relation_assessments: [
      {
        relation: 'crossed_pass',
        status: 'uncertain',
        reason_codes: ['approach_missing'],
      },
      {
        relation: 'reached_saddle',
        status: 'supported',
        reason_codes: ['horizontal_vertical_agreement'],
      },
    ],
  });
  const evidence = buildActivityPlaceEvidence([first, second], [pause()]);
  assert.deepEqual(evidence.supported_relations, ['reached_saddle']);
  assert.deepEqual(evidence.encounters[0]!.relation_assessments, [
    second.relation_assessments[1],
    first.relation_assessments[0],
  ]);
});

void test('pause endpoints must be consecutive, ordered, finite and inside the grouping radius', () => {
  for (const invalid of [
    pause({ after_gps_index: 4 }),
    pause({ after_gps_index: 1 }),
    pause({ elapsed_s: { start: 20, end: 20 } }),
    pause({ elapsed_s: { start: 20, end: 19 } }),
    pause({ before_distance_m: 100.01 }),
    pause({ after_distance_m: 100.01 }),
    pause({ before_distance_m: -1 }),
    pause({ radius_m: 0 }),
    pause({ radius_m: Infinity }),
  ])
    assert.equal(placeEncounterPauseSchema.safeParse(invalid).success, false);
  assert.equal(
    placeEncounterPauseSchema.safeParse(pause({ before_distance_m: 100 }))
      .success,
    true,
  );
});

void test('orphan, duplicate and inconsistent pause links fail rather than discard evidence', () => {
  const fragments = [encounter(), resumed()];
  assert.throws(() =>
    buildActivityPlaceEvidence(fragments, [pause(), pause()]),
  );
  assert.throws(() =>
    buildActivityPlaceEvidence(fragments, [
      pause({ before_gps_index: 1, after_gps_index: 2 }),
    ]),
  );
  assert.throws(() =>
    buildActivityPlaceEvidence(fragments, [
      pause({ elapsed_s: { start: 21, end: 6_020 } }),
    ]),
  );
  assert.throws(() =>
    buildActivityPlaceEvidence(fragments, [
      pause({ elapsed_s: { start: 20, end: 6_021 } }),
    ]),
  );
  for (const changed of [
    resumed({ section_id: 0 }),
    resumed({ section_id: 2 }),
    resumed({ elapsed_s: undefined }),
    resumed({
      source: {
        point: { longitude: 8.1, latitude: 46 },
        mapped_elevation_m: 0,
      },
    }),
    resumed({
      source: { point: { longitude: 8, latitude: 46 }, mapped_elevation_m: 1 },
      altitude_difference_m: -1,
    }),
  ])
    assert.throws(() =>
      buildActivityPlaceEvidence([encounter(), changed], [pause()]),
    );
});

void test('group parsing rejects fabricated summaries, dropped gaps and cross-group reordering', () => {
  const evidence = buildActivityPlaceEvidence(
    [encounter(), resumed()],
    [pause()],
  );
  const group = evidence.encounters[0]!;
  for (const changed of [
    { ...group, pauses: [] },
    { ...group, fragments: [] },
    { ...group, quality_flags: [] },
    { ...group, closest: { kind: 'sample', index: 3 } },
    {
      ...group,
      relation_assessments: [
        {
          relation: 'reached_peak',
          status: 'supported',
          reason_codes: ['invented'],
        },
      ],
    },
  ])
    assert.equal(placeEncounterSchema.safeParse(changed).success, false);
  const separate = buildActivityPlaceEvidence([encounter(), resumed()]);
  assert.equal(
    activityPlaceEvidenceSchema.safeParse({
      ...separate,
      encounters: [...separate.encounters].reverse(),
    }).success,
    false,
  );
});

const normalizedPlace = () => ({
  osm_type: 'node',
  osm_id: '9007199254740993',
  kinds: ['pass'],
  subtypes: ['natural_saddle', 'road_trail_pass'],
  display_name: 'Pass',
  names: { name: 'Pass', 'name:de': 'Pass' },
  location: { longitude: 8, latitude: 46 },
  elevation_m: 0,
  tags: { natural: 'saddle', mountain_pass: 'yes', ele: '0', note: '' },
  osm_version: 1,
  osm_updated_at: '2026-10-20T20:23:47Z',
  point_derivation: 'osm_node',
  normalization_version: 'test-v1',
  catalogue_snapshot_id: 'switzerland-test-v1',
});

void test('normalized sources preserve bigint strings, all raw tags and overlapping subtypes', () => {
  const value = normalizedPlace();
  assert.deepEqual(normalizedPlaceSchema.parse(value), value);
  assert.equal(normalizedPlaceSchema.parse(value).osm_id, '9007199254740993');
});

void test('normalized place rejects invalid identities, points, category/derivation and names', () => {
  const value = normalizedPlace();
  for (const changed of [
    { osm_id: 9007199254740992 },
    { osm_id: '01' },
    { osm_id: '9223372036854775808' },
    { location: { longitude: 181, latitude: 46 } },
    { kinds: ['peak'] },
    { subtypes: ['natural_saddle', 'natural_saddle'] },
    { point_derivation: 'validated_polygon_interior' },
    { display_name: '  ' },
    { names: { 'name:signed': 'no' } },
    { tags: { ele: 0 } },
  ])
    assert.equal(
      normalizedPlaceSchema.safeParse({ ...value, ...changed }).success,
      false,
    );
  assert.equal(
    normalizedPlaceSchema.safeParse({
      ...value,
      osm_type: 'way',
      kinds: ['hut'],
      subtypes: ['alpine_hut'],
      point_derivation: 'validated_polygon_interior',
    }).success,
    true,
  );
});
