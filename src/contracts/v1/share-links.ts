import { z } from 'zod';

import { isoDateTime } from './primitives';
import {
  MAX_SHARE_LINK_ACTIVITIES,
  MAX_SHARE_LINK_TTL_MS,
  MIN_SHARE_LINK_TTL_MS,
  shareLinkFieldOptionsSchema,
} from '~/server/sharing/validators';

// The service stores numeric IDs; reject strings that cannot round-trip safely.
export const createShareLinkRequestSchema = z
  .object({
    activityIds: z
      .array(
        z
          .string()
          .regex(/^[1-9]\d*$/)
          .refine(
            (id) => Number.isSafeInteger(Number(id)),
            'Activity ID exceeds the server storage range',
          ),
      )
      .min(1)
      .max(MAX_SHARE_LINK_ACTIVITIES),
    expiresInMs: z
      .number()
      .int()
      .min(MIN_SHARE_LINK_TTL_MS)
      .max(MAX_SHARE_LINK_TTL_MS),
    fields: shareLinkFieldOptionsSchema,
  })
  .strict();

export const createdShareLinkDTOSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(1),
  expiresAt: isoDateTime,
});

export const shareLinkSummaryDTOSchema = z.object({
  id: z.string().uuid(),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  revokedAt: isoDateTime.nullable(),
  fields: shareLinkFieldOptionsSchema,
  activityCount: z.number().int().nonnegative(),
  status: z.enum(['active', 'expired', 'revoked']),
});
export const shareLinkListDTOSchema = z.object({
  links: z.array(shareLinkSummaryDTOSchema),
});
export const revokeShareLinkRequestSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const revokeShareLinkResultSchema = z.object({
  status: z.literal('revoked'),
});

export type CreateShareLinkRequest = z.input<
  typeof createShareLinkRequestSchema
>;
export type ShareLinkSummaryDTO = z.infer<typeof shareLinkSummaryDTOSchema>;
