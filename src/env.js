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
    PGHOST: z.string(),
    PGHOST_UNPOOLED: z.string(),
    PGUSER: z.string(),
    PGDATABASE: z.string(),
    PGPASSWORD: z.string(),
    POSTGRES_URL: z.string().url(),
    POSTGRES_URL_NO_SSL: z.string().url(),
    POSTGRES_URL_NON_POOLING: z.string().url(),
    POSTGRES_PRISMA_URL : z.string().url(),
    POSTGRES_USER: z.string(),
    POSTGRES_HOST: z.string(),
    POSTGRES_DATABASE: z.string(),
    POSTGRES_PASSWORD: z.string(),
    AUTH_SECRET: z.string(),
    AUTH_STRAVA_ID: z.string(),
    AUTH_STRAVA_SECRET: z.string(),
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
    PGHOST: process.env.PGHOST,
    PGHOST_UNPOOLED: process.env.PGHOST_UNPOOLED,
    PGUSER: process.env.PGUSER,
    PGDATABASE: process.env.PGDATABASE,
    PGPASSWORD: process.env.PGPASSWORD,
    NODE_ENV: process.env.NODE_ENV,
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE,
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
    POSTGRES_URL_NO_SSL: process.env.POSTGRES_URL_NO_SSL,
    POSTGRES_URL_NON_POOLING:
      process.env.POSTGRES_URL_NON_POOLING,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_STRAVA_ID: process.env.AUTH_STRAVA_ID,
    AUTH_STRAVA_SECRET: process.env.AUTH_STRAVA_SECRET,
    PUBLIC_URL: process.env.PUBLIC_URL,
    NEXT_PUBLIC_MAPBOX_TOKEN:
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
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
