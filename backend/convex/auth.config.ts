import type { AuthConfig } from 'convex/server';

/**
 * Tokens issued by the app's Better Auth `jwt` plugin
 * (`src/lib/auth-jwt.ts`, backend/README.md, "Authenticated clients").
 *
 * Convex refuses to deploy an auth config that reads an unset environment
 * variable, so every deployment sets `ACTIVITYMAP_AUTH_JWT_ISSUER`:
 * - `disabled`: no provider; every caller is anonymous.
 * - otherwise the exact issuer of the app environment that reads this
 *   deployment, and `ACTIVITYMAP_AUTH_JWKS` holds that app's public JWKS as a
 *   data URI, so validation needs no request to the app.
 */
const issuer = process.env.ACTIVITYMAP_AUTH_JWT_ISSUER;

export default {
  providers:
    issuer === 'disabled'
      ? []
      : [
          {
            type: 'customJwt',
            issuer: issuer!,
            applicationID: 'convex',
            algorithm: 'ES256',
            jwks: process.env.ACTIVITYMAP_AUTH_JWKS!,
          },
        ],
} satisfies AuthConfig;
