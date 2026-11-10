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
