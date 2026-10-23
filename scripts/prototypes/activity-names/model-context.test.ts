import assert from 'node:assert/strict';

import test from 'node:test';

import type { Feature, MatchResult } from './matching';
import {
  type ModelContext,
  buildContexts,
  englishName,
  validateSelection,
} from './model-context';

const place: Feature = {
  id: 'node/1',
  name: 'Жер',
  aliases: [],
  kind: 'place',
  lat: 42,
  lon: 74,
  tags: {
    'name:en': 'English place',
    int_name: 'International place',
    secret: 'must not cross boundary',
  },
};
function context() {
  const result: MatchResult & { activity: { category: string } } = {
    title: 'Existing private title',
    confidence: 'low',
    selected: [],
    candidates: [],
    startPlace: place.name,
    startFeature: place,
    endPlace: place.name,
    endFeature: { ...place, id: 'node/2' },
    loop: false,
    warnings: [],
    activity: { category: 'bike' },
  };
  return buildContexts([result])[0]!;
}
void test('English OSM names take priority, then international, then original', () => {
  assert.equal(englishName(place), 'English place');
  assert.equal(
    englishName({ ...place, tags: { int_name: 'Latin name' } }),
    'Latin name',
  );
  assert.equal(englishName({ ...place, tags: {} }), 'Жер');
});
void test('endpoint metadata survives while private fields stay out of model context', () => {
  const c = context();
  assert.equal(c.features[0]!.englishName, 'English place');
  assert.equal(c.features[0]!.role, 'start');
  const serialized = JSON.stringify(c);
  for (const excluded of [
    'Existing private title',
    'secret',
    'node/1',
    '"lat"',
    '"lon"',
  ])
    assert.ok(!serialized.includes(excluded));
});
void test('endpoints cannot masquerade as destinations or swap order', () => {
  const c = context();
  assert.deepEqual(
    validateSelection(c, {
      selectedKeys: ['feature_1', 'feature_2'],
      format: 'point_to_point',
    }),
    [],
  );
  assert.ok(
    validateSelection(c, {
      selectedKeys: ['feature_1'],
      format: 'destinations',
    }).length,
  );
  assert.ok(
    validateSelection(c, {
      selectedKeys: ['feature_2', 'feature_1'],
      format: 'point_to_point',
    }).length,
  );
  c.features.pop();
  assert.ok(
    validateSelection(c, {
      selectedKeys: ['feature_1'],
      format: 'point_to_point',
    }).length,
  );
});
void test('uncertainty and destination loops are rejected without rewriting model output', () => {
  const c: ModelContext = context();
  c.loop = true;
  c.features = [
    {
      ...c.features[0]!,
      type: 'peak',
      role: 'visited_feature_but_destination_uncertain',
    },
  ];
  assert.ok(
    validateSelection(c, {
      selectedKeys: ['feature_1'],
      format: 'destinations',
    }).length,
  );
  assert.deepEqual(
    validateSelection(c, { selectedKeys: [], format: 'abstain' }),
    [],
  );
  c.features[0]!.role = 'primary_destination';
  assert.ok(
    validateSelection(c, { selectedKeys: ['feature_1'], format: 'loop' })
      .length,
  );
  assert.deepEqual(
    validateSelection(c, {
      selectedKeys: ['feature_1'],
      format: 'destinations',
    }),
    [],
  );
});
