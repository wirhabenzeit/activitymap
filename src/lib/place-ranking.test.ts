import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import test from 'node:test';
import { immer } from 'zustand/middleware/immer';
import { type StateCreator, createStore } from 'zustand/vanilla';

import { activityDTOSchema } from '~/contracts/v1/activity';
import { filterStatsActivities } from '~/lib/stats/filter-scope';
import { dayFromISODate } from '~/lib/stats/tile-data';
import { dtoToActivityWithPlaces } from '~/lib/sync/v1-mappers';
import { type FilterSlice, createFilterSlice } from '~/store/filter';

import fixture from '../../shared/place-ranking-fixtures.v1.json';
import base from '../../shared/sync-integrity-fixtures.v1.json';
import { type PlaceRankingRange, rankVisitedPlaces } from './place-ranking';
import type { PlaceKind } from './place-symbols';

const store = createStore<FilterSlice>()(
  immer(
    createFilterSlice as unknown as StateCreator<
      FilterSlice,
      [['zustand/immer', never]]
    >,
  ),
);

type PlaceKey = keyof typeof fixture.places;
const placeKey = new Map(
  Object.entries(fixture.places).map(([key, place]) => [place.id, key]),
);

// Expand the shared shorthand into synced activities with place bundles.
const activities = fixture.activities.map((row) =>
  dtoToActivityWithPlaces(
    activityDTOSchema.parse({
      ...base.activity,
      id: String(row.id),
      name: `Activity ${row.id}`,
      sport_type: row.sport_type,
      start_date_local: row.start_date_local,
      streams: {
        generation: 'g1',
        revision: '1',
        state: 'current',
        fetch_status: 'succeeded',
        available_types: ['distance', 'altitude', 'latlng'],
        fetched_at: null,
        expires_at: null,
      },
      placeMatches: {
        userId: fixture.userId,
        activityId: String(row.id),
        status: row.status,
        streamGeneration: 'g1',
        streamRevision: '1',
        catalogueSnapshotId: 'catalogue',
        matcherVersion: 'matcher',
        matchingVersion: fixture.matchingVersion,
        resultRevision: `result-${row.id}`,
        places: row.places.map(({ place, encounters }) => ({
          ...fixture.places[place as PlaceKey],
          visits: Array.from({ length: encounters }, (_, index) => ({
            distanceM: 10 + index,
          })),
        })),
      },
    }),
    fixture.userId,
    fixture.matchingVersion,
  ),
);
const today = dayFromISODate(fixture.today);

void test('shared most-visited-places fixture: counts, ties, kinds, windows, filters and coverage', () => {
  assert.ok(
    activities.every((activity) => activity.placeMatches),
    'fixture rows are current synced bundles',
  );
  for (const row of fixture.cases) {
    store.getState().resetFilters();
    const sports = 'sports' in row ? row.sports : undefined;
    if (sports)
      store.setState((state) => {
        for (const type of Object.keys(state.sportType))
          state.sportType[type as keyof typeof state.sportType] =
            sports.includes(type);
      });
    const place = 'place' in row ? row.place : undefined;
    if (place) {
      const target = fixture.places[place as PlaceKey];
      store.setState({
        place: { id: target.id, name: target.name, userId: fixture.userId },
      });
    }
    // The shared map/list date range never narrows a Stats window.
    store.setState({ dateRange: { start: '2026-10-01', end: '2026-10-02' } });
    const ranking = rankVisitedPlaces(
      filterStatsActivities(activities, store.getState()),
      {
        userId: fixture.userId,
        today,
        kind: row.kind as PlaceKind,
        range: row.range as PlaceRankingRange,
        historyComplete:
          'historyComplete' in row ? row.historyComplete : undefined,
        limit: 'limit' in row ? row.limit : undefined,
      },
    );
    assert.deepEqual(
      ranking.rows.map(({ place, rank }) => ({
        place: placeKey.get(place.id),
        count: place.activityCount,
        rank,
        latestVisit: place.latestVisit.slice(0, 10),
      })),
      row.expected.rows,
      row.name,
    );
    assert.deepEqual(
      {
        total: ranking.total,
        activities: ranking.activities,
        checked: ranking.checked,
        exhaustive: ranking.exhaustive,
      },
      {
        total: row.expected.total,
        activities: row.expected.activities,
        checked: row.expected.checked,
        exhaustive: row.expected.exhaustive,
      },
      row.name,
    );
  }
  store.getState().resetFilters();
});

void test('rankings ignore other accounts and keep repeated encounters intact', () => {
  const ranking = rankVisitedPlaces(activities, {
    userId: 'other',
    today,
    kind: 'peak',
    range: 'allTime',
  });
  assert.equal(ranking.total, 0);
  assert.equal(ranking.checked, 0);
  assert.equal(ranking.exhaustive, false);
  assert.equal(activities[0]?.placeMatches?.places[0]?.visits.length, 3);
});

void test('a 10000-activity ranking stays local and bounded', (t) => {
  const first = activities[0]!;
  const large = Array.from({ length: 10_000 }, (_, i) => ({
    ...first,
    id: i + 1,
    placeMatches: { ...first.placeMatches!, activityId: String(i + 1) },
  }));
  const start = performance.now();
  const ranking = rankVisitedPlaces(large, {
    userId: fixture.userId,
    today,
    kind: 'peak',
    range: 'allTime',
  });
  t.diagnostic(
    `10000 activities: ranked in ${(performance.now() - start).toFixed(1)} ms`,
  );
  assert.equal(ranking.rows[0]?.place.activityCount, 10_000);
  assert.equal(ranking.exhaustive, true);
});
