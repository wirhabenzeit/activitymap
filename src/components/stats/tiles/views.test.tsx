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

void test('rest-day weeks align weekdays and exclude padding from the 90-day window', () => {
  const view = tileView('restDays')!;
  // Tuesday at the end and Thursday at the start exercise both partial weeks.
  const sample = {
    ...context,
    activities: [make('2026-06-04', 'ride'), make('2026-09-01', 'run')],
  };
  for (const expanded of [false, true]) {
    const html = renderToStaticMarkup(
      view.face(sample, undefined, expanded) as ReactElement,
    );
    const days = html.match(/<button[^>]*>/g) ?? [];
    assert.equal(days.length, 90);
    assert.equal(
      days.filter((day) => day.includes('bg-muted-foreground/25')).length,
      2,
    );
    assert.equal(
      days.filter((day) => day.includes('bg-orange-600')).length,
      88,
    );
    assert.match(days[0], /Jun 4: activity recorded/);
    assert.match(days[0], /grid-column:2;grid-row:4/);
    assert.match(days[89]!, /Sep 1: activity recorded/);
    assert.match(days[89]!, /grid-column:15;grid-row:2/);
    assert.equal(days.filter((day) => day.includes('tabindex="0"')).length, 1);
    assert.match(html, /one column per week, Monday to Sunday/);
    assert.match(html, /No matching activity/);
    assert.match(html, /Recorded/);
  }
  assert.equal(view.summary(sample, undefined)!.value, '29');
  assert.equal(view.summary(sample, undefined)!.sub, '88 in the last 90 days');
});

void test('rest-day weeks cross a year boundary without adding future rest days', () => {
  const view = tileView('restDays')!;
  const html = renderToStaticMarkup(
    view.face(
      { ...context, today: dayFromISODate('2026-01-01'), activities: [] },
      undefined,
      false,
    ) as ReactElement,
  );
  const days = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(days.length, 90);
  assert.match(days[0], /Oct 4: no matching activity/);
  assert.match(days[0], /grid-column:2;grid-row:6/);
  assert.match(days[89]!, /Jan 1: no matching activity/);
  assert.match(days[89]!, /grid-column:15;grid-row:4/);
});
