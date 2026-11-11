import type { GeometryCollection } from 'geojson';

import type { CoverageGeometry } from '~/server/places/coverage';

export type { CandidatePlace } from '~/server/places/run-types';

/** What a search for the places near an activity is asked with. */
export type PlaceDiscoveryInput = {
  geometry: GeometryCollection;
  coverage: CoverageGeometry;
  radiusM: number;
  limit: number;
  catalogueSnapshotId: string;
};
