import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/**
 * The provider gateway: how a Convex worker gets provider data without
 * holding a provider credential (docs/convex-writer-cutover.md, decision 1).
 * The worker signs a request for one owner and one read; the app resolves
 * the owner's account, refreshes its token if needed, reserves from the
 * shared request budget, asks the provider and answers with the payload or a
 * typed failure.
 *
 * This file is the contract both sides share. It has no app dependencies, so
 * a Convex Node action can import it.
 */

export const GATEWAY_PATH = '/api/internal/provider/v1';
/** How far a request's timestamp may be from the app's clock, either way.
 * Requests carry no nonce: one stamped ahead can be replayed for close to
 * twice this long. A replay cannot change provider content (every operation
 * is a read), but it spends shared budget and can refresh and store the
 * owner's token. */
export const GATEWAY_SIGNATURE_WINDOW_MS = 30_000;

const activityId = z.string().regex(/^[1-9]\d{0,19}$/);
const epochSeconds = z.number().int().positive();

export const gatewayOperationSchema = z.discriminatedUnion('kind', [
  /** One activity in full. */
  z.strictObject({ kind: z.literal('activity'), id: activityId }),
  /** The activity's recorded streams. */
  z.strictObject({ kind: z.literal('streams'), id: activityId }),
  /** The activity's photos, both sizes merged. */
  z.strictObject({ kind: z.literal('photos'), id: activityId }),
  /** One page of the owner's activity summaries. */
  z.strictObject({
    kind: z.literal('activities'),
    page: z.number().int().min(1).max(10_000),
    perPage: z.number().int().min(1).max(200),
    before: epochSeconds.optional(),
    after: epochSeconds.optional(),
  }),
]);
export type GatewayOperation = z.infer<typeof gatewayOperationSchema>;

export const gatewayRequestSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  athleteId: activityId,
  operation: gatewayOperationSchema,
});
export type GatewayRequest = z.infer<typeof gatewayRequestSchema>;

/**
 * Why a read did not produce a payload. Every failure says whether trying
 * again can help, and `rate_limited` says when.
 */
export const gatewayFailureSchema = z.discriminatedUnion('kind', [
  /** The shared budget or the provider refuses requests for now. */
  z.object({
    kind: z.literal('rate_limited'),
    retryAfterSeconds: z.number().int().positive(),
  }),
  /** The owner's connection is gone or the provider rejects its token. The
   * owner must reconnect; retrying cannot help. */
  z.object({ kind: z.literal('credentials_rejected') }),
  /** The provider says the activity does not exist. */
  z.object({ kind: z.literal('not_found') }),
  /** The owner's grant does not cover this activity. */
  z.object({ kind: z.literal('forbidden') }),
  /** Anything else from the provider or the network. */
  z.object({
    kind: z.literal('upstream_error'),
    status: z.number().int().nullable(),
    retryable: z.boolean(),
  }),
]);
export type GatewayFailure = z.infer<typeof gatewayFailureSchema>;

export const gatewayResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: gatewayFailureSchema }),
]);
export type GatewayResult = z.infer<typeof gatewayResultSchema>;

const message = (keyId: string, timestamp: string, body: string) =>
  `activitymap-provider-v1\n${keyId}\n${timestamp}\n${body}`;

export function signGatewayRequest(
  keyId: string,
  secret: string,
  timestamp: string,
  body: string,
) {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(message(keyId, timestamp, body))
    .digest('hex');
}

/** Whether `signature` was made over exactly this body by a known key, with
 * a timestamp within the window on either side of `now`. */
export function verifyGatewayRequest(input: {
  keys: Record<string, string>;
  keyId: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now: number;
}) {
  const { keyId, timestamp, signature } = input;
  if (!keyId || !timestamp || !signature) return false;
  const secret = Object.hasOwn(input.keys, keyId) ? input.keys[keyId] : null;
  const sent = Number(timestamp);
  if (
    !secret ||
    !/^\d{1,16}$/.test(timestamp) ||
    Math.abs(input.now - sent) > GATEWAY_SIGNATURE_WINDOW_MS ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return false;
  const expected = signGatewayRequest(keyId, secret, timestamp, input.body);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
