import assert from 'node:assert/strict';

import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createStatsTileModels } from '~/lib/stats/tile-models';

import fixture from '../../../../shared/stats-presentation-fixtures.v1.json';
import { StatsChoices } from './choices';
import { formatShort, statsFormat, tilePalette } from './format';
import { tileView } from './tiles';

for (const row of fixture.axes)
  void test(`step-aware axis: ${row.value}/${row.step}`, () =>
    assert.equal(formatShort(row.value, row.step), row.text));
void test('imperial axes choose precision after conversion', () => {
  const format = statsFormat('imperial');
  assert.notEqual(
    format.formatShort(0.2, 'distance', 0.2),
    format.formatShort(0.4, 'distance', 0.2),
  );
});
void test('compact/standard choices retain labels, one tab stop, and the same target/selected contract', () => {
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(StatsChoices, {
        label: 'Metric',
        options: ['distance', 'time'],
        value: 'time',
        onChange: () => undefined,
        visibleLabel: String,
        accessibleLabel: String,
        compact,
      }),
    );
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
    assert.match(html, /aria-pressed="true"/);
    assert.equal((html.match(/min-h-11/g) ?? []).length, 2);
  }
});
void test('summary and face share one projection derivation without retaining another library owner', () => {
  let calls = 0;
  const models = createStatsTileModels([], 20000, () => {
    calls++;
    return { current: 1, perDay: 0.1, projected: 36.5, lastYear: 10 };
  });
  const context = {
    activities: [],
    today: 20000,
    palette: tilePalette(false),
    models,
  };
  tileView('yearPace')!.summary(context, 'distance');
  void tileView('yearPace')!.face(context, 'distance', false);
  assert.equal(calls, 1);
  models.yearPace('time');
  assert.equal(calls, 2);
  const replacement = createStatsTileModels([], 20001, () => {
    calls++;
    return { current: 1, perDay: 0.1, projected: 36.5, lastYear: 10 };
  });
  replacement.yearPace('distance');
  assert.equal(
    calls,
    3,
    'A different screen/data/day lifetime never reuses stale analytics',
  );
});
