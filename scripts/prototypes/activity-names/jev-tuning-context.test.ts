import assert from 'node:assert/strict';

import test from 'node:test';

import type { FilteredContext } from './filtered-context';
import { compactRows, slimContext, tunedInput } from './jev-tuning-context';

const context: FilteredContext = {
  route: {
    sport: 'hike',
    distanceKm: 20,
    startEndDistanceM: 10,
    minElevationM: 500,
    maxElevationM: 2000,
    startElevationM: 500,
    endElevationM: 500,
  },
  highPoints: [],
  features: [
    {
      key: 'f1',
      name: 'Mountain',
      type: 'peak',
      osmElevationM: 2007,
      place: null,
      aerialway: null,
    },
    {
      key: 'f2',
      name: 'Mountain cable car',
      type: 'place',
      osmElevationM: 1995,
      place: null,
      aerialway: 'station',
    },
    {
      key: 'f3',
      name: 'Obscure mountain',
      type: 'peak',
      osmElevationM: null,
      place: null,
      aerialway: null,
    },
    {
      key: 'f4',
      name: 'Pass',
      type: 'pass',
      osmElevationM: 1000,
      place: null,
      aerialway: null,
    },
  ].map((f) => ({
    ...f,
    type: f.type as 'peak' | 'place' | 'pass',
    localName: null,
    natural: null,
    mountainPass: f.type === 'pass',
    startDistanceM: 8000,
    endDistanceM: 8000,
    wikipedia: null,
    wikidata: null,
  })),
  encounters: ['f1', 'f2', 'f3', 'f4'].map((feature, i) => ({
    key: `e${i}`,
    feature,
    routePercent: 50,
    distanceM: 4,
    routeElevationM: i === 3 ? 1000 : 2000,
    riseBefore2kmM: 0,
    dropAfter2kmM: 100,
    riseBefore10kmM: 0,
    dropAfter10kmM: 200,
  })),
};
void test('small shortlist removes station duplicates but preserves distinct obscure peaks and descending cycling passes', () => {
  const slim = slimContext(context);
  assert.deepEqual(
    slim.context.features.map((f) => f.key),
    ['f1', 'f3', 'f4'],
  );
  assert.equal(slim.audit.removed[0]?.key, 'f2');
  const bike = slimContext({
    ...context,
    route: { ...context.route, sport: 'bike' },
  });
  assert.deepEqual(
    bike.context.features.map((f) => f.key),
    ['f4'],
  );
});
void test('computes signed elevation gaps and preserves unknowns without doing model arithmetic', () => {
  const rows = compactRows(context);
  assert.equal(rows[0]?.verticalGapM, 7);
  assert.equal(rows[0]?.verticalEvidence, 'elevations closely agree');
  assert.equal(rows[1]?.verticalGapM, -5);
  assert.equal(rows[2]?.verticalGapM, null);
  assert.equal(rows[2]?.verticalEvidence, 'unknown');
});
void test('option-order control changes only option order, not data or criteria', () => {
  const normal = tunedInput(context),
    reverse = tunedInput(context, true);
  assert.equal(normal.state, reverse.state);
  for (const key of Object.keys(normal.questions)) {
    assert.deepEqual(
      Object.entries(normal.questions[key]!.criteria),
      Object.entries(reverse.questions[key]!.criteria).reverse(),
    );
    assert.equal(
      normal.questions[key]!.instructions,
      reverse.questions[key]!.instructions,
    );
  }
  for (const field of ['"lat":', '"lon":', '"activityId":'])
    assert.ok(!normal.state.includes(field));
});
