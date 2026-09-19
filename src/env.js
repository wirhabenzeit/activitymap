import {createEnv} from "@t3-oss/env-nextjs";
import {z} from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    CRON_SECRET: z.string(),
    DATABASE_URL: z.string().url(),
    DATABASE_URL_UNPOOLED: z.string().url(),
    // Not used by the app: DATABASE_URL is the runtime connection. These two
    // remain only as fallbacks for the schema tooling (see
    // src/server/db/migration-url.ts) and drizzle/reset.ts, so they are
    // optional rather than required for a deploy.
    POSTGRES_URL: z.string().url().optional(),
    POSTGRES_URL_NON_POOLING: z.string().url().optional(),
    AUTH_STRAVA_ID: z.string(),
    AUTH_STRAVA_SECRET: z.string(),
    // Read by better-auth directly: src/lib/auth.ts passes neither `secret`
    // nor `baseURL`, so the library falls back to these.
    BETTER_AUTH_SECRET: z.string(),
    BETTER_AUTH_URL: z.string().url(),
    STRAVA_WEBHOOK_VERIFY_TOKEN: z.string(),
    PUBLIC_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_MAPBOX_TOKEN: z.string(),
    NEXT_PUBLIC_ENV: z.enum(['development', 'production']).optional(),
    // better-auth client baseURL; falls back to localhost when unset.
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    CRON_SECRET: process.env.CRON_SECRET,
    STRAVA_WEBHOOK_VERIFY_TOKEN: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN,
    POSTGRES_URL: process.env.POSTGRES_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    NODE_ENV: process.env.NODE_ENV,
    POSTGRES_URL_NON_POOLING:
      process.env.POSTGRES_URL_NON_POOLING,
    AUTH_STRAVA_ID: process.env.AUTH_STRAVA_ID,
    AUTH_STRAVA_SECRET: process.env.AUTH_STRAVA_SECRET,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_URL: process.env.PUBLIC_URL,
    NEXT_PUBLIC_MAPBOX_TOKEN:
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
