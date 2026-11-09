import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';
import { z } from 'zod';

import { activityPlacesResponseSchema } from '../../src/contracts/activity-places';
import { activityDTOSchema } from '../../src/contracts/v1/activity';
import { streamMetadataSchema } from '../../src/contracts/v1/activity-streams';
import { photoDTOSchema } from '../../src/contracts/v1/photo';

// Derive storage shapes from the wire contracts. Mutation boundary Zod parsing
// still enforces refinements (IDs, dates and cross-field checks) beyond Convex's
// structural validators.
export const streamMetadataValidator = zodToConvex(streamMetadataSchema);
export const placeMatchValidator = zodToConvex(activityPlacesResponseSchema);
export const photoValidator = zodToConvex(photoDTOSchema);
const {
  streams: _streams,
  placeMatches: _matches,
  ...metadataShape
} = activityDTOSchema.shape;
export const activityMetadataValidator = zodToConvex(z.object(metadataShape));

export const activityProjectionValidator = v.object({
  version: v.number(),
  generation: v.optional(v.string()),
  sourceVersion: v.optional(v.string()),
  streams: v.optional(streamMetadataValidator),
  match: v.optional(
    v.object({ catalogue: v.string(), value: placeMatchValidator }),
  ),
});
