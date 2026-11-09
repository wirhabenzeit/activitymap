import type { JwtOptions } from 'better-auth/plugins';

export const CONVEX_TOKEN_AUDIENCE = 'convex';

/**
 * Options for Better Auth's `jwt` plugin, which issues the short-lived tokens
 * the Convex application backend accepts (docs/convex-reactive-reads.md).
 *
 * Off unless `ACTIVITYMAP_AUTH_JWT_ISSUER` is set. The issuer is fixed per
 * environment: preview deployments run on changing hosts, and Convex matches
 * `iss` exactly.
 */
export function convexJwtOptions(
  environment: Record<string, string | undefined> = process.env,
): JwtOptions | null {
  const issuer = environment.ACTIVITYMAP_AUTH_JWT_ISSUER?.trim();
  if (!issuer) return null;
  return {
    // Convex verifies only RS256 and ES256; the plugin defaults to EdDSA.
    jwks: { keyPairConfig: { alg: 'ES256' } },
    jwt: {
      issuer,
      audience: CONVEX_TOKEN_AUDIENCE,
      expirationTime: '15m',
      // The token identifies the user (`sub`) and nothing else: the plugin's
      // default payload would copy the whole user record into it.
      definePayload: () => ({}),
    },
    // Tokens are fetched explicitly from /api/auth/token, not attached to
    // every session response.
    disableSettingJwtHeader: true,
  };
}
