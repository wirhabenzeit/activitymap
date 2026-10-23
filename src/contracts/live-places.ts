import { z } from 'zod';

import { visitedPlaceSchema } from './visited-places';

export const LIVE_PLACE_LIMIT = 5;
export const DEFAULT_LIVE_RADII = {
  peakRadiusM: 35,
  passRadiusM: 50,
  hutRadiusM: 50,
};
const radius = z.number().int().min(5).max(100);
export const livePlaceRequestSchema = z.strictObject({
  activityIds: z
    .array(z.string().regex(/^[1-9][0-9]{0,15}$/))
    .min(1)
    .max(LIVE_PLACE_LIMIT)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Duplicate activity IDs',
    ),
  thresholds: z.strictObject({
    peakRadiusM: radius,
    passRadiusM: radius,
    hutRadiusM: radius,
  }),
});
export type LivePlaceRequest = z.infer<typeof livePlaceRequestSchema>;
export const liveCandidateSchema = visitedPlaceSchema.extend({
  evaluations: z.array(
    z.object({
      activityId: z.string(),
      complete: z.boolean(),
      supportedKinds: z.array(z.enum(['peak', 'pass', 'hut'])),
    }),
  ),
});
export type LiveCandidate = z.infer<typeof liveCandidateSchema>;
export const livePlaceResponseSchema = z.object({
  userId: z.string(),
  places: z.array(visitedPlaceSchema),
  candidates: z.array(liveCandidateSchema),
  encounters: z.array(
    z.object({
      activityId: z.string(),
      placeId: z.string(),
      name: z.string(),
      distanceM: z.number(),
      supported: z.boolean(),
      encounters: z.number(),
    }),
  ),
  activities: z.array(
    z.object({
      activityId: z.string(),
      outcome: z.string(),
      reasons: z.array(z.string()),
    }),
  ),
  durationMs: z.number(),
});
export type LivePlaceResponse = z.infer<typeof livePlaceResponseSchema>;
