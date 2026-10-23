import { z } from 'zod';

/** Small private read model for the local places experiment; no raw route evidence. */
export const visitedPlaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kinds: z.array(z.enum(['peak', 'pass', 'hut'])),
  elevationM: z.number().finite().nullable(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  osmType: z.enum(['node', 'way', 'relation']),
  osmId: z.string().regex(/^[1-9][0-9]*$/),
  activityIds: z.array(z.string().regex(/^[1-9][0-9]*$/)),
});
export const visitedPlacesResponseSchema = z.object({
  userId: z.string(),
  places: z.array(visitedPlaceSchema),
});
export type VisitedPlace = z.infer<typeof visitedPlaceSchema>;

export function placeSourceUrl(place: Pick<VisitedPlace, 'osmType' | 'osmId'>) {
  return `https://www.openstreetmap.org/${place.osmType}/${place.osmId}`;
}
