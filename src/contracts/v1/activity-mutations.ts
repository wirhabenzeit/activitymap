import { z } from 'zod';

import { sportTypes } from '~/server/strava/types';

import { activityDTOSchema } from './activity';
import { photoDTOSchema } from './photo';

// Application API payload bounds. These protect request parsing and local
// persistence independently of any undocumented upstream Strava limit.
export const ACTIVITY_NAME_MAX_LENGTH = 255;
export const ACTIVITY_DESCRIPTION_MAX_LENGTH = 10_000;

const activityNameSchema = z
  .string()
  .min(1)
  .max(ACTIVITY_NAME_MAX_LENGTH)
  .refine((name) => name.trim().length > 0, {
    message: 'Name must contain a non-whitespace character',
  });

/**
 * Editable fields exposed to first-party clients. Omission means "leave the
 * upstream value unchanged"; an empty description is intentional and clears
 * the description in Strava.
 */
export const updateActivityRequestSchema = z
  .strictObject({
    name: activityNameSchema.optional(),
    description: z.string().max(ACTIVITY_DESCRIPTION_MAX_LENGTH).optional(),
    sport_type: z.enum(sportTypes).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one editable field is required',
  });

export type UpdateActivityRequest = z.infer<typeof updateActivityRequestSchema>;

/**
 * `complete` means `photos` is the authoritative replacement set. `partial`
 * means the activity was refreshed and persisted, but Strava's photo request
 * failed; callers must preserve their prior photos and use normal delta sync
 * for any committed metadata change.
 */
export const activityRefreshResultSchema = z.object({
  activity: activityDTOSchema,
  photos: z.array(photoDTOSchema),
  photos_status: z.enum(['complete', 'partial']),
  photos_error: z
    .object({
      code: z.string(),
      retryable: z.boolean(),
      retry_after_seconds: z.number().int().positive().nullable(),
    })
    .nullable(),
});

export type ActivityRefreshResult = z.infer<typeof activityRefreshResultSchema>;
