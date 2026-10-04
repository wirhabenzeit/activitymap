import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { statsTiles } from '~/settings/stats-tiles.generated';
import { dayFromISODate, type StatsActivity } from '~/lib/stats/tile-data';
import { tileView, type TileContext } from './tiles';
import { tilePalette, formatDailyRate } from './format';
import { MonthRows } from './calendar';
import { statsCapabilitiesSchema } from '../../../../scripts/lib/stats-parity-schema';

void test('the shared capability matrix matches actual visible and expandable web tiles', () => {
  const contract = statsCapabilitiesSchema.parse(
    JSON.parse(readFileSync('shared/stats-capabilities.v1.json', 'utf8')),
  );
  assert.equal(
    contract.tiles.filter((tile) => tile.visibility === 'visible').length,
    10,
  );
  for (const tile of contract.tiles) {
    const view = tileView(tile.id as (typeof statsTiles)[number]['id']);
    assert.equal(Boolean(view), tile.visibility === 'visible', tile.id);
    assert.equal(view?.expandable ?? false, tile.expandable, tile.id);
  }
  assert.deepEqual(
    contract.tiles
      .filter((tile) => tile.visibility === 'visible')
      .map((tile) => tile.id),
    statsTiles.filter((tile) => tileView(tile.id)).map((tile) => tile.id),
    'section and within-section order must agree with the rendered catalogue',
  );
});

const today = dayFromISODate('2026-09-01');
const make = (
  date: string,
  sport: StatsActivity['sport'],
  time = 3600,
): StatsActivity => ({
  id: 42,
  name: 'Fixture ride',
  start_date_local: new Date(`${date}T12:00:00Z`),
  sport,
  distance: 10000,
  moving_time: time,
  total_elevation_gain: 100,
});
const context: TileContext = {
  today,
  activities: [make('2025-09-15', 'run'), make('2026-08-31', 'ride', 7200)],
  palette: tilePalette(false),
};

void test('all declared options have renderable summaries and periods', () => {
  for (const tile of statsTiles) {
    const view = tileView(tile.id);
    if (!view) continue;
    for (const option of 'toggle' in tile ? tile.toggle.options : [undefined]) {
      assert.ok(view.period(context, option));
      const summary = view.summary(context, option);
      if (summary) {
        assert.ok(!summary.value.includes('NaN'), `${tile.id}: ${option}`);
        renderToStaticMarkup(createElement('div', null, summary.sub));
      }
      assert.ok(view.face(context, option, false));
      assert.ok(view.face(context, option, true));
    }
  }
});

void test('consistency is retired while Typical week retains activity frequency', () => {
  assert.equal(tileView('consistency'), null);
  assert.equal(tileView('restDays'), null);
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      tileView('typicalWeek')!.summary(context, undefined)!.sub,
    ),
  );
  assert.match(html, /active days/);
});

void test('all-time sport mix uses the same range for summary, chart and table', () => {
  const view = tileView('sportMix')!;
  const summary = view.summary(context, 'allTime')!;
  assert.equal(summary.value, '67%');
  assert.match(view.period(context, 'allTime'), /All time/);
  const chart = renderToStaticMarkup(
    view.face(context, 'allTime', true) as ReactElement,
  );
  const table = renderToStaticMarkup(
    view.more!(context, 'allTime') as ReactElement,
  );
  assert.match(chart, /Run/);
  assert.match(table, /Run/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      view.face(context, 'currentYear', true) as ReactElement,
    ),
    /Run/,
  );
});

void test('calendar renders the counted starting month with accessible metric values', () => {
  const day = dayFromISODate('2025-09-15');
  const html = renderToStaticMarkup(
    createElement(MonthRows, {
      today,
      dominantSport: new Map([[day, 'run' as const]]),
      totals: new Map([
        [day, { count: 1, distance: 10, time: 1, elevation: 100 }],
      ]),
      palette: context.palette,
      colorBy: 'distance',
    }),
  );
  assert.match(html, /Sep 15, 2025: Run, 10 km/);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.equal((html.match(/<button/g) ?? []).length, 366);
});

void test('expanded records retain activity identities for drill-down', () => {
  const view = tileView('records')!;
  const html = renderToStaticMarkup(
    view.detail!(
      { ...context, onOpenActivity: () => undefined },
      undefined,
    ) as ReactElement,
  );
  assert.match(html, /<button[^>]*>Fixture ride<\/button>/);
});

void test('records wait for a full within-year 30-day window before comparing totals', () => {
  assert.equal(tileView('best30Days'), null);
  const view = tileView('records')!;
  const sample = {
    ...context,
    activities: [
      { ...make('2025-12-31', 'ride'), distance: 100000 },
      make('2026-01-01', 'run'),
    ],
  };
  for (const date of ['2026-01-01', '2026-01-29']) {
    const html = renderToStaticMarkup(
      view.detail!(
        { ...sample, today: dayFromISODate(date) },
        undefined,
      ) as ReactElement,
    );
    assert.match(html, /first complete 30-day window/);
    assert.doesNotMatch(html, /Last 30 days:|%/);
  }
  const html = renderToStaticMarkup(
    view.detail!(
      { ...sample, today: dayFromISODate('2026-01-30') },
      undefined,
    ) as ReactElement,
  );
  assert.match(html, /Best 30 days/);
  assert.match(html, /Jan 1.*Jan 30/);
  assert.match(html, /Last 30 days: 10 km/);
  assert.equal((html.match(/100% of best/g) ?? []).length, 3);
  assert.doesNotMatch(html, /style="width:/);
  assert.doesNotMatch(html, /1100%/);
});

void test('records avoid percentages when a complete window has no recorded metric', () => {
  const html = renderToStaticMarkup(
    tileView('records')!.detail!(
      { ...context, activities: [] },
      undefined,
    ) as ReactElement,
  );
  assert.match(html, /No distance recorded this year/);
  assert.doesNotMatch(html, /NaN|Infinity|%/);
});

void test('projection headline is the year-end total rather than its daily rate', () => {
  const summary = tileView('yearPace')!.summary(
    {
      ...context,
      today: dayFromISODate('2026-01-10'),
      activities: [make('2026-01-01', 'run')],
    },
    'distance',
  )!;
  assert.equal(summary.value, '365');
  assert.equal(summary.unit, 'km projected');
});

void test('expanded training history exposes bounded presets and period totals', () => {
  const view = tileView('weeklyVolume')!;
  const html = renderToStaticMarkup(
    view.detail!(context, 'time') as ReactElement,
  );
  assert.match(html, /Volume grouping/);
  assert.doesNotMatch(
    html,
    /Volume chart style|>Area<|>Bars<|Previous period|Next period/,
  );
  assert.match(html, />By week</);
  assert.match(html, /role="combobox"/);
  assert.match(html, /2\.0 h/);
  assert.match(html, /Period totals/);
  assert.doesNotMatch(html, /Latest week incomplete/);
  assert.match(html, /Period totals by sport/);
  assert.match(html, /scope="col"[^>]*>Ride/);
  assert.match(html, /over 12 weeks/);
  assert.equal(view.period(context), '12-week trend');
  assert.match(view.summary(context, 'distance')!.unit, /last 28 days/);
});

void test('calendar history supports year selection, and mixed days stay identifiable', () => {
  const view = tileView('activityCalendar')!;
  const html = renderToStaticMarkup(
    view.face(context, 'sport', true) as ReactElement,
  );
  assert.match(html, /Calendar period/);
  assert.match(html, /role="combobox"/);
  assert.doesNotMatch(html, /Inspect date|Inspect day|role="dialog"/);
  assert.doesNotMatch(html, /calendar day/);
  const day = dayFromISODate('2024-02-29');
  const mixed = renderToStaticMarkup(
    createElement(MonthRows, {
      today: dayFromISODate('2024-12-31'),
      first: dayFromISODate('2024-01-01'),
      selectedDay: day,
      dominantSport: new Map([[day, 'ride' as const]]),
      mixedDays: new Set([day]),
      totals: new Map([
        [day, { count: 2, distance: 20, time: 3, elevation: 200 }],
      ]),
      palette: context.palette,
    }),
  );
  assert.match(mixed, /Feb 29, 2024: Multiple sports, 3.0 h/);
  assert.match(mixed, /repeating-linear-gradient/);
  assert.equal((mixed.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(mixed, /box-shadow:/);
  assert.equal((mixed.match(/<button/g) ?? []).length, 366);
});

void test('month and year expansion retain the current-period comparison without navigation', () => {
  for (const id of ['yearToDate', 'monthVsLastMonth'] as const) {
    const view = tileView(id)!;
    assert.equal(
      view.detail,
      undefined,
      'expansion must reuse the current summary and chart',
    );
    for (const option of ['distance', 'time', 'elevation', 'count']) {
      const summary = view.summary(context, option)!;
      assert.match(summary.unit, /so far/);
      for (const expanded of [false, true]) {
        const face = view.face(context, option, expanded) as ReactElement<{
          children: (size: { width: number; height: number }) => ReactElement<{
            series: {
              label: string;
              current: boolean;
              points: { x: number; y: number }[];
            }[];
          }>;
        }>;
        const { series } = face.props.children({
          width: 378,
          height: 240,
        }).props;
        assert.equal(series.length, 2, 'no older years added on expansion');
        assert.deepEqual(
          series.map((line) => line.label),
          id === 'yearToDate' ? ['2025', '2026'] : ['Aug', 'Sep'],
        );
        assert.equal(series.filter((line) => line.current).length, 1);
        const current = series.find((line) => line.current)!;
        assert.equal(
          current.points.at(-1)?.x,
          id === 'yearToDate' ? 244 : 1,
          'current line ends at reporting day',
        );
      }
    }
  }
});

void test('hilliness details retain names and activity links, exclude short/out-of-period activities and use neutral deltas', () => {
  const rows = [
    {
      ...make('2026-08-01', 'trailHike'),
      id: 11,
      name: 'Steep hike',
      distance: 5000,
      total_elevation_gain: 1000,
    },
    {
      ...make('2026-08-02', 'run'),
      id: 12,
      name: 'Too short',
      distance: 4999,
      total_elevation_gain: 5000,
    },
    {
      ...make('2025-08-01', 'trailHike'),
      id: 13,
      name: 'Too old',
      distance: 5000,
      total_elevation_gain: 5000,
    },
    {
      ...make('2026-09-02', 'trailHike'),
      id: 14,
      name: 'Future',
      distance: 5000,
      total_elevation_gain: 5000,
    },
  ];
  const view = tileView('distanceVsElevation')!;
  const sample = {
    ...context,
    activities: rows,
    onOpenActivity: () => undefined,
  };
  const html = renderToStaticMarkup(
    view.more!(sample, undefined) as ReactElement,
  );
  assert.match(html, /<button/);
  assert.match(html, /Steep hike/);
  assert.match(html, /200\.0/);
  assert.match(html, /m \/ km/);
  assert.doesNotMatch(html, /100 km/);
  assert.equal(view.summary(sample, undefined)!.value, '600.1');
  assert.doesNotMatch(html, /Too short|Too old|Future|<table/);
  const delta = renderToStaticMarkup(
    createElement('div', null, view.summary(sample, undefined)!.sub),
  );
  assert.doesNotMatch(delta, /text-green|text-orange/);
  const empty = renderToStaticMarkup(
    view.more!({ ...sample, activities: [] }, undefined) as ReactElement,
  );
  assert.match(empty, /No qualifying activities/);
});

void test('sport mix names every represented sport and retains useful phone details', () => {
  const activities = (
    ['ride', 'bcXcSki', 'run', 'trailHike', 'misc'] as const
  ).map((sport) => make('2026-08-31', sport));
  const sample = { ...context, activities };
  const view = tileView('sportMix')!;
  const collapsed = renderToStaticMarkup(
    view.face(sample, 'currentYear', false) as ReactElement,
  );
  const detail = renderToStaticMarkup(
    view.more!(sample, 'currentYear') as ReactElement,
  );
  for (const name of [
    'Ride',
    'BC &amp; XC Ski',
    'Run',
    'Trail / Hike',
    'Miscellaneous',
  ]) {
    assert.match(collapsed, new RegExp(name));
    assert.match(detail, new RegExp(name));
  }
  assert.match(detail, /Moving time/);
  assert.match(detail, /Activities/);
  assert.match(detail, /Distance/);
  assert.match(detail, /Climb/);
  assert.equal(
    view.summary(
      { ...context, activities: [make('2026-08-31', 'ride')] },
      'currentYear',
    )!.sub,
    'One sport represented; no mix to compare',
  );
  assert.equal(
    view.summary({ ...context, activities: [] }, 'currentYear')!.sub,
    'No moving time yet',
  );
});

void test('projection keeps small daily rates and Typical week preserves its full-week context', () => {
  assert.equal(formatDailyRate(0.9), '0.9');
  assert.equal(formatDailyRate(0.04), '0.04');
  assert.equal(formatDailyRate(36.34), '36.3');
  const pace = tileView('yearPace')!;
  const html = renderToStaticMarkup(
    pace.face(context, 'distance', false) as ReactElement,
  );
  assert.match(html, /Projected/);
  assert.match(html, /So far/);
  assert.match(html, /Daily average/);
  assert.equal(pace.expandable, false);
  const typical = tileView('typicalWeek')!;
  assert.equal(
    typical.period(context, undefined),
    'Per week · last 11 full weeks',
  );
  assert.match(typical.summary(context, undefined)!.value, /\d+\.\d$/);
  assert.equal(typical.expandable, false);
});

void test('Records detail starts in the current year and calendar names minority sports', () => {
  const sample = {
    ...context,
    activities: [
      { ...make('2024-01-01', 'ride'), name: 'Older record', distance: 900000 },
      {
        ...make('2026-08-31', 'ride'),
        name: 'Current record',
        distance: 100000,
      },
      { ...make('2026-08-31', 'run', 600), name: 'Short run' },
    ],
  };
  const records = renderToStaticMarkup(
    tileView('records')!.detail!(sample, undefined) as ReactElement,
  );
  assert.match(records, /Records · 2026/);
  assert.match(records, /Current record/);
  assert.doesNotMatch(records, /Older record/);
  assert.match(records, /aria-pressed="true"[^>]*>This year/);
  assert.match(records, /All time/);
  const calendar = renderToStaticMarkup(
    tileView('activityCalendar')!.face(sample, 'sport', true) as ReactElement,
  );
  assert.match(calendar, />Run<\/span>/);
  assert.match(calendar, /Striped: multiple sports/);
});

void test('imperial preferences reach Stats headlines, records and calendar accessibility', () => {
  const sample: TileContext = {
    ...context,
    units: 'imperial',
    dateFormat: 'iso',
  };
  const projection = tileView('yearPace')!.summary(sample, 'distance')!;
  assert.equal(projection.unit, 'mi projected');
  const records = renderToStaticMarkup(
    tileView('records')!.detail!(sample, undefined) as ReactElement,
  );
  assert.match(records, /6 mi/);
  assert.match(records, /328 ft/);
  assert.match(records, /2026-08-31/);
  assert.doesNotMatch(records, /10 km|100 m/);
  const calendar = renderToStaticMarkup(
    createElement(MonthRows, {
      today,
      dominantSport: new Map([[today, 'ride' as const]]),
      totals: new Map([
        [today, { count: 1, distance: 10, time: 1, elevation: 100 }],
      ]),
      palette: context.palette,
      colorBy: 'distance',
      units: 'imperial',
      dateFormat: 'iso',
    }),
  );
  assert.match(calendar, /2026-09-01: Ride, 6 mi/);
  assert.doesNotMatch(calendar, /10 km/);
  const hilliness = tileView('distanceVsElevation')!.summary(
    sample,
    undefined,
  )!;
  assert.equal(hilliness.unit, 'ft / mi');
});
