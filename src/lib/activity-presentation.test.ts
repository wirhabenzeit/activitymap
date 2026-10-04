import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  aggregateMetric,
  compareActivities,
  sortActivities,
  type Reducer,
} from './activity-presentation';
import {
  formatMeasurement,
  measurementScale,
  type Measurement,
  type UnitSystem,
} from './units';
import { statsFormat } from '~/components/stats/tiles/format';

type Projection = {
  id: string;
  geometry_state?: string;
  [key: string]: unknown;
};
const corpus = JSON.parse(
  readFileSync('shared/parity/activity-fixtures.v1.json', 'utf8'),
) as {
  activities: Projection[];
  sortCases: {
    name: string;
    ids: string[];
    sort: { field: string; direction: string };
    expected_ids: string[];
  }[];
  summaryCases: {
    name: string;
    ids: string[];
    expected: Record<
      string,
      | number
      | {
          known_count: number;
          sum?: number | null;
          mean?: number | null;
          min?: number | null;
          max?: number | null;
        }
    >;
  }[];
};
for (const fixture of corpus.sortCases) {
  void test(`web sorting: ${fixture.name}`, () => {
    const rows = corpus.activities
      .filter((row) => fixture.ids.includes(row.id))
      .map((row) => ({
        ...row,
        id: Number(row.id),
        geometryState: row.geometry_state,
      }));
    const sorted = rows.sort((a, b) =>
      compareActivities(a, b, [
        { id: fixture.sort.field, desc: fixture.sort.direction === 'desc' },
      ]),
    );
    assert.deepEqual(
      sorted.map((row) => String(row.id)),
      fixture.expected_ids,
    );
  });
}
for (const fixture of corpus.summaryCases) {
  void test(`web aggregation: ${fixture.name}`, () => {
    const rows = corpus.activities.filter((row) =>
      fixture.ids.includes(row.id),
    );
    for (const [field, expected] of Object.entries(fixture.expected)) {
      if (typeof expected === 'number') continue;
      const reducer = (['sum', 'mean', 'min', 'max'] as const).find(
        (key) => key in expected,
      )!;
      const actual = aggregateMetric(
        rows.map((row) => row[field] as number | null | undefined),
        reducer,
      );
      assert.equal(actual.value, expected[reducer], field);
      assert.equal(actual.known, expected.known_count, field);
    }
  });
}
void test('all metric reducers ignore nonfinite/unknown values while retaining measured zero', () => {
  for (const reducer of ['sum', 'mean', 'min', 'max'] as Reducer[]) {
    assert.deepEqual(
      aggregateMetric([null, undefined, NaN, Infinity, 0], reducer),
      { value: 0, known: 1, total: 5 },
    );
  }
});
void test('null stays last in both directions; text compares NFC Unicode scalars and ties use numeric ID', () => {
  const rows = [
    { id: 2, name: null },
    { id: 10, name: 'Café' },
    { id: 3, name: 'Cafe\u0301' },
    { id: 4, name: '\u{10000}' },
    { id: 5, name: '\uE000' },
  ];
  assert.deepEqual(
    [...rows]
      .sort((a, b) => compareActivities(a, b, [{ id: 'name', desc: false }]))
      .map((r) => r.id),
    [10, 3, 5, 4, 2],
  );
  assert.deepEqual(
    [...rows]
      .sort((a, b) => compareActivities(a, b, [{ id: 'name', desc: true }]))
      .map((r) => r.id),
    [4, 5, 10, 3, 2],
  );
});
const unitsCorpus = JSON.parse(
  readFileSync('shared/parity/display-units.v1.json', 'utf8'),
) as {
  cases: {
    kind: Measurement;
    value: number | null;
    metric: string;
    imperial: string;
  }[];
};
void test('shared web/iOS display-unit fixtures', () => {
  for (const row of unitsCorpus.cases)
    for (const units of ['metric', 'imperial'] as UnitSystem[])
      assert.equal(formatMeasurement(row.value, row.kind, units), row[units]);
});
void test('unit input round trips preserve physical thresholds, ordering and Stats meaning', () => {
  for (const kind of ['distance', 'elevation', 'speed'] as const) {
    const canonical = 1234.567;
    const displayed = canonical / measurementScale(kind, 'imperial');
    assert.ok(
      Math.abs(displayed * measurementScale(kind, 'imperial') - canonical) <
        1e-9,
    );
  }
  const format = statsFormat('imperial');
  assert.equal(format.formatWithUnit(1.609344, 'distance'), '1 mi');
  assert.equal(format.formatWithUnit(304.8, 'elevation'), '1,000 ft');
  assert.equal(format.formatHilliness(100), '528.0');
  assert.equal(format.metricUnit.distance, 'mi');
});

void test('date choices preserve the activity-local day across viewer timezones', async () => {
  const { formatPreferredDate } = await import('./date-preferences');
  const corpus = JSON.parse(
    readFileSync('shared/parity/display-units.v1.json', 'utf8'),
  ) as {
    dateCases: {
      value: string;
      'day-first': string;
      'month-first': string;
      iso: string;
    }[];
  };
  const original = process.env.TZ;
  try {
    for (const zone of [
      'Pacific/Honolulu',
      'Europe/Zurich',
      'Pacific/Kiritimati',
    ]) {
      process.env.TZ = zone;
      for (const row of corpus.dateCases)
        for (const format of ['day-first', 'month-first', 'iso'] as const)
          assert.equal(formatPreferredDate(row.value, format), row[format]);
    }
    assert.equal(
      formatPreferredDate('2026-12-31T23:59:00Z', 'system', 'en-US'),
      '12/31/2026',
    );
    assert.equal(
      formatPreferredDate('2026-12-31T23:59:00Z', 'system', 'en-GB'),
      '31/12/2026',
    );
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

void test('every numeric list column sorts canonical values in both directions', () => {
  const fields = [
    'distance',
    'moving_time',
    'elapsed_time',
    'total_elevation_gain',
    'elev_high',
    'elev_low',
    'average_speed',
    'weighted_average_watts',
    'average_watts',
    'max_watts',
    'max_heartrate',
    'average_heartrate',
  ];
  for (const field of fields) {
    const rows = [
      { id: 1, [field]: null },
      { id: 2, [field]: 1.001 },
      { id: 3, [field]: 1.002 },
      { id: 4, [field]: 1.001 },
      { id: 5, [field]: 0 },
    ];
    for (const desc of [false, true]) {
      assert.deepEqual(
        [...rows]
          .sort((a, b) => compareActivities(a, b, [{ id: field, desc }]))
          .map((row) => row.id),
        desc ? [3, 4, 2, 5, 1] : [5, 4, 2, 3, 1],
        field,
      );
    }
  }
});
void test('default, date, description and photo sorts use the actual list accessors', () => {
  const rows = [
    {
      id: 2,
      description: 'B',
      start_date_local: new Date('2026-12-31T23:00:00Z'),
      total_photo_count: 2,
      photos: [],
    },
    {
      id: 10,
      description: 'a',
      start_date_local: new Date('2026-01-01T01:00:00Z'),
      total_photo_count: 1,
      photos: [{ id: 'cached' }],
    },
    {
      id: 3,
      description: null,
      start_date_local: null,
      total_photo_count: null,
      photos: [],
    },
  ];
  assert.deepEqual(
    [...rows].sort((a, b) => compareActivities(a, b, [])).map((r) => r.id),
    [10, 3, 2],
  );
  assert.deepEqual(
    [...rows]
      .sort((a, b) => compareActivities(a, b, [{ id: 'id', desc: false }]))
      .map((r) => r.id),
    [2, 3, 10],
  );
  for (const id of ['date', 'description', 'photos']) {
    for (const desc of [false, true]) {
      assert.deepEqual(
        [...rows]
          .sort((a, b) => compareActivities(a, b, [{ id, desc }]))
          .map((r) => r.id),
        desc ? [2, 10, 3] : [10, 2, 3],
        id,
      );
    }
  }
});

void test('sortActivities matches compareActivities without mutating its input', () => {
  const rows = [
    { id: 1, name: 'b', distance: null },
    { id: 2, name: 'B', distance: 5 },
    { id: 3, name: '\u{1F600}', distance: NaN },
    { id: 4, name: '\uFFFD', distance: 5 },
    { id: 5, name: null, distance: 0 },
  ];
  const before = rows.map((row) => row.id);
  for (const sorting of [
    [],
    [{ id: 'name', desc: false }],
    [{ id: 'name', desc: true }],
    [{ id: 'distance', desc: false }],
    [{ id: 'distance', desc: true }],
  ]) {
    assert.deepEqual(
      sortActivities(rows, sorting).map((row) => row.id),
      [...rows]
        .sort((a, b) => compareActivities(a, b, sorting))
        .map((row) => row.id),
      JSON.stringify(sorting),
    );
  }
  assert.deepEqual(
    sortActivities(rows, [{ id: 'name', desc: false }]).map((row) => row.id),
    [2, 1, 4, 3, 5],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    before,
  );
});
void test('values that round to zero never display as negative zero', () => {
  assert.equal(formatMeasurement(-0.2, 'elevation', 'metric'), '0 m');
  assert.equal(formatMeasurement(-0.01, 'distance', 'imperial'), '0.0 mi');
  assert.equal(formatMeasurement(-0.6, 'elevation', 'metric'), '-1 m');
});
