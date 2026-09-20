import { z } from 'zod';
import { isoDateTime, SCHEMA_VERSION } from './primitives';

/**
 * Every successful v1 JSON response is wrapped with `schemaVersion` and
 * `serverTime` so a client can detect a contract change or clock skew
 * without inspecting the payload shape. See issue #119.
 */
export const responseEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    serverTime: isoDateTime,
    data,
  });

export const makeEnvelope = <T>(data: T, now = new Date()) => ({
  schemaVersion: SCHEMA_VERSION,
  serverTime: now.toISOString(),
  data,
});
