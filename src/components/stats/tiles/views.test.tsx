import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { statsTiles } from '~/settings/stats-tiles.generated';
import { dayFromISODate, type StatsActivity } from '~/lib/stats/tile-data';
import { tileView, type TileContext } from './tiles';
import { tilePalette } from './format';
import { MonthRows } from './calendar';

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
    assert.match(sub as string, new RegExp(`of ${weeks - 1} weeks`));
    for (const expanded of [false, true]) {
      const html = renderToStaticMarkup(
        view.face(context, option, expanded) as ReactElement,
      );
      assert.match(html, new RegExp(`Active days, last ${weeks} weeks`));
    }
  }
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
