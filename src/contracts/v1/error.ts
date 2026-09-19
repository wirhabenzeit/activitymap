import { z } from 'zod';

/**
 * Stable v1 error envelope. `code` is a machine-readable, documented
 * identifier (e.g. "unauthorized", "validation_failed") that must not
 * change across releases; `message` is for humans/logs only and may
 * change freely. See issue #119.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const errorEnvelope = (
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope => ({
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});
