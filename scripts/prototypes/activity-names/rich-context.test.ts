import assert from 'node:assert/strict';

import test from 'node:test';

import type { Candidate, Point } from './matching';
import { richContext, richTsv } from './rich-context';

const candidate: Candidate = {
  id: 'node/123',
  name: 'Test summit',
  aliases: [],
  kind: 'peak',
  lat: 0,
  lon: 0.01,
  elevation: 1800,
  tags: { natural: 'peak' },
  distanceM: 0,
  km: 1,
  altitude: 1000,
  climbM: 20,
  accepted: false,
  reason: 'Elevation mismatch',
};
const points: Point[] = Array.from({ length: 21 }, (_, i) => ({
  lat: 0,
  lon: i * 0.001,
  km: i * 0.1112,
  altitude: 900 + i * 10,
}));

void test('retains rejected candidates and reports evidence without eligibility labels or coordinates', () => {
  const context = richContext('hike', [candidate], points);
  assert.equal(context.features.length, 1);
  assert.equal(context.features[0]!.osmElevationM, 1800);
  assert.equal(context.encounters[0]!.routeElevationM, 1000);
  assert.equal(context.encounters[0]!.routePercent, 50);
  assert.equal(context.encounters[0]!.riseBefore2kmM, 100);
  assert.equal(context.encounters[0]!.dropAfter2kmM, 0);
  for (const absent of [
    '"lat"',
    '"lon"',
    'accepted',
    'reason',
    'primary_destination',
    'node/123',
  ])
    assert.ok(!JSON.stringify(context).includes(absent));
});
void test('keeps separate ascent/return approaches and does not bridge GPS gaps', () => {
  const back = points
    .slice(0, -1)
    .reverse()
    .map((p, i) => ({ ...p, km: points.at(-1)!.km + (i + 1) * 0.1112 }));
  const context = richContext('hike', [candidate], [...points, ...back]);
  assert.equal(context.encounters.length, 2);
  assert.deepEqual(
    context.encounters.map((e) => e.routePercent),
    [25, 75],
  );
  const gap = richContext('hike', [candidate], [points[0]!, points.at(-1)!]);
  assert.equal(gap.encounters.length, 0);
});
void test('TSV uses a shared header and quotes names with tabs/newlines', () => {
  const context = richContext(
    'hike',
    [{ ...candidate, name: 'A\tB\n"C"' }],
    points,
  );
  const tsv = richTsv(context);
  assert.ok(tsv.includes('"A\tB\n""C"""'));
  assert.equal(tsv.split('routeElevationM').length - 1, 1);
  assert.ok(tsv.length < JSON.stringify(context).length);
});
