import type { MatchedPlace } from '~/contracts/activity-places';
import type { Activity } from '~/lib/activity';

export type PlaceFilter = { id: string; name: string; userId: string };
export type LibraryPlace = Omit<MatchedPlace, 'visits'> & {
  activityIds: number[];
  activityCount: number;
  firstVisit: string;
  latestVisit: string;
};
export type PlaceLibrary = {
  userId: string | undefined;
  places: LibraryPlace[];
  byId: ReadonlyMap<string, LibraryPlace>;
  statusCounts: Record<string, number>;
  complete: boolean;
  searchEntries: { name: string; place: LibraryPlace }[];
};

export const normalizePlaceSearch = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** The sole effective-membership boundary. #463 can overlay personal include /
 * exclude decisions here without teaching each consumer about overrides.
 * Inputs are the current account/version/stream-validated sync projection. */
export function effectiveActivityPlaces(
  activity: Pick<Activity, 'placeMatches'>,
) {
  return activity.placeMatches?.status === 'complete'
    ? activity.placeMatches.places
    : [];
}

/** Built once per committed library, never by fetching individual activities. */
export function buildPlaceLibrary(
  activities: readonly Pick<
    Activity,
    'id' | 'start_date_local' | 'placeMatches'
  >[],
  userId: string | undefined,
  libraryComplete = true,
): PlaceLibrary {
  const byId = new Map<string, LibraryPlace>();
  const memberships = new Map<string, Set<number>>();
  const statusCounts: Record<string, number> = {};
  for (const activity of activities) {
    const result = activity.placeMatches;
    const valid = Boolean(
      userId &&
      result?.userId === userId &&
      result.activityId === String(activity.id),
    );
    const status = valid ? result!.status : 'unknown';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (!valid) continue;
    const date = activity.start_date_local.toISOString();
    for (const place of effectiveActivityPlaces(activity)) {
      const existing = byId.get(place.id);
      if (existing) {
        if (!memberships.get(place.id)!.has(activity.id)) {
          memberships.get(place.id)!.add(activity.id);
          existing.activityIds.push(activity.id);
          existing.activityCount++;
        }
        existing.kinds = [
          ...new Set([...existing.kinds, ...place.kinds]),
        ].sort();
        existing.firstVisit =
          existing.firstVisit < date ? existing.firstVisit : date;
        existing.latestVisit =
          existing.latestVisit > date ? existing.latestVisit : date;
      } else {
        byId.set(place.id, {
          id: place.id,
          name: place.name,
          longitude: place.longitude,
          latitude: place.latitude,
          elevationM: place.elevationM,
          kinds: [...place.kinds].sort(),
          activityIds: [activity.id],
          activityCount: 1,
          firstVisit: date,
          latestVisit: date,
        });
        memberships.set(place.id, new Set([activity.id]));
      }
    }
  }
  const places = [...byId.values()].sort(
    (a, b) =>
      b.activityCount - a.activityCount ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id.localeCompare(b.id)),
  );
  return {
    userId,
    places,
    byId,
    searchEntries: places.map((place) => ({
      name: normalizePlaceSearch(place.name),
      place,
    })),
    statusCounts,
    complete:
      libraryComplete &&
      Object.keys(statusCounts).every((status) => status === 'complete'),
  };
}

/** Suggestions deliberately use the full known library, independently of the
 * active filters, so a zero-result filter cannot hide its own recovery choices. */
export function searchLibraryPlaces(
  library: PlaceLibrary,
  query: string,
  offset = 0,
  limit = 8,
) {
  const normalized = normalizePlaceSearch(query);
  const start = Math.max(0, Math.floor(offset));
  const size = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!normalized)
    return {
      places: library.places.slice(start, start + size),
      total: library.places.length,
    };
  const places: LibraryPlace[] = [];
  let total = 0;
  for (const entry of library.searchEntries) {
    if (!entry.name.includes(normalized)) continue;
    if (total >= start && places.length < size) places.push(entry.place);
    total++;
  }
  return { places, total };
}

export function sanitizePlaceFilter(value: unknown): PlaceFilter | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<PlaceFilter>;
  return typeof candidate.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      candidate.id,
    ) &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0
    ? { id: candidate.id, name: candidate.name, userId: candidate.userId }
    : undefined;
}
