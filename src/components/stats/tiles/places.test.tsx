import assert from 'node:assert/strict';

import test from 'node:test';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { dayFromISODate } from '~/lib/stats/tile-data';

import { tilePalette } from './format';
import type { StatsPlaceSource } from './places';
import { type TileContext, tileView } from './tiles';

const view = tileView('visitedPlaces')!;
const today = dayFromISODate('2026-10-28');
const place = (
  id: number,
  name: string,
  kinds: ('peak' | 'pass' | 'hut')[],
) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  name,
  kinds,
  latitude: 46.5,
  longitude: 8,
  elevationM: 2500,
  visits: [{ distanceM: 10 }, { distanceM: 20 }],
});
const activity = (
  id: number,
  date: string,
  status: string,
  places: ReturnType<typeof place>[] = [],
) => ({
  id,
  start_date_local: new Date(`${date}T08:00:00Z`),
  placeMatches: {
    userId: 'alice',
    activityId: String(id),
    status,
    places,
  } as unknown as StatsPlaceSource['activities'][number]['placeMatches'],
});
const source = (
  activities: ReturnType<typeof activity>[],
  historyComplete = true,
): StatsPlaceSource => ({
  activities,
  userId: 'alice',
  historyComplete,
  onOpenPlace: () => undefined,
});
const context = (places?: StatsPlaceSource): TileContext => ({
  today,
  activities: [],
  palette: tilePalette(false),
  places,
});
const render = (node: unknown) => renderToStaticMarkup(node as ReactElement);

const peak = place(1, 'Alpha Peak', ['peak']);
const hut = place(2, 'Echo Hut', ['hut']);

void test('compact Most visited places lists this year with accessible rows and detail access', () => {
  const html = render(
    view.face(
      context(
        source([
          activity(1, '2026-02-01', 'complete', [peak, hut]),
          activity(2, '2026-03-01', 'complete', [peak]),
          activity(3, '2025-03-01', 'complete', [peak]),
        ]),
      ),
      'peak',
      false,
    ),
  );
  assert.match(html, /aria-label="Most visited peaks · 2026"/);
  assert.match(
    html,
    /aria-label="1\. Alpha Peak, 2,500 m, 2 activities\. View place details"/,
  );
  assert.match(html, /once per activity/);
  assert.doesNotMatch(
    html,
    /role="status"/,
    'a complete ranking needs no caveat',
  );
});

void test('only a fully checked empty ranking says no places; rows carry no caveat', () => {
  const empty = render(
    view.face(
      context(source([activity(1, '2026-02-01', 'complete')])),
      'pass',
      false,
    ),
  );
  assert.match(empty, /No passes on your routes this year\./);
  const pending = render(
    view.face(
      context(
        source([
          activity(1, '2026-02-01', 'complete'),
          activity(2, '2026-02-02', 'pending'),
        ]),
      ),
      'pass',
      false,
    ),
  );
  assert.match(pending, /No passes found yet\./);
  assert.doesNotMatch(pending, /on your routes/);
  const partial = render(
    view.face(
      context(
        source([
          activity(1, '2026-02-01', 'complete', [peak]),
          activity(2, '2026-02-02', 'uncovered'),
        ]),
      ),
      'peak',
      false,
    ),
  );
  assert.doesNotMatch(partial, /role="status"/, 'rows carry no caveat');
  const loading = render(
    view.face(
      context(source([activity(1, '2026-02-01', 'complete')], false)),
      'peak',
      false,
    ),
  );
  assert.match(loading, /No peaks found yet\./);
  assert.doesNotMatch(loading, /on your routes/);
  assert.match(
    render(view.face(context(), 'peak', false)),
    /Place visits appear once activities sync\./,
  );
});

void test('hut wording describes vicinity, never a stay', () => {
  const ctx = context(source([activity(1, '2026-02-01', 'complete', [hut])]));
  assert.match(view.compactPeriod!(ctx, 'hut'), /routes passing nearby/);
  const detail = render(view.detail!(ctx, 'hut'));
  assert.match(detail, /passed near each hut/);
  assert.match(detail, /does not mean you stopped or stayed/);
  assert.doesNotMatch(detail, /stayed at|overnight|visited the hut/i);
});

void test('the focus ranking is bounded and offers the reporting period choice', () => {
  const many = Array.from({ length: 60 }, (_, index) =>
    place(100 + index, `Peak ${String(index).padStart(2, '0')}`, ['peak']),
  );
  const detail = render(
    view.detail!(
      context(source([activity(1, '2026-02-01', 'complete', many)])),
      'peak',
    ),
  );
  assert.match(detail, /aria-label="Most visited places period"/);
  assert.match(detail, /aria-pressed="true"[^>]*>This year/);
  assert.equal(detail.match(/<li /g)?.length, 50);
  assert.match(detail, /Showing the top 50 of 60 peaks\./);
});
