import 'server-only';

import { z } from 'zod';

import { externalEffectsEnabled } from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';

const keysSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  z.string().regex(/^[0-9a-f]{64}$/),
);

function parse<T>(schema: z.ZodType<T>, value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The gateway's settings, or null when it is off.
 *
 * `ACTIVITYMAP_PROVIDER_GATEWAY_KEYS` is a JSON object from key ID to a
 * 32-byte hex secret, shared with the Convex deployment that calls. It must
 * be set, and automated external effects enabled; anything else, an invalid
 * value included, leaves the gateway off. Which accounts the gateway reads
 * for is not a setting: it serves the accounts Convex writes for
 * (`users.writer`).
 */
export function providerGatewayConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  if (!externalEffectsEnabled(environment)) return null;
  const keys = parse(keysSchema, environment.ACTIVITYMAP_PROVIDER_GATEWAY_KEYS);
  if (keys === undefined) {
    logger.error('Invalid provider gateway configuration; the gateway is off.');
    return null;
  }
  if (!keys || Object.keys(keys).length === 0) return null;
  return { keys };
}
