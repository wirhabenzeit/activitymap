import type { ActivityDTO } from '../../contracts/v1/activity';
import { MATCHER_VERSION } from '../../server/places/matcher-version';

/** The same pending/missing projection for every library transport. */
export function placeMatchesFor(
  row: ActivityDTO,
  userId: string,
  matchingVersion: string,
) {
  return (
    row.placeMatches ?? {
      activityId: row.id,
      userId,
      status:
        row.streams?.state === 'current'
          ? ('pending' as const)
          : ('missing_streams' as const),
      streamGeneration: row.streams?.generation ?? null,
      streamRevision: row.streams?.revision ?? '0',
      catalogueSnapshotId: null,
      matcherVersion: MATCHER_VERSION,
      matchingVersion,
      resultRevision: null,
      places: [],
    }
  );
}
