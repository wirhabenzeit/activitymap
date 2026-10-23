import assert from 'node:assert/strict';

import test from 'node:test';

import {
  NORMALIZATION_VERSION,
  normalizeSourceObject,
} from './normalize-source';

const context = {
  catalogueSnapshotId: 'synthetic-snapshot',
  normalizationVersion: NORMALIZATION_VERSION,
};
const node = (
  tags: Record<string, string>,
  changes: Record<string, unknown> = {},
) => ({
  osm_type: 'node',
  osm_id: '9007199254740993',
  osm_version: 3,
  osm_timestamp: '2026-10-20T20:23:47Z',
  point: { lon: 8.25, lat: 46.5 },
  point_derivation: 'osm_node',
  tags: { natural: 'peak', ...tags },
  // Deliberately contradictory convenience fields: raw source tags win.
  categories: ['wilderness_hut'],
  named_eligible: false,
  parsed_elevation_m: 9999,
  ...changes,
});
const hut = (changes: Record<string, unknown> = {}) =>
  node(
    { name: 'Example hut', natural: '', tourism: 'alpine_hut' },
    { osm_type: 'way', point: null, point_derivation: null, ...changes },
  );
const hutAudit = (changes: Record<string, unknown> = {}) => ({
  osm_type: 'way',
  osm_id: '9007199254740993',
  osm_version: 3,
  osm_timestamp: '2026-10-20T20:23:47Z',
  status: 'valid',
  point: { lon: 8.3, lat: 46.6 },
  point_derivation: 'validated_polygon_interior',
  geometry_type: 'Polygon',
  ...changes,
});

void test('recomputes selection, retains large IDs, original strings and all raw tags', () => {
  const source = node({
    name: '  Piz Example  ',
    'name:de': 'Deutscher Name',
    alt_name: '  Alias;Other  ',
    old_name: ' ',
    'name:signed': 'no',
    'custom:key': '',
    ele: '1234.1 m',
  });
  const result = normalizeSourceObject(source, undefined, context)!;
  assert.equal(result.osm_id, '9007199254740993');
  assert.deepEqual(result.kinds, ['peak']);
  assert.deepEqual(result.subtypes, ['peak']);
  assert.equal(result.display_name, '  Piz Example  ');
  assert.deepEqual(result.names, {
    name: '  Piz Example  ',
    'name:de': 'Deutscher Name',
    alt_name: '  Alias;Other  ',
  });
  assert.deepEqual(result.tags, source.tags);
  assert.equal(result.elevation_m, Math.fround(1234.1));
  assert.deepEqual(result.location, { longitude: 8.25, latitude: 46.5 });
});

void test('normalization preserves own reserved-looking raw tag keys as data', () => {
  const tags: unknown = JSON.parse(
    '{"natural":"peak","name":"Example","__proto__":"literal tag","constructor":"another tag"}',
  );
  const result = normalizeSourceObject(node({}, { tags }), undefined, context)!;
  assert.deepEqual(result.tags, tags);
  assert.equal(Object.hasOwn(result.tags, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(result.tags), Object.prototype);
});

void test('recognized language-only names work on arbitrary source identities', () => {
  for (const [index, language] of [
    'de',
    'it',
    'rm',
    'en',
    'gsw',
    'sr-Latn',
    'de_CH',
  ].entries()) {
    const result = normalizeSourceObject(
      node(
        { [`name:${language}`]: `Name ${language}` },
        { osm_id: String(index + 1) },
      ),
      undefined,
      context,
    );
    assert.equal(result?.display_name, `Name ${language}`);
    assert.equal(result?.names[`name:${language}`], `Name ${language}`);
  }
});

void test('metadata, unknown language codes and aliases alone never qualify a place', () => {
  for (const key of [
    'name:signed',
    'name:left',
    'name:right',
    'name:etymology',
    'name:ref',
    'name:zzz',
    'name:abc',
    'name:mul',
    'name:zxx',
    'old_name',
    'alt_name',
    'int_name:de',
  ]) {
    assert.equal(
      normalizeSourceObject(node({ [key]: 'no' }), undefined, context),
      null,
      key,
    );
  }
  assert.equal(
    normalizeSourceObject(node({ name: '\t ' }), undefined, context),
    null,
  );
});

void test('display name uses explicit priority then deterministic localized-key ordering', () => {
  const names = {
    name: 'Default',
    int_name: 'International',
    'name:en': 'English',
    'name:fr': 'French',
    'name:de': 'German',
  };
  assert.equal(
    normalizeSourceObject(node(names), undefined, context)?.display_name,
    'Default',
  );
  assert.equal(
    normalizeSourceObject(node({ ...names, name: ' ' }), undefined, context)
      ?.display_name,
    'International',
  );
  assert.equal(
    normalizeSourceObject(
      node({ ...names, name: ' ', int_name: '' }),
      undefined,
      context,
    )?.display_name,
    'English',
  );
  assert.equal(
    normalizeSourceObject(
      node({ 'name:fr': 'French', 'name:de': 'German' }),
      undefined,
      context,
    )?.display_name,
    'German',
  );
});

void test('OR selection preserves saddle/pass overlap and all selected kinds', () => {
  const result = normalizeSourceObject(
    node({
      name: 'Pass hut',
      natural: 'saddle',
      mountain_pass: 'yes',
      tourism: 'wilderness_hut',
    }),
    undefined,
    context,
  )!;
  assert.deepEqual(result.kinds, ['pass', 'hut']);
  assert.deepEqual(result.subtypes, [
    'natural_saddle',
    'road_trail_pass',
    'wilderness_hut',
  ]);
  assert.equal(
    normalizeSourceObject(
      node({ name: 'Town', natural: '', place: 'town' }),
      undefined,
      context,
    ),
    null,
  );
});

void test('uses only conservative decimal metres and finite nonzero Float32 elevations', () => {
  for (const [raw, expected] of [
    ['0', 0],
    ['-12.5', -12.5],
    ['+123 m', 123],
    [' 123\tm ', 123],
  ] as const) {
    assert.equal(
      normalizeSourceObject(
        node({ name: 'Peak', ele: raw }),
        undefined,
        context,
      )?.elevation_m,
      expected,
    );
  }
  for (const raw of [
    '1,234',
    '1.234,5',
    '12-13',
    '12;13',
    '12 ft',
    '12 M',
    '1e3',
    'NaN',
    'Infinity',
    '.5',
    '5.',
    '1\nm',
    '9'.repeat(50),
    `0.${'0'.repeat(46)}1`,
    `0.${'0'.repeat(400)}1`,
  ]) {
    const result = normalizeSourceObject(
      node({ name: 'Peak', ele: raw }),
      undefined,
      context,
    )!;
    assert.equal(Object.hasOwn(result, 'elevation_m'), false, raw);
    assert.equal(result.tags.ele, raw);
  }
});

void test('eligible invalid points and unsafe identities fail instead of disappearing', () => {
  for (const changes of [
    { point: null },
    { point: { lon: Infinity, lat: 46 } },
    { point: { lon: 8, lat: 91 } },
    { point: { longitude: 8, latitude: 46 } },
    { point_derivation: 'centroid' },
    { osm_id: 9007199254740992 },
    { osm_id: '092' },
    { osm_id: '9223372036854775808' },
    { osm_timestamp: 'not-a-date' },
  ]) {
    assert.throws(() =>
      normalizeSourceObject(
        node({ name: 'Peak' }, changes),
        undefined,
        context,
      ),
    );
  }
  // Geometry is irrelevant to records intentionally excluded by naming/selection.
  assert.equal(
    normalizeSourceObject(node({}, { point: null }), undefined, context),
    null,
  );
  assert.equal(
    normalizeSourceObject(
      node({ natural: '', name: 'Town' }, { point: null }),
      undefined,
      context,
    ),
    null,
  );
});

void test('requires matching validated hut polygon audit for ways and relations', () => {
  for (const type of ['way', 'relation']) {
    const result = normalizeSourceObject(
      hut({ osm_type: type }),
      hutAudit({ osm_type: type, geometry_type: 'MultiPolygon' }),
      context,
    )!;
    assert.deepEqual(result.location, { longitude: 8.3, latitude: 46.6 });
    assert.equal(result.point_derivation, 'validated_polygon_interior');
  }
  assert.throws(() => normalizeSourceObject(hut(), undefined, context));
  for (const changes of [
    { osm_type: 'relation' },
    { osm_id: '123' },
    { osm_version: 4 },
    { osm_timestamp: '2026-10-21T20:23:47Z' },
    { status: 'invalid' },
    { status: 'unsupported' },
    { point: { lon: 181, lat: 46 } },
    { point_derivation: 'centroid' },
    { point_derivation: 'osm_node', geometry_type: 'Point' },
  ]) {
    assert.throws(() =>
      normalizeSourceObject(hut(), hutAudit(changes), context),
    );
  }
  assert.throws(() =>
    normalizeSourceObject(
      node({ name: 'Peak' }, { osm_type: 'way' }),
      hutAudit(),
      context,
    ),
  );
});

void test('provided node audit cannot substitute a different coordinate or representation', () => {
  const source = node({ name: 'Node hut', natural: '', tourism: 'alpine_hut' });
  const audit = hutAudit({
    osm_type: 'node',
    geometry_type: 'Point',
    point_derivation: 'osm_node',
    point: source.point,
  });
  assert.equal(
    normalizeSourceObject(source, audit, context)?.point_derivation,
    'osm_node',
  );
  assert.throws(() =>
    normalizeSourceObject(
      source,
      { ...audit, point: { lon: 8.3, lat: 46.6 } },
      context,
    ),
  );
  assert.throws(() =>
    normalizeSourceObject(
      source,
      {
        ...audit,
        geometry_type: 'Polygon',
        point_derivation: 'validated_polygon_interior',
      },
      context,
    ),
  );
});
