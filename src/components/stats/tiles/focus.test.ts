import assert from 'node:assert/strict';
import test from 'node:test';
import { focusedTile, focusTiles, tileFocusURL } from './focus';

void test('focus URLs preserve other state and round-trip every supported tile', () => {
  for (const [slug, id] of Object.entries(focusTiles)) {
    const href = tileFocusURL(
      'https://example.test/stats/tiles?keep=1#history',
      id,
    );
    assert.equal(href, `/stats/tiles?keep=1&tile=${slug}#history`);
    assert.equal(focusedTile(new URL(href, 'https://example.test').search), id);
    assert.equal(
      tileFocusURL(`https://example.test${href}`, null),
      '/stats/tiles?keep=1#history',
    );
  }
});

void test('invalid or non-expandable URLs leave the dashboard available', () => {
  for (const value of [
    '',
    'this-week',
    'typical-week',
    'toString',
    '__proto__',
    'unknown',
  ]) {
    assert.equal(focusedTile(`tile=${value}`), null);
  }
  assert.equal(focusedTile(''), null);
});

void test('changing focus clears only the nested activity parameter', () => {
  assert.equal(
    tileFocusURL(
      'https://example.test/stats/tiles?keep=1&tile=records&activity=42#history',
      'weeklyVolume',
    ),
    '/stats/tiles?keep=1&tile=training-volume#history',
  );
  assert.equal(
    tileFocusURL(
      'https://example.test/stats/tiles?tile=records&activity=42',
      null,
    ),
    '/stats/tiles',
  );
});
