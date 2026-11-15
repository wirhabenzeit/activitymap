# Local development

The web app needs a Convex backend to start. There is no local database: the
library, sign-in records and ingestion state all live in a Convex deployment
(see [backend/README.md](../backend/README.md)). The app is started from the
repository root:

```sh
pnpm install
pnpm dev        # http://localhost:3000
```

## Environment files

`pnpm dev` reads `.env.development.local` and `.env` **in the repository
root**. Both are gitignored, so a fresh checkout has neither and the server
exits immediately with `Invalid environment variables` or
`ACTIVITYMAP_CONVEX_SITE is not configured`. `.env.example` lists every
variable and is documentation only: uncommenting a line there configures
nothing.

A working `.env.development.local` contains:

| Group                  | Variables                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App                    | `AUTH_SECRET`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_ENV=development`                                                                                                                                                                           |
| Sign-in (Strava)       | `AUTH_STRAVA_ID`, `AUTH_STRAVA_SECRET`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`, `PUBLIC_URL`, `NEXT_PUBLIC_APP_URL` all set to `http://localhost:3000` (or whichever port you use)                                                            |
| Convex bridge          | `ACTIVITYMAP_CONVEX_SITE` (`https://<deployment>.convex.site`), `ACTIVITYMAP_CONVEX_URL` (`.convex.cloud`), `ACTIVITYMAP_CONVEX_KEY_ID`, `ACTIVITYMAP_CONVEX_SIGNING_KEY`, and the `…_WRITER_KEY_ID` / `…_WRITER_SIGNING_KEY` pair                 |
| Webhooks and cron      | `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_WEBHOOK_CALLBACK_SECRET`, `CRON_SECRET`, and `AUTH_STRAVA_*` / `PUBLIC_URL`; all required once external effects are enabled. `ACTIVITYMAP_PROVIDER_GATEWAY_KEYS` additionally turns on the provider gateway |
| Admin / mobile sign-in | `ACTIVITYMAP_ADMIN_ATHLETE_IDS`, `MOBILE_AUTH_REDIRECT_ALLOWLIST` (optional)                                                                                                                                                                       |

`ACTIVITYMAP_EXTERNAL_EFFECTS=enabled` switches on webhooks, cron and the
provider gateway, and then makes the webhook/cron secrets mandatory. Leave it
unset unless you are deliberately testing those paths: with it enabled the
dev server can act on the real Strava account that signs in.

### First-time Convex setup

Do this once per machine. The development deployment is
`activitymap-backend-dev`; the commands are the ones from
[backend/README.md](../backend/README.md#development-configuration):

```sh
cd backend
pnpm exec convex dev --configure        # writes backend/.env.local (CONVEX_* only)
# 64 lowercase hex characters each: openssl rand -hex 32
pnpm exec convex env set ACTIVITYMAP_BRIDGE_SIGNING_KEYS '{"dev1":"<reader-hex>"}'
pnpm exec convex env set ACTIVITYMAP_BRIDGE_WRITER_KEYS  '{"devw1":"<writer-hex>"}'
```

Then put the same keys in the **root** `.env.development.local`
(`ACTIVITYMAP_CONVEX_KEY_ID=dev1`, `ACTIVITYMAP_CONVEX_SIGNING_KEY=<reader-hex>`,
`…_WRITER_KEY_ID=devw1`, `…_WRITER_SIGNING_KEY=<writer-hex>`) together with the
deployment's `.site` and `.cloud` URLs. `backend/.env.local` is only read by the
Convex CLI; the Next.js app does not load it. Never commit either file.

## Git worktrees

Worktrees (including those created by Codex, Claude Code and T3 Code) start
without the gitignored env files, so the dev server fails until they are
copied in. From another checkout that works:

```sh
SRC=/path/to/working/checkout
cp "$SRC/.env.development.local" .
mkdir -p backend && cp "$SRC/backend/.env.local" backend/   # only for Convex CLI use
```

Copy from a checkout whose code is as new as yours. An older checkout can
carry an env file from before the Convex migration: it has no
`ACTIVITYMAP_CONVEX_*` variables and the app will not start against it.
A worktree that is behind `main` may also still contain the old
Postgres/Drizzle code, which no longer exists; update it before debugging.

All worktrees share one Convex dev deployment and one default port, so run one
dev server at a time or give the others a different port (`pnpm dev -p 3100`)
and set the three `…URL` variables to match.

## Checks

`pnpm check` runs typecheck, lint, generated-file checks and the unit suites.
The browser and native harnesses start isolated servers with fixture
configuration; see [Quality checks](quality-checks.md).
