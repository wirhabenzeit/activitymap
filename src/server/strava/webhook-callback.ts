import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Strava does not sign webhook deliveries, and the `subscription_id` they
 * carry is a small public integer. The only way to authenticate the
 * producer is a secret that only Strava and this deployment know: it is
 * embedded as a path segment in the callback URL registered with Strava
 * (`/api/strava/webhook/<secret>`), so every verification GET and event
 * POST Strava sends carries it.
 *
 * A path segment (rather than a query parameter) is used because Strava
 * appends its own `hub.*` query parameters to the callback URL on
 * verification.
 */
export const WEBHOOK_CALLBACK_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** The configured callback secret, or `null` when unset or malformed (fail closed). */
export function webhookCallbackSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.STRAVA_WEBHOOK_CALLBACK_SECRET;
  return secret && WEBHOOK_CALLBACK_SECRET_PATTERN.test(secret) ? secret : null;
}

/**
 * Constant-time comparison of the callback URL's key segment against the
 * configured secret. Both sides are hashed first so the comparison does not
 * leak the secret's length. Returns `false` whenever no valid secret is
 * configured.
 */
export function webhookCallbackKeyMatches(
  key: string | undefined,
  secret: string | null,
): boolean {
  if (!secret || !key) return false;
  const presented = createHash('sha256').update(key).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(presented, expected);
}

/** The callback URL to register with Strava for this deployment. */
export function webhookCallbackUrl(publicUrl: string, secret: string): string {
  return new URL(`/api/strava/webhook/${secret}`, publicUrl).toString();
}
