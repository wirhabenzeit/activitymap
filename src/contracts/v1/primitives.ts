import { z } from 'zod';

/**
 * Bumped whenever a v1 DTO shape changes in a way a client should notice.
 * Included in every top-level v1 response envelope (see `envelope.ts`).
 */
export const SCHEMA_VERSION = '1';

/**
 * Potentially-large numeric identifiers (activity/photo/athlete ids can
 * exceed Number.MAX_SAFE_INTEGER) are always transported as decimal
 * strings, never as JSON numbers. See issue #119.
 */
export const idString = z
  .string()
  .regex(/^\d+$/, 'must be a decimal integer string');

/** A UTC ISO 8601 timestamp, e.g. "2024-01-31T12:00:00.000Z". */
export const isoDateTime = z.iso.datetime({ offset: false });

export const toIdString = (value: number | bigint): string => value.toString();

export const toIsoDateTime = (value: Date): string => value.toISOString();
