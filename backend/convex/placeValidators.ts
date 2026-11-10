import { v } from 'convex/values';

/** A matcher candidate (`PlaceRow` in src/server/places/catalogue-rows.ts). */
export const placeValidator = v.object({
  id: v.string(),
  displayName: v.string(),
  kinds: v.array(v.string()),
  subtypes: v.array(v.string()),
  location: v.object({ longitude: v.number(), latitude: v.number() }),
  elevationM: v.optional(v.number()),
});
