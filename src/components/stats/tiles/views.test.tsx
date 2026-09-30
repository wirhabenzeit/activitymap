import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { statsTiles } from '~/settings/stats-tiles.generated';
import { dayFromISODate, type StatsActivity } from '~/lib/stats/tile-data';
import { tileView, type TileContext } from './tiles';
import { tilePalette } from './format';
import { MonthRows } from './calendar';
import { statsCapabilitiesSchema } from '../../../../scripts/lib/stats-parity-schema';

void test('the shared capability matrix matches actual visible and expandable web tiles', () => {
  const contract = statsCapabilitiesSchema.parse(
    JSON.parse(readFileSync('shared/stats-capabilities.v1.json', 'utf8')),
  );
  assert.equal(
    contract.tiles.filter((tile) => tile.visibility === 'visible').length,
    11,
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

void test('consistency expansion preserves the selected chart and headline period', () => {
  const view = tileView('consistency')!;
  for (const [option, weeks] of [
    ['last12Weeks', 12],
    ['last52Weeks', 52],
  ] as const) {
    assert.equal(view.period(context, option), `Last ${weeks} weeks`);
    const sub = view.summary(context, option)!.sub;
    assert.equal(typeof sub, 'string');
    assert.match(sub as string, new RegExp(`${weeks - 1} full weeks`));
    for (const expanded of [false, true]) {
      const html = renderToStaticMarkup(
        view.face(context, option, expanded) as ReactElement,
      );
      assert.match(html, new RegExp(`Weekly active days, last ${weeks} weeks`));
    }
  }
});

void test('consistency offers weekly counts instead of a separate rest-day tile', () => {
  assert.equal(tileView('restDays'), null);
  const view = tileView('consistency')!;
  const html = renderToStaticMarkup(
    view.more!(context, 'last12Weeks') as ReactElement,
  );
  assert.match(html, /Week starting/);
  assert.match(html, /Aug 31, 2026/);
  assert.match(html, /incomplete/);
  assert.equal((html.match(/<tr/g) ?? []).length, 13);
  assert.doesNotMatch(
    view.summary(context, 'last12Weeks')!.sub as string,
    /5\+/,
  );
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
    view.face(
      { ...context, onOpenActivity: () => undefined },
      undefined,
      true,
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
      view.more!(
        { ...sample, today: dayFromISODate(date) },
        undefined,
      ) as ReactElement,
    );
    assert.match(html, /first complete 30-day window/);
    assert.doesNotMatch(html, /Last 30 days:|%/);
  }
  const html = renderToStaticMarkup(
    view.more!(
      { ...sample, today: dayFromISODate('2026-01-30') },
      undefined,
    ) as ReactElement,
  );
  assert.match(html, /Best 30 days/);
  assert.match(html, /Jan 1.*Jan 30/);
  assert.match(html, /Last 30 days: 10 km/);
  assert.equal((html.match(/100%/g) ?? []).length, 6); // Text and bar width for all three metrics.
  assert.doesNotMatch(html, /1100%/);
});

void test('records avoid percentages when a complete window has no recorded metric', () => {
  const html = renderToStaticMarkup(
    tileView('records')!.more!(
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
  assert.match(html, /Volume history range/);
  assert.match(html, />12 weeks</);
  assert.match(html, />12 months</);
  assert.match(html, />All years</);
  assert.match(html, /2\.0 h/);
  assert.match(html, /Period totals/);
  assert.match(html, /current period is incomplete/);
  assert.match(html, /Total across the displayed 12 weeks/);
  assert.equal(view.period(context), '12-week trend');
  assert.match(view.summary(context, 'distance')!.unit, /last 28 days/);
});

void test('calendar history supports year selection, and mixed days stay identifiable', () => {
  const view = tileView('activityCalendar')!;
  const html = renderToStaticMarkup(
    view.detail!(context, 'sport') as ReactElement,
  );
  assert.match(html, /Calendar period/);
  assert.match(html, /value="2025"/);
  assert.doesNotMatch(html, /calendar day/);
  const day = dayFromISODate('2024-02-29');
  const mixed = renderToStaticMarkup(
    createElement(MonthRows, {
      today: dayFromISODate('2024-12-31'),
      first: dayFromISODate('2024-01-01'),
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
  assert.equal((mixed.match(/<button/g) ?? []).length, 366);
});

void test('year and month details expose earlier-period navigation with complete comparison summaries', () => {
  for (const id of ['yearToDate', 'monthVsLastMonth'] as const) {
    const view = tileView(id)!;
    const html = renderToStaticMarkup(
      view.detail!(context, 'distance') as ReactElement,
    );
    assert.match(html, /Previous period/);
    assert.match(html, /Next period/);
    assert.match(html, /2026/);
    assert.match(html, /vs/);
  }
});
