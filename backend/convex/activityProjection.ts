import type { ActivityPlacesResponse } from '~/contracts/activity-places';
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';

export const PROJECTION_VERSION = 1;
export const MAX_ACTIVITY_BYTES = 256 * 1024;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

/**
 * Convex limits the data one transaction reads to 16 MiB, counted on whole
 * documents (leaving fields out of a response reads no less). An activity
 * document holds up to MAX_ACTIVITY_BYTES of DTO and projection; a recording
 * document holds a chart summary of at most 300 points per series. Functions
 * that read many activities stay within half of the limit:
 *
 * - paginated scans stop after READ_BUDGET_BYTES (`maximumBytesRead`), which
 *   returns a shorter page that continues where it stopped;
 * - reads by ID take at most MAX_ACTIVITIES_PER_READ activities, each with
 *   its recording (32 x ~280 KiB is about 9 MiB).
 */
export const READ_BUDGET_BYTES = 6 * 1024 * 1024;
export const MAX_ACTIVITIES_PER_READ = 32;

export type ActivityMetadata = Omit<ActivityDTO, 'streams' | 'placeMatches'>;

export type ActivityProjection = {
  version: number;
  generation?: string;
  sourceVersion?: string;
  streams?: StreamMetadata;
  match?: { catalogue: string; value: ActivityPlacesResponse };
};

export function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function projectedActivity(
  dto: ActivityMetadata,
  projection: ActivityProjection,
  source: { generation?: string; catalogue?: string; revoked?: boolean },
  matchingVersion?: string,
): ActivityDTO {
  const recording =
    !source.revoked && source.generation === projection.generation;
  const match =
    recording && projection.match?.catalogue === source.catalogue
      ? projection.match?.value
      : undefined;
  return {
    ...dto,
    ...(recording && projection.streams && { streams: projection.streams }),
    ...(match && { placeMatches: { ...match, matchingVersion } }),
  };
}

export function boundedProjection(
  dto: ActivityMetadata,
  projection: ActivityProjection,
) {
  if (jsonBytes(dto) + jsonBytes(projection) > MAX_ACTIVITY_BYTES)
    throw new Error('Activity projection exceeds the serialized size limit');
  return projection;
}
