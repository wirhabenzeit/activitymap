import { z } from 'zod';

/** Web read model. Matching evidence and raw GPS stay on the server. */
export const matchedPlaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kinds: z.array(z.enum(['peak', 'pass', 'hut'])).min(1),
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
  elevationM: z.number().finite().nullable(),
  visits: z
    .array(
      z.object({
        // Only provider distance aligns with the existing distance-based profile.
        // A section-local GPS distance must never be plotted as a global distance.
        distanceM: z.number().finite().nonnegative().nullable(),
      }),
    )
    .min(1),
});
export type MatchedPlace = z.infer<typeof matchedPlaceSchema>;
export const activityPlacesResponseSchema = z.object({
  userId: z.string().min(1),
  activityId: z.string().regex(/^[1-9][0-9]*$/),
  status: z.enum([
    'complete',
    'missing_streams',
    'uncovered',
    'partial',
    'unavailable',
  ]),
  streamGeneration: z.string().nullable(),
  streamRevision: z.string().regex(/^\d+$/),
  catalogueSnapshotId: z.string().nullable(),
  matcherVersion: z.string(),
  places: z.array(matchedPlaceSchema).max(250),
});
export type ActivityPlacesResponse = z.infer<
  typeof activityPlacesResponseSchema
>;
