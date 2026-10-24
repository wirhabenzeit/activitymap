import { z } from 'zod';

import {
  activityPlacesResponseSchema,
  matchedPlaceSchema,
} from './activity-places';

const metres = z.number().finite().min(1).max(2_000);
export const placeDebugSettingsSchema = z
  .strictObject({
    discoveryRadiusM: metres,
    entryRadiusM: metres,
    exitRadiusM: metres,
    peakRadiusM: metres,
    passRadiusM: metres,
    hutRadiusM: metres,
    peakVerticalToleranceM: metres,
  })
  .refine(
    (s) =>
      Math.max(s.peakRadiusM, s.passRadiusM, s.hutRadiusM) <= s.entryRadiusM &&
      s.entryRadiusM <= s.exitRadiusM &&
      s.exitRadiusM <= s.discoveryRadiusM,
    {
      message: 'Match radii must fit inside entry ≤ exit ≤ discovery.',
    },
  );
export type PlaceDebugSettings = z.infer<typeof placeDebugSettingsSchema>;
export const DEFAULT_PLACE_DEBUG_SETTINGS: PlaceDebugSettings = {
  discoveryRadiusM: 300,
  entryRadiusM: 100,
  exitRadiusM: 150,
  peakRadiusM: 72,
  passRadiusM: 50,
  hutRadiusM: 50,
  peakVerticalToleranceM: 72,
};
export const placeDebugCapabilitySchema = z.object({
  userId: z.string(),
  allowed: z.boolean(),
});
export const debugPlaceSchema = matchedPlaceSchema
  .omit({ visits: true })
  .extend({
    status: z.enum(['matched', 'rejected', 'uncertain']),
    defaultMatched: z.boolean().nullable(),
    distanceM: z.number().finite().nonnegative().nullable(),
    altitudeDifferenceM: z.number().finite().nullable(),
    reasons: z.array(z.string()),
    peakMatch: z
      .object({
        score: z.number().finite().nonnegative(),
        horizontalDistanceM: z.number().finite().nonnegative(),
        recordedElevationM: z.number().finite().nullable(),
        altitudeDifferenceM: z.number().finite().nullable(),
        spatialDistanceM: z.number().finite().nonnegative().nullable(),
        usesElevation: z.boolean(),
        reliable: z.boolean(),
      })
      .nullable()
      .optional(),
  });
export type DebugPlace = z.infer<typeof debugPlaceSchema>;
export const placeDebugResponseSchema = activityPlacesResponseSchema
  .omit({ places: true })
  .extend({
    settings: placeDebugSettingsSchema,
    reasons: z.array(z.string()),
    candidates: z.array(debugPlaceSchema).max(250),
  });
export type PlaceDebugResponse = z.infer<typeof placeDebugResponseSchema>;
