import assert from 'node:assert/strict';

import test from 'node:test';

import {
  type MergeCandidate,
  defaultMergedDescription,
  defaultMergedName,
  formatGap,
  planMerge,
} from './eligibility';

const base = Date.parse('2026-06-01T06:00:00Z');
function part(
  id: number,
  startMinutes: number,
  elapsedMinutes: number,
  overrides: Partial<MergeCandidate> = {},
): MergeCandidate {
  return {
    id,
    name: `Part ${id}`,
    sport_type: 'Ride',
    start_date: new Date(base + startMinutes * 60_000),
    elapsed_time: elapsedMinutes * 60,
    manual: false,
    trainer: false,
    private: false,
    map_summary_polyline: 'abc',
    start_latlng: [46, 8],
    end_latlng: [46, 8],
    kudos_count: 0,
    comment_count: 0,
    total_photo_count: 0,
    ...overrides,
  };
}

void test('orders parts by start and measures the gaps between them', () => {
  const plan = planMerge([part(2, 120, 60), part(1, 0, 90)]);
  assert.deepEqual(
    plan.parts.map((value) => value.id),
    [1, 2],
  );
  assert.deepEqual(plan.gaps, [{ after: '1', seconds: 30 * 60, meters: 0 }]);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.sport, 'Ride');
});

void test('blocks overlapping, manual, too distant and single selections', () => {
  assert.deepEqual(
    planMerge([part(1, 0, 60)]).blockers.map((value) => value.code),
    ['too_few'],
  );
  assert.deepEqual(
    planMerge([part(1, 0, 60), part(2, 30, 60)]).blockers.map(
      (value) => value.code,
    ),
    ['overlap'],
  );
  assert.deepEqual(
    planMerge([part(1, 0, 60, { manual: true }), part(2, 90, 60)]).blockers,
    [{ code: 'manual', id: '1' }],
  );
  assert.deepEqual(
    planMerge([part(1, 0, 60), part(2, 60 + 25 * 60, 60)]).blockers.map(
      (value) => value.code,
    ),
    ['gap_too_long'],
  );
  assert.deepEqual(
    planMerge([part(1, 0, 60), part(2, 90, 60, { map_summary_polyline: null })])
      .blockers,
    [{ code: 'mixed_gps' }],
  );
});

void test('an overnight break is allowed but called out', () => {
  const plan = planMerge([part(1, 0, 600), part(2, 600 + 4 * 60, 300)]);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.warnings, [
    { code: 'long_gap', after: '1', seconds: 4 * 3600 },
  ]);
});

void test('another library activity inside the span makes it non-consecutive', () => {
  const selected = [part(1, 0, 60), part(3, 180, 60)];
  const library = [...selected, part(2, 90, 30), part(4, 500, 30)];
  assert.deepEqual(planMerge(selected, library).blockers, [
    { code: 'not_consecutive', between: ['2'] },
  ]);
});

void test('warns about jumps, mixed sports, privacy, photos and social loss', () => {
  const plan = planMerge([
    part(1, 0, 60, {
      end_latlng: [46, 8],
      kudos_count: 3,
      total_photo_count: 2,
    }),
    part(2, 90, 30, {
      start_latlng: [46.1, 8],
      sport_type: 'Run',
      private: true,
      comment_count: 1,
    }),
  ]);
  assert.deepEqual(
    plan.warnings.map((value) => value.code),
    ['jump', 'mixed_sports', 'private_part', 'photos', 'social'],
  );
  // The longest-running sport wins.
  assert.equal(plan.sport, 'Ride');
});

void test('default name and description join distinct parts', () => {
  const parts = [part(1, 0, 60), part(2, 90, 60, { name: 'Part 1' })];
  assert.equal(defaultMergedName(parts), 'Part 1');
  assert.equal(
    defaultMergedName([part(1, 0, 60), part(2, 90, 60)]),
    'Part 1 + Part 2',
  );
  assert.equal(
    defaultMergedDescription([
      { ...part(1, 0, 60), description: ' Morning ' },
      { ...part(2, 90, 60), description: null },
      { ...part(3, 200, 60), description: 'Evening' },
    ]),
    'Morning\n\nEvening',
  );
});

void test('formats gaps', () => {
  assert.equal(formatGap(45 * 60), '45 min');
  assert.equal(formatGap(2 * 3600), '2 h');
  assert.equal(formatGap(4 * 3600 + 12 * 60), '4 h 12 min');
});
