import type { StoreApi } from 'zustand';

import {
  type LibraryPlace,
  effectiveActivityPlaces,
  normalizePlaceSearch,
} from '~/lib/place-library';
import type { RootState } from '~/store';
import {
  type FilterState,
  type FilterableActivity,
  applyFilters,
  matchesTextFilter,
} from '~/store/filter';

// Header search: the header turns into a find field. On Map and Stats a
// results panel drops below it; on List the rows narrow instead. Picking a
// result selects routes, like clicking them on the map; only the panel's last
// row (or Enter with nothing highlighted) changes the text filter. The same
// rule as iOS header search (`HeaderSearch.swift`).

type SearchableActivity = FilterableActivity & { id: number };

const startTime = (activity: Pick<FilterableActivity, 'start_date_local'>) =>
  new Date(activity.start_date_local).getTime();

/** Every activity whose name or visited place matches, newest first. Filters
 * are deliberately ignored, so a result hidden by them stays findable. */
export function searchActivities<T extends SearchableActivity>(
  activities: readonly T[],
  query: string,
): T[] {
  if (!query.trim()) return [];
  return activities
    .filter((activity) => matchesTextFilter(activity, query))
    .sort((a, b) => startTime(b) - startTime(a));
}

const foldName = (value: string) => value.normalize('NFC').toLowerCase();

/** The visited place that matched, when the activity's name itself didn't. */
export function matchedPlaceName(
  activity: Pick<FilterableActivity, 'name' | 'placeMatches'>,
  query: string,
): string | undefined {
  const name = foldName(query.trim());
  if (!name || foldName(activity.name).includes(name)) return undefined;
  const place = normalizePlaceSearch(query);
  return effectiveActivityPlaces(activity).find((visited) =>
    normalizePlaceSearch(visited.name).includes(place),
  )?.name;
}

/** Where `query` occurs in `text`, in `text`'s own indices, so the match can
 * be emphasised. Activity names match keeping accents, place names ignoring
 * them, as the text filter does. */
export function matchRange(
  text: string,
  query: string,
  ignoringAccents = false,
): [number, number] | undefined {
  const fold = (value: string) =>
    ignoringAccents
      ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      : value.normalize('NFC').toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return undefined;
  // Fold one character at a time, remembering where each folded unit came
  // from: folding can change lengths (accents removed, ligatures expanded).
  let folded = '';
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const part = fold(char);
    folded += part;
    origin.push(...Array<number>(part.length).fill(index));
    index += char.length;
  }
  origin.push(text.length);
  const start = folded.indexOf(needle);
  if (start < 0) return undefined;
  const last = origin[start + needle.length - 1]!;
  const end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
  return [origin[start]!, end];
}

/** How many activities the filters would show with this text filter instead. */
export function textFilterCount(
  state: FilterState,
  activities: readonly FilterableActivity[],
  text: string,
  includeDate: boolean,
) {
  const scope = { ...state, search: text };
  return includeDate
    ? activities.filter((activity) => applyFilters(scope, activity)).length
    : activities.filter((activity) =>
        applyFilters({ ...scope, dateRange: undefined }, activity),
      ).length;
}

type Store = Pick<StoreApi<RootState>, 'getState'>;

/** Search selects, like clicking routes on the map: the results panel lists
 * them and the map fits them. Filters are left alone; only routes the filters
 * show can be selected. A place also gets its pin, and when the filters hide
 * every activity that visited it, the map flies to the place itself. */
export function selectFromSearch(
  store: Store,
  ids: readonly number[],
  place?: Pick<LibraryPlace, 'id' | 'name' | 'latitude' | 'longitude'> & {
    userId: string;
  },
) {
  const state = store.getState();
  const hits = state.pickActivities([...ids]);
  state.setSearchPlace(
    place ? { id: place.id, name: place.name, userId: place.userId } : null,
  );
  if (place && hits.length === 0)
    state.requestPlaceFly(place.latitude, place.longitude);
  else if (hits.length === 1) {
    state.setHighlighted(hits[0]!);
    state.requestRouteFit(hits);
  } else if (hits.length) state.requestRouteFit(hits);
  return hits;
}

/** The panel's last row and Enter. Map fits the result; other workspaces open Map. Clearing leaves the camera where it is: fitting every
 * activity would zoom out to the world. */
export function applyTextFilter(
  store: Store,
  text: string,
  activities: readonly SearchableActivity[],
  fit: boolean,
) {
  const state = store.getState();
  state.setSearch(text.trim());
  if (!fit) return;
  const next = store.getState();
  state.requestRouteFit(
    activities
      .filter((activity) => applyFilters(next, activity))
      .map((activity) => activity.id),
  );
}
