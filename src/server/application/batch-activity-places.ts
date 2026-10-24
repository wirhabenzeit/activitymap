import {
  BATCH_DISCOVERY_VERSION,
  createBatchCoverage,
  routeSections,
} from '~/server/places/batch-coverage';
import { type MatcherPolicy, validatePolicy } from '~/server/places/policy';
import type { PublishedCatalogue } from '~/server/places/published-catalogue';
import {
  type PlaceQueryWindow,
  containsQueryWindow,
  placeQueryWindowKey,
  placeQueryWindows,
} from '~/server/places/query-windows';
import {
  SpatialIndex,
  bounds,
  combine,
  pointArcDistanceM,
  vector,
} from '~/server/places/spatial-index';
import type { PreparedTrack } from '~/server/places/track-sections';
import type { CandidatePlace } from '~/server/repositories/places';

import { matchActivityPlaces } from './match-activity-places';

type MatchInput = Pick<
  Parameters<typeof matchActivityPlaces>[0],
  'userId' | 'activityId' | 'input'
>;
export type PlaceMatchingSnapshot = {
  catalogue: PublishedCatalogue;
  places: readonly CandidatePlace[];
  revision?: string;
  /** Absent for a full catalogue. Scoped snapshots reject out-of-scope tracks. */
  windows?: readonly PlaceQueryWindow[];
};

/** One pinned catalogue per run. All discovery and matching are local: there is
 * no database callback, retry, process-wide cache or per-activity place query.
 * The writer fences the stream and catalogue before committing. */
export function createBatchActivityPlaceMatcher(options: {
  snapshot: PlaceMatchingSnapshot;
  policy: Readonly<MatcherPolicy>;
}) {
  const catalogue = options.snapshot.catalogue;
  const policy = Object.freeze(validatePolicy(options.policy));
  const points = options.snapshot.places.map((place) => ({
    place,
    point: vector([place.location.longitude, place.location.latitude]),
  }));
  const index = new SpatialIndex(
    points.map((value) => ({ box: bounds([value.point]), value })),
  );
  const coverage = createBatchCoverage(catalogue.coverage);
  const windowKeys =
    options.snapshot.windows &&
    new Set(options.snapshot.windows.map(placeQueryWindowKey));
  const stats = { activities: 0, coverageChecks: 0, candidateSearches: 0 };
  return {
    discoveryVersion: BATCH_DISCOVERY_VERSION,
    stats,
    async match(input: MatchInput, preparedTrack?: PreparedTrack) {
      stats.activities++;
      return matchActivityPlaces({
        ...input,
        catalogue,
        policy,
        preparedTrack,
        discover: async (request) => {
          if (
            request.catalogueSnapshotId !==
            catalogue.manifest.catalogue_snapshot_id
          )
            throw new Error('Batch catalogue identity changed');
          const sections = routeSections(request.geometry);
          if (windowKeys) {
            for (const window of placeQueryWindows(
              request.geometry,
              request.radiusM,
            )) {
              if (
                !windowKeys.has(placeQueryWindowKey(window)) &&
                !options.snapshot.windows!.some((loaded) =>
                  containsQueryWindow(loaded, window),
                )
              )
                throw new Error('Track exceeds the loaded place query windows');
            }
          }
          stats.coverageChecks++;
          if (!coverage.covers(sections, request.radiusM))
            return { covered: false, candidates: [], truncated: false };
          stats.candidateSearches++;
          // Broad discovery admits 1% + 1m numerical/geodesic slack. The actual
          // encounter scorer still decides visits using the unchanged policy.
          const radius = request.radiusM * 1.01 + 1;
          const found = new Map<string, CandidatePlace>();
          for (const section of sections)
            for (let start = 0; start < section.length; start += 64) {
              const block = section.slice(start, start + 64);
              for (const candidate of index.query(
                combine(
                  block.map((edge) => edge.box),
                  radius,
                ),
              )) {
                if (
                  !found.has(candidate.place.id) &&
                  block.some(
                    (edge) =>
                      pointArcDistanceM(candidate.point, edge) <= radius,
                  )
                )
                  found.set(candidate.place.id, candidate.place);
              }
            }
          const candidates = [...found.values()].sort((a, b) =>
            a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
          );
          return {
            covered: true,
            candidates: candidates.slice(0, request.limit),
            truncated: candidates.length > request.limit,
          };
        },
      });
    },
  };
}
