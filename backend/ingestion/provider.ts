import { z } from 'zod';

import {
  type ActivityDTO,
  toActivityDTO,
} from '../../src/contracts/v1/activity';
import { type PhotoDTO, toPhotoDTO } from '../../src/contracts/v1/photo';
import {
  transformStravaActivity,
  transformStravaPhoto,
} from '../../src/server/strava/transforms';
import type {
  StravaActivity,
  StravaPhoto,
} from '../../src/server/strava/types';

/**
 * Provider payloads as the library stores them. The conversion is the one
 * Postgres ingestion uses (`src/server/strava/transforms.ts` and the v1
 * contracts), so both writers produce the same activity for the same payload.
 */

/** What the conversion reads without checking. The contracts validate the
 * rest of the result. */
const detailShape = z.looseObject({
  id: z.number().int().positive(),
  athlete: z.looseObject({ id: z.number().int().positive() }),
  map: z.looseObject({}),
  start_date: z.string(),
  start_date_local: z.string(),
});

export class InvalidProviderPayload extends Error {
  constructor(what: string) {
    super(`Invalid provider ${what}`);
    this.name = 'InvalidProviderPayload';
  }
}

/** The provider answered with an activity of another athlete. */
export class ForeignProviderActivity extends Error {
  constructor() {
    super('The provider activity belongs to another athlete');
    this.name = 'ForeignProviderActivity';
  }
}

export type ActivitySource = Omit<ActivityDTO, 'streams' | 'placeMatches'>;

/** One detailed activity. `photosCurrent` says whether the photo set written
 * with it is the provider's current one. */
export function activitySource(
  payload: unknown,
  expected: { id: string; athleteId: string },
  options: { photosCurrent: boolean; observedAt: Date },
): ActivitySource {
  const shape = detailShape.safeParse(payload);
  if (!shape.success || String(shape.data.id) !== expected.id)
    throw new InvalidProviderPayload('activity');
  if (String(shape.data.athlete.id) !== expected.athleteId)
    throw new ForeignProviderActivity();
  const activity = payload as StravaActivity;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { streams, placeMatches, ...dto } = toActivityDTO({
      ...transformStravaActivity(activity, true, options),
      athlete: activity.athlete.id,
    });
    return dto;
  } catch {
    throw new InvalidProviderPayload('activity');
  }
}

/** Whether the detail says the activity has photos to fetch. */
export function hasPhotos(payload: unknown) {
  const { photo_count, total_photo_count } = payload as Partial<StravaActivity>;
  return (photo_count ?? 0) > 0 || (total_photo_count ?? 0) > 0;
}

/** The activity's photos, without the provider's placeholder entries. */
export function photoSources(
  payload: unknown,
  expected: { id: string; athleteId: string },
): PhotoDTO[] {
  if (!Array.isArray(payload)) throw new InvalidProviderPayload('photos');
  try {
    return (payload as StravaPhoto[]).flatMap((photo) => {
      if (String(photo.activity_id) !== expected.id)
        throw new InvalidProviderPayload('photos');
      const row = transformStravaPhoto(photo, Number(expected.athleteId));
      return row ? [toPhotoDTO(row)] : [];
    });
  } catch {
    throw new InvalidProviderPayload('photos');
  }
}

const summaryShape = z.looseObject({
  id: z.number().int().positive(),
  athlete: z.looseObject({ id: z.number().int().positive() }),
  map: z.looseObject({}),
  start_date: z.string(),
  start_date_local: z.string(),
});

/** One entry of the provider's activity list: the fields reconciliation
 * compares, converted like a stored activity. */
export function activitySummary(payload: unknown, athleteId: string) {
  const shape = summaryShape.safeParse(payload);
  if (!shape.success) throw new InvalidProviderPayload('activity list');
  if (String(shape.data.athlete.id) !== athleteId)
    throw new ForeignProviderActivity();
  try {
    const row = transformStravaActivity(payload as StravaActivity, false);
    return {
      id: String(row.id),
      fields: {
        name: row.name,
        sport_type: row.sport_type as string,
        distance: row.distance ?? null,
        moving_time: row.moving_time ?? null,
        elapsed_time: row.elapsed_time ?? null,
        total_elevation_gain: row.total_elevation_gain ?? null,
        start_date: row.start_date.toISOString(),
        private: row.private ?? null,
        map_summary_polyline: row.map_summary_polyline ?? null,
        photo_count: row.photo_count ?? null,
        total_photo_count: row.total_photo_count ?? null,
      },
    };
  } catch {
    throw new InvalidProviderPayload('activity list');
  }
}
