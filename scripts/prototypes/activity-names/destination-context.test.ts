import assert from 'node:assert/strict';

import test from 'node:test';

import {
  destinationContext,
  focusedVisitationInput,
  visitationInput,
} from './destination-context';
import type { FilteredContext } from './filtered-context';

function fixture(sport: string): FilteredContext {
  return {
    route: {
      sport,
      distanceKm: 20,
      startEndDistanceM: 10,
      minElevationM: 500,
      maxElevationM: 2000,
      startElevationM: 500,
      endElevationM: 500,
    },
    highPoints: [{ routePercent: 50, elevationM: 2000 }],
    features: [
      {
        key: 'f1',
        name: 'Peak',
        type: 'peak',
        osmElevationM: 2010,
        place: null,
      },
      {
        key: 'f2',
        name: 'Far peak',
        type: 'peak',
        osmElevationM: 2100,
        place: null,
      },
      {
        key: 'f3',
        name: 'Interior hamlet',
        type: 'place',
        osmElevationM: null,
        place: 'hamlet',
      },
      {
        key: 'f4',
        name: 'Ordinary locality',
        type: 'place',
        osmElevationM: null,
        place: 'locality',
      },
    ].map((f) => ({
      ...f,
      type: f.type as 'peak' | 'place',
      localName: null,
      natural: null,
      mountainPass: false,
      aerialway: null,
      startDistanceM: 4000,
      endDistanceM: 4000,
      wikipedia: null,
      wikidata: null,
    })),
    encounters: ['f1', 'f2', 'f3', 'f4'].map((feature, i) => ({
      key: `e${i}`,
      feature,
      routePercent: i > 1 ? 75 : 50,
      distanceM: i === 1 ? 700 : 5,
      routeElevationM: 2000,
      riseBefore2kmM: 100,
      dropAfter2kmM: 100,
      riseBefore10kmM: 500,
      dropAfter10kmM: 500,
    })),
  };
}
void test('cycling retains a close high-point summit without widening to distant peaks or arbitrary localities', () => {
  const result = destinationContext(fixture('bike'));
  assert.ok(result.context.features.some((f) => f.key === 'f1'));
  assert.ok(!result.context.features.some((f) => ['f2', 'f4'].includes(f.key)));
});
void test('a close interior hamlet survives independently of route high points', () => {
  const result = destinationContext(fixture('hike'));
  assert.ok(result.context.features.some((f) => f.key === 'f3'));
  assert.ok(!result.context.features.some((f) => f.key === 'f4'));
});
void test('visit questions retain signed encounter-specific evidence and missing heights', () => {
  const context = fixture('ski');
  context.features[0]!.osmElevationM = 2110;
  context.features[1]!.osmElevationM = 1880;
  const input = visitationInput(context);
  assert.match(
    input.questions.f1_visit!.instructions,
    /110 m \(feature substantially ABOVE track\)/,
  );
  assert.match(
    input.questions.f2_visit!.instructions,
    /-120 m \(feature substantially BELOW track\)/,
  );
  assert.match(
    input.questions.f3_visit!.instructions,
    /elevation agreement unknown/,
  );
  const reversed = visitationInput(context, true);
  assert.equal(input.state, reversed.state);
  for (const [key, q] of Object.entries(input.questions))
    assert.deepEqual(
      Object.entries(q.criteria),
      Object.entries(reversed.questions[key]!.criteria).reverse(),
    );
});

void test('focused visitation keeps separate approach heights and uses point-specific criteria', () => {
  const context = fixture('ski');
  context.features[0]!.osmElevationM = 2110;
  context.encounters.push({
    ...context.encounters[0]!,
    key: 'another',
    routePercent: 60,
    routeElevationM: 2115,
    distanceM: 240,
  });
  const input = focusedVisitationInput(context);
  const instructions = input.questions.f1_visit!.instructions;
  assert.match(
    instructions,
    /map minus track 110 m\. Substantial height mismatch: YES/,
  );
  assert.match(
    instructions,
    /map minus track -5 m\. Substantial height mismatch: NO/,
  );
  assert.match(instructions, /This is a point feature/);
  assert.ok(
    !input.questions.f1_visit!.criteria.supported!.includes('area centre'),
  );
  assert.match(
    input.questions.f3_visit!.instructions,
    /Substantial height mismatch: unknown/,
  );
});
