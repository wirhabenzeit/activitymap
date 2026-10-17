import { z } from 'zod';
import { isoDateTime } from './primitives';

export const stravaImportStatusSchema = z.enum([
  'idle',
  'running',
  'succeeded',
  'deferred',
  'failed',
  'interrupted',
  'blocked',
]);
export const stravaImportReasonSchema = z.enum([
  'complete',
  'busy',
  'account_unavailable',
  'request_limit',
  'deadline',
  'rate_limit',
  'detail_failed',
  'internal_error',
  'interrupted',
]);
export const stravaImportDTOSchema = z.object({
  available: z.boolean(),
  runId: z.string().nullable(),
  status: stravaImportStatusSchema,
  reason: stravaImportReasonSchema.nullable(),
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  retryAt: isoDateTime.nullable(),
  summaries: z.number().int().nonnegative(),
  details: z.number().int().nonnegative(),
  photos: z.number().int().nonnegative(),
});
export type StravaImportDTO = z.infer<typeof stravaImportDTOSchema>;
