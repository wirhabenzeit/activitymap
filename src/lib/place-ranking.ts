import type { Activity } from '~/lib/activity';
import { type LibraryPlace, buildPlaceLibrary } from '~/lib/place-library';
import type { PlaceKind } from '~/lib/place-symbols';
import { dayOf } from '~/lib/stats/tile-data';
import { dateOfDay, yearStart } from '~/lib/stats/tile-series';

export type PlaceRankingRange = 'currentYear' | 'allTime';
export type PlaceRankingRow = { place: LibraryPlace; rank: number };
export type PlaceRanking = {
  rows: PlaceRankingRow[];
  // Distinct places of the kind, before the display limit.
  total: number;
  // Activities in the window, and those with a completed place check.
  activities: number;
  checked: number;
  // Only a fully checked, fully loaded window may present its ranking (or an
  // empty one) as the complete answer.
  exhaustive: boolean;
};

export const PLACE_RANKING_LIMIT = 50;
export const PLACE_RANKING_COMPACT_LIMIT = 5;

/** Most visited places (#461): distinct activities per place in the Stats
 * window, from the same synced-bundle index as place search. Counting and
 * effective membership (and #463 corrections) stay in buildPlaceLibrary. */
export function rankVisitedPlaces(
  activities: readonly Pick<
    Activity,
    'id' | 'start_date_local' | 'placeMatches'
  >[],
  {
    userId,
    today,
    kind,
    range,
    historyComplete = true,
    limit = PLACE_RANKING_LIMIT,
  }: {
    userId: string | undefined;
    // Stats reporting day (days since the epoch, wall-clock).
    today: number;
    kind: PlaceKind;
    range: PlaceRankingRange;
    historyComplete?: boolean;
    limit?: number;
  },
): PlaceRanking {
  const first =
    range === 'allTime'
      ? -Infinity
      : yearStart(dateOfDay(today).getUTCFullYear());
  const scoped = activities.filter((activity) => {
    const day = dayOf(activity.start_date_local);
    return day >= first && day <= today;
  });
  const library = buildPlaceLibrary(scoped, userId, historyComplete);
  const places = library.places
    .filter((place) => place.kinds.includes(kind))
    .sort(
      (a, b) =>
        b.activityCount - a.activityCount ||
        (a.latestVisit < b.latestVisit
          ? 1
          : a.latestVisit > b.latestVisit
            ? -1
            : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  // Competition ranks: equal counts share a rank (1, 2, 2, 2, 5).
  let rank = 0;
  const rows = places.slice(0, Math.max(0, limit)).map((place, index) => {
    if (index === 0 || places[index - 1]!.activityCount !== place.activityCount)
      rank = index + 1;
    return { place, rank };
  });
  const checked = library.statusCounts.complete ?? 0;
  return {
    rows,
    total: places.length,
    activities: scoped.length,
    checked,
    exhaustive: library.complete,
  };
}
