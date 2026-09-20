import { z } from 'zod';

/**
 * Stable v1 error envelope. `code` is a machine-readable, documented
 * identifier (e.g. "not_authenticated", "validation_failed") that must not
 * change across releases; `message` is for humans/logs only and may
 * change freely. See issue #119.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    requestId: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const errorEnvelope = (
  code: string,
  message: string,
  options: {
    details?: unknown;
    requestId: string;
    retryable?: boolean;
  },
): ErrorEnvelope => ({
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    requestId: options.requestId,
    ...(options.details !== undefined ? { details: options.details } : {}),
  },
});
