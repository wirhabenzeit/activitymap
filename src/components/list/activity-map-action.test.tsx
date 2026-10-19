import assert from 'node:assert/strict';

import polyline from '@mapbox/polyline';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Activity } from '~/server/db/schema';

import { ActivityMapAction } from './activity-map-action';

void test('both action densities disable empty/invalid geometry and accept point framing and full-route fallback', () => {
  const point = polyline.encode([[46, 8]]);
  for (const compact of [false, true]) {
    for (const [map_summary_polyline, map_polyline, enabled] of [
      [null, null, false],
      [polyline.encode([[91, 8]]), null, false],
      [point, null, true],
      ['', point, true],
    ] as const) {
      const html = renderToStaticMarkup(
        <ActivityMapAction
          activity={
            {
              name: 'Morning ride',
              map_polyline,
              map_summary_polyline,
            } as Activity
          }
          compact={compact}
          onShowOnMap={() => undefined}
        />,
      );
      assert.equal(html.includes(' disabled=""'), !enabled);
      assert.match(html, /aria-label="Show on map: Morning ride/);
      if (!enabled) assert.match(html, /This activity has no GPS route/);
    }
  }
});

void test('filter-clearing actions retain their explicit label in both densities', () => {
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(
      <ActivityMapAction
        activity={
          {
            name: 'Morning ride',
            map_summary_polyline: polyline.encode([[46, 8]]),
            map_polyline: null,
          } as Activity
        }
        compact={compact}
        variant="clear-filters-and-show"
        onShowOnMap={() => undefined}
      />,
    );
    assert.match(
      html,
      /aria-label="Clear filters and show on map: Morning ride"/,
    );
    assert.doesNotMatch(html, / disabled=""/);
  }
});
