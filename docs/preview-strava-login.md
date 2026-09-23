# Strava sign-in on Vercel Preview

Preview deployments register the Strava provider by default. A Preview build
fails early if its Strava credentials or OAuth proxy settings are missing,
instead of deploying a login button that returns 404. Preview has its own Neon
branch. Use a distinct `BETTER_AUTH_SECRET` for Preview, and never point it at
Production's database.

Preview sign-in and user-initiated Strava API actions make real Strava requests,
including token refresh and writes made through the app. Webhook processing,
subscription management, and cron jobs still require
`ACTIVITYMAP_EXTERNAL_EFFECTS=enabled`, which should remain absent on Preview.
Neon branches created from Production may contain copied Strava tokens. A fresh
sign-in gives the Preview account its own current tokens; avoid operating on
copied Production accounts that have not signed in again.

Strava requires the OAuth `redirect_uri` to be within its registered callback
domain. Better Auth's OAuth proxy sends the Strava callback to Production, then
returns encrypted OAuth data to the originating Preview. The user and tokens
are stored in the Preview database, not Production's database.

## Vercel setup

1. Confirm the managed `NEON_DATABASE_URL` points each Preview deployment to
   its own Neon branch. Keep `ACTIVITYMAP_EXTERNAL_EFFECTS` absent in Preview.
2. In **Production**, set `OAUTH_PROXY_PRODUCTION_URL` to the canonical origin
   (currently `https://activitymap.dominik.page`) and set a long random
   `OAUTH_PROXY_SECRET`. Retain Production's Strava credentials and its own
   `BETTER_AUTH_SECRET`. Redeploy Production first.
3. In the Vercel **Preview environment**, set `AUTH_STRAVA_ID`,
   `AUTH_STRAVA_SECRET`, `OAUTH_PROXY_PRODUCTION_URL`, and
   `OAUTH_PROXY_SECRET`. The proxy URL and secret must match Production's;
   Strava credentials must match the application registered with Production's
   callback domain. Keep a distinct `BETTER_AUTH_SECRET` in Preview. Do not set
   Production's `BETTER_AUTH_URL` in Preview; Better Auth derives the Preview
   URL from the incoming request.
4. Redeploy a Preview. Sign-in should redirect to Strava, then through
   Production back to that same Preview host. Confirm its session and account
   are present in the Preview Neon branch.

All Preview branches receive Preview-scoped secrets. Anyone able to deploy
untrusted code to a Preview branch could read those secrets. Keep Preview
deployments restricted to trusted contributors, and use branch-specific
variables if that is not true for every branch.

The Strava callback remains
`https://activitymap.dominik.page/api/auth/callback/strava`. Preview URLs do
not need to be registered with Strava.
