import { z } from 'zod';
import { sportTypes } from './types';
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
} from '~/contracts/v1/activity-mutations';

export const fetchActivitiesSchema = z.object({
    accessToken: z.string(),
    before: z.number().optional(),
    after: z.number().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
    activityIds: z.array(z.number()).optional(),
    includePhotos: z.boolean().default(false),
    athleteId: z.number(),
    shouldDeletePhotos: z.boolean().default(false),
    limit: z.number().default(50),
    // Whether this call should itself persist the fetched activities/photos
    // (transactionally, emitting `sync_change` entries - see issue #122).
    // `false` for a caller (the Strava webhook processor) that performs its
    // own persistence and change-feed recording immediately afterward in one
    // transaction, so the same mutation is not written - and change-recorded
    // - twice.
    persist: z.boolean().default(true),
    // Per-activity user refreshes may update an existing owned row but must
    // never recreate one deleted while the upstream request was in flight.
    requireExisting: z.boolean().default(false),
});

export type FetchActivitiesInput = z.input<typeof fetchActivitiesSchema>;

export const updateActivityInputSchema = z.object({
    id: z.number(),
    name: z.string()
      .min(1)
      .max(ACTIVITY_NAME_MAX_LENGTH)
      .refine((name) => name.trim().length > 0)
      .optional(),
    description: z.string().max(ACTIVITY_DESCRIPTION_MAX_LENGTH).optional(),
    sport_type: z.enum(sportTypes).optional(),
    commute: z.boolean().optional(),
    hide_from_home: z.boolean().optional(),
    gear_id: z.string().optional(),
});

export type UpdateActivityInput = z.infer<typeof updateActivityInputSchema>;

export const deleteActivitiesSchema = z.array(z.number());
