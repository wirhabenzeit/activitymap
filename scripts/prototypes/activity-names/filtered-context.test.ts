import assert from 'node:assert/strict';

import test from 'node:test';

import {
  type ChoiceAnswer,
  type FilteredContext,
  assemble,
  decisionInput,
  deduplicate,
  filterContext,
  highPoints,
} from './filtered-context';
import type { RichContext } from './rich-context';

const feature = (
  key: string,
  type: 'peak' | 'pass' | 'place',
  distance = 8000,
): RichContext['features'][number] => ({
  key,
  name: key,
  localName: null,
  type,
  natural: type === 'peak' ? 'peak' : null,
  mountainPass: type === 'pass',
  place: type === 'place' ? 'village' : null,
  aerialway: null,
  osmElevationM: 1500,
  startDistanceM: distance,
  endDistanceM: distance,
  wikipedia: null,
  wikidata: null,
});

void test('deduplicates nearby equal names without collapsing distinct mountains or distant namesakes', () => {
  const rich = {
    route,
    features: [
      feature('a', 'peak'),
      { ...feature('b', 'peak'), name: 'a' },
      { ...feature('c', 'peak'), name: 'a' },
      feature('d', 'peak'),
    ],
    encounters: [
      encounter('a', 3),
      encounter('b', 0),
      encounter('c', 5),
      encounter('d', 1),
    ],
  };
  const unique = deduplicate(rich, [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.001 },
    { lat: 0, lon: 0.01 },
    { lat: 0, lon: 0.001 },
  ]);
  assert.deepEqual(
    unique.context.features.map((f) => f.key),
    ['a', 'c', 'd'],
  );
  assert.equal(unique.context.encounters[1]?.feature, 'a');
  assert.equal(unique.merged.b, 'a');
});

void test('keeps decisions visible but renders an exact duplicate display name once', () => {
  const context: FilteredContext = {
    route,
    features: [
      feature('pass', 'pass'),
      { ...feature('station', 'place'), name: 'pass' },
    ],
    encounters: [encounter('pass', 0), encounter('station', 20)],
    highPoints: [],
  };
  const { questions } = decisionInput(context);
  const answers = Object.fromEntries(
    Object.keys(questions).map((k) => [
      k,
      {
        choice: k.endsWith('_visit')
          ? 'supported'
          : k.endsWith('_role')
            ? 'main'
            : 'none',
      },
    ]),
  );
  const result = assemble(context, questions, answers);
  assert.equal(result.title, 'pass');
  assert.equal(result.selectedEvidence.length, 2);
});
const encounter = (
  feature: string,
  distanceM: number,
): RichContext['encounters'][number] => ({
  key: `e_${feature}`,
  feature,
  routePercent: 50,
  distanceM,
  routeElevationM: 1500,
  riseBefore2kmM: 0,
  dropAfter2kmM: 10,
  riseBefore10kmM: 0,
  dropAfter10kmM: 100,
});
const route: RichContext['route'] = {
  sport: 'bike',
  distanceKm: 40,
  startEndDistanceM: 10000,
  minElevationM: 1000,
  maxElevationM: 1600,
  startElevationM: 1000,
  endElevationM: 1000,
};

void test('retains directly crossed descending pass and obscure peak without popularity or ascent gates', () => {
  const rich = {
    route,
    features: [
      feature('pass', 'pass'),
      feature('peak', 'peak'),
      feature('remote', 'place'),
    ],
    encounters: [
      encounter('pass', 4),
      encounter('peak', 0),
      encounter('remote', 1000),
    ],
  };
  const filtered = filterContext(rich, []);
  assert.deepEqual(
    filtered.context.features.map((f) => f.key),
    ['pass', 'peak'],
  );
  assert.equal(filtered.audit.removed[0]?.key, 'remote');
});
void test('keeps uncertain high-point peaks without silently treating them as visited', () => {
  const rich = {
    route,
    features: [{ ...feature('above', 'peak'), osmElevationM: 2100 }],
    encounters: [encounter('above', 900)],
  };
  assert.equal(filterContext(rich, []).context.features.length, 0);
  const { context } = filterContext(rich, [
    { routePercent: 50, elevationM: 1500 },
  ]);
  assert.equal(context.features.length, 1);
  const { questions } = decisionInput(context);
  const answers = {
    above_visit: { choice: 'uncertain' },
    above_role: { choice: 'main' },
    start: { choice: 'none' },
    end: { choice: 'none' },
  };
  assert.equal(assemble(context, questions, answers).title, null);
});
void test('missing elevations do not become zero; high-point extraction handles missing altitude', () => {
  assert.deepEqual(
    highPoints([
      { lat: 0, lon: 0, km: 0 },
      { lat: 0, lon: 0.01, km: 1 },
    ]),
    [],
  );
  const points = Array.from({ length: 41 }, (_, i) => ({
    lat: 0,
    lon: i / 1000,
    km: i / 10,
    altitude: 1000 + (20 - Math.abs(i - 20)) * 20,
  }));
  const peaks = highPoints(points);
  assert.ok(peaks.some((p) => p.routePercent >= 45 && p.routePercent <= 55));
});
void test('endpoint fallback needs actual endpoint candidates and destination assembly prevents invalid loop labels', () => {
  const context: FilteredContext = {
    route,
    features: [
      feature('main', 'peak'),
      { ...feature('start', 'place', 50), endDistanceM: 8000 },
      { ...feature('end', 'place', 70), startDistanceM: 8000 },
    ],
    encounters: [encounter('main', 0)],
    highPoints: [],
  };
  const { questions } = decisionInput(context);
  assert.ok(!('end' in questions.start!.criteria));
  const answers: Record<string, ChoiceAnswer> = Object.fromEntries(
    Object.keys(questions).map((k) => [
      k,
      { choice: k.endsWith('_visit') ? 'supported' : 'incidental' },
    ]),
  );
  answers.start = { choice: 'start' };
  answers.end = { choice: 'end' };
  assert.equal(assemble(context, questions, answers).title, 'start – end');
  answers.main_role = { choice: 'main' };
  assert.equal(assemble(context, questions, answers).title, 'main');
  answers.main_visit = { choice: 'unknown' };
  assert.throws(() => assemble(context, questions, answers), /Invalid/);
});
