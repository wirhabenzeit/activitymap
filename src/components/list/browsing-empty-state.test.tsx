import assert from 'node:assert/strict';

import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BrowsingEmptyView, browsingEmptyKind } from './browsing-empty-view';

const render = (
  kind: Parameters<typeof BrowsingEmptyView>[0]['kind'],
  canClear: boolean,
) =>
  renderToStaticMarkup(
    <BrowsingEmptyView
      kind={kind}
      canClear={canClear}
      onClear={() => undefined}
    />,
  );

void test('the empty cause is explained by library size, then selection', () => {
  assert.equal(browsingEmptyKind({ libraryCount: 0 }), 'library-empty');
  assert.equal(
    browsingEmptyKind({ libraryCount: 0, selectionHidden: true }),
    'library-empty',
  );
  assert.equal(browsingEmptyKind({ libraryCount: 3 }), 'filtered-out');
  assert.equal(
    browsingEmptyKind({ libraryCount: 3, selectionHidden: true }),
    'selection-hidden',
  );
});

void test('filters that hide every activity offer Clear filters', () => {
  const html = render('filtered-out', true);
  assert.match(html, /No activities match your filters/);
  assert.match(html, />Clear filters</);
  const hidden = render('selection-hidden', true);
  assert.match(hidden, /Selection hidden/);
  assert.match(hidden, /Your selected activities are hidden by filters\./);
  assert.match(hidden, />Clear filters</);
});

void test('an empty library has no filter recovery', () => {
  const html = render('library-empty', true);
  assert.match(html, /No activities in your library/);
  assert.doesNotMatch(html, />Clear filters</);
});

void test('without an active filter there is nothing to clear', () => {
  assert.doesNotMatch(render('filtered-out', false), />Clear filters</);
});
