import assert from 'node:assert/strict';

import test from 'node:test';

import {
  monthName,
  shortDate,
  statsFormat,
} from '~/components/stats/tiles/format';

import fixtures from '../../../shared/presentation/fixtures.v1.json';
import { formatLocalDate } from '../local-date-time';
import { formatMeasurement } from '../units';
import { presentation } from './catalog.generated';
import { formattingLocale, message, resolveMessageLocale } from './messages';
import { categoryForSport } from './sports';

void test('typed complete messages preserve zero/one/many and verbatim arguments', () => {
  for (const row of fixtures.messages) {
    const result =
      row.id === 'selection.count'
        ? message('selection.count', { count: row.arguments.count! })
        : message('connect.verify.message', { reason: row.arguments.reason! });
    assert.equal(result, row.source);
  }
  assert.equal(message('selection.count', { count: 0 }), '0 activities');
  assert.equal(message('selection.count', { count: 1 }), '1 activity');
  assert.equal(message('selection.count', { count: 2 }), '2 activities');
  const userText = '🌍 {count} <Berg> مرحبا';
  assert.equal(
    message('connect.verify.message', { reason: userText }),
    `Your sign-in was saved. ${userText}`,
  );
  assert.throws(
    () => message('selection.count', { count: NaN }),
    /Invalid plural/,
  );
  // @ts-expect-error Named arguments are checked at compile time and runtime.
  assert.throws(() => message('selection.count', { total: 1 }), /arguments/);
  // @ts-expect-error Static messages accept no arguments.
  assert.throws(() => message('connect.title', { name: 'Ada' }), /arguments/);
});
void test('English-only fallback is explicit; locale formatting is independent of product language', () => {
  assert.equal(resolveMessageLocale(['de-CH', 'ar']), 'en');
  assert.equal(formattingLocale('invalid_locale'), 'en');
  assert.equal(
    message('connect.button', undefined, 'ar'),
    'Connect with Strava',
  );
  assert.equal(
    formatMeasurement(1234, 'distance', 'metric', 'de-CH'),
    '1.2 km',
  );
  assert.match(formatMeasurement(1234, 'distance', 'metric', 'de-DE'), /^1,2/);
  assert.equal(formatMeasurement(-0.01, 'elevation', 'metric', 'en'), '0 m');
  assert.match(
    formatMeasurement(1609.344, 'distance', 'imperial', 'en'),
    /^1\.0 mi$/,
  );
  assert.equal(
    statsFormat('imperial', 'de-DE').formatMetric(1.609344, 'distance'),
    '1',
  );
  const wallTime = new Date('2026-01-01T00:15:00Z');
  assert.equal(shortDate(wallTime, 'en-US'), 'Jan 1');
  assert.equal(monthName(wallTime, 'de-DE'), 'Jan');
  assert.equal(
    formatLocalDate(wallTime, { day: 'numeric', month: 'numeric' }, 'de-DE'),
    '1.1.',
  );
});
void test('sport and glyph adapters expose stable semantic identity', () => {
  assert.equal(categoryForSport.NordicSki, 'bcXcSki');
  assert.equal(categoryForSport.Walk, 'misc');
  for (const id of Object.keys(
    presentation.actions,
  ) as (keyof typeof presentation.actions)[]) {
    assert(presentation.actions[id].webGlyph);
    assert(message(presentation.actions[id].message).length);
  }
  for (const id of Object.keys(
    presentation.metrics,
  ) as (keyof typeof presentation.metrics)[]) {
    assert(presentation.metrics[id].webGlyph);
    assert(message(presentation.metrics[id].message).length);
  }
  assert.equal(
    message(presentation.metrics.average_watts.message),
    'Average power',
  );
});
