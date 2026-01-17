import { z } from 'zod';
import { sportTypes } from './types';

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
});

export type FetchActivitiesInput = z.input<typeof fetchActivitiesSchema>;

export const updateActivityInputSchema = z.object({
    id: z.number(),
    athlete: z.number(),
    name: z.string().optional(),
    description: z.string().optional(),
    sport_type: z.enum(sportTypes).optional(),
    commute: z.boolean().optional(),
    hide_from_home: z.boolean().optional(),
    gear_id: z.string().optional(),
});

export type UpdateActivityInput = z.infer<typeof updateActivityInputSchema>;

export const deleteActivitiesSchema = z.array(z.number());
