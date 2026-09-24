import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    ACTIVITYMAP_EXTERNAL_EFFECTS: z.literal('enabled').optional(),
    CRON_SECRET: z.string().optional(),
    NEON_DATABASE_URL: z.string().url().optional(),
    DATABASE_URL: z.string().url().optional(),
    AUTH_SECRET: z.string(),
    BETTER_AUTH_SECRET: z.string().optional(),
    AUTH_STRAVA_ID: z.string().optional(),
    AUTH_STRAVA_SECRET: z.string().optional(),
    OAUTH_PROXY_SECRET: z.string().optional(),
    OAUTH_PROXY_PRODUCTION_URL: z.string().url().optional(),
    STRAVA_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    PUBLIC_URL: z.string().url().optional(),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    VERCEL: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
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
    ACTIVITYMAP_EXTERNAL_EFFECTS: process.env.ACTIVITYMAP_EXTERNAL_EFFECTS,
    CRON_SECRET: process.env.CRON_SECRET,
    STRAVA_WEBHOOK_VERIFY_TOKEN: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    AUTH_STRAVA_ID: process.env.AUTH_STRAVA_ID,
    AUTH_STRAVA_SECRET: process.env.AUTH_STRAVA_SECRET,
    OAUTH_PROXY_SECRET: process.env.OAUTH_PROXY_SECRET,
    OAUTH_PROXY_PRODUCTION_URL: process.env.OAUTH_PROXY_PRODUCTION_URL,
    PUBLIC_URL: process.env.PUBLIC_URL,
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
  },
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((values, context) => {
      if (values.VERCEL && !values.NEON_DATABASE_URL && !values.DATABASE_URL) {
        context.addIssue({
          code: 'custom',
          path: ['NEON_DATABASE_URL'],
          message: 'NEON_DATABASE_URL or DATABASE_URL is required on Vercel',
        });
      }

      if (values.ACTIVITYMAP_EXTERNAL_EFFECTS === 'enabled') {
        const externalEffectVariables = {
          AUTH_STRAVA_ID: values.AUTH_STRAVA_ID,
          AUTH_STRAVA_SECRET: values.AUTH_STRAVA_SECRET,
          STRAVA_WEBHOOK_VERIFY_TOKEN: values.STRAVA_WEBHOOK_VERIFY_TOKEN,
          CRON_SECRET: values.CRON_SECRET,
          PUBLIC_URL: values.PUBLIC_URL,
        };

        for (const [variable, value] of Object.entries(
          externalEffectVariables,
        )) {
          if (!value) {
            context.addIssue({
              code: 'custom',
              path: [variable],
              message: `${variable} is required when external effects are enabled`,
            });
          }
        }
      }

      if (values.VERCEL_ENV === 'preview') {
        const previewAuthVariables = {
          BETTER_AUTH_SECRET: values.BETTER_AUTH_SECRET,
          AUTH_STRAVA_ID: values.AUTH_STRAVA_ID,
          AUTH_STRAVA_SECRET: values.AUTH_STRAVA_SECRET,
          OAUTH_PROXY_SECRET: values.OAUTH_PROXY_SECRET,
          OAUTH_PROXY_PRODUCTION_URL: values.OAUTH_PROXY_PRODUCTION_URL,
        };

        for (const [variable, value] of Object.entries(previewAuthVariables)) {
          if (!value) {
            context.addIssue({
              code: 'custom',
              path: [variable],
              message: `${variable} is required for Preview Strava access`,
            });
          }
        }
      }

      if (values.VERCEL_ENV === 'production') {
        for (const [variable, value] of Object.entries({
          OAUTH_PROXY_SECRET: values.OAUTH_PROXY_SECRET,
          OAUTH_PROXY_PRODUCTION_URL: values.OAUTH_PROXY_PRODUCTION_URL,
        })) {
          if (!value) {
            context.addIssue({
              code: 'custom',
              path: [variable],
              message: `${variable} is required for Preview OAuth callbacks`,
            });
          }
        }
      }

      if (Boolean(values.OAUTH_PROXY_SECRET) !== Boolean(values.OAUTH_PROXY_PRODUCTION_URL)) {
        context.addIssue({
          code: 'custom',
          path: ['OAUTH_PROXY_SECRET'],
          message: 'OAUTH_PROXY_SECRET and OAUTH_PROXY_PRODUCTION_URL must be configured together',
        });
      }
    }),
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
