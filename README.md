# ActivityMap

Map, list, and analyze all your Strava activities.

[Demo](https://activitymap.cc)

## Features

- Filter by _distance_, _elevation_, _date_, _sport type_, ...
- Activities stay in sync automatically via a Strava [webhook](https://developers.strava.com/docs/webhooks/)
- Share all/selected activities with friends & family
- Easy to customize and extend

### Map View

- Wide range of map styles and overlays
- Shareable map screenshots
- Overlays of biking and hiking routes

### List View

- Customizable, sortable columns

### Stats View

- Stats tiles with recent volume, comparisons, records and activity patterns
- Expanded training history by week, month and year
- Activity calendar with year navigation and individual day activities

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) + React 19
- [Convex](https://www.convex.dev/) backend (`backend/`) for the library, its ingestion and the sign-in records
- [better-auth](https://www.better-auth.com/) for Strava OAuth
- [Mapbox GL](https://www.mapbox.com/) / [react-map-gl](https://visgl.github.io/react-map-gl/) for the map view
- [TanStack Table](https://tanstack.com/table) and [TanStack Charts](https://tanstack.com/charts) for the list and stats views
- [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) for the component layer

## Project layout

- `src/app` — routes (`list`, `map`, `stats`), API routes, and server actions
- `src/components` — UI, split by feature area (`map`, `list`, `stats`, `settings`, `layout`)
- `src/server` — sign-in, the signed bridges to the backend, Strava access and place matching
- `backend` — the Convex backend: activities, recordings, photos, place matches, ingestion jobs and sign-in records
- `src/store` — client-side state (Zustand)
- `cloudflare/cron` — the scheduled call that erases accounts whose Strava access was withdrawn

## Quality checks

Run `pnpm check` for static, generated-file and unit checks. Browser and native runtime checks have explicit isolated startup and evidence: see [Quality checks](docs/quality-checks.md). Use `pnpm format:check` for a nonmutating check of changed files.

## Data

The running app keeps nothing in Postgres. An account's library and the
app's own records (sign-in, Strava tokens, rate limits) live in the Convex
backend; see [backend/README.md](backend/README.md). The app needs
`ACTIVITYMAP_CONVEX_SITE` and the bridge keys described there.

A place catalogue is built from OpenStreetMap extracts and published
straight to the backend (`pnpm places:prepare`, `places:combine`,
`places:publish`); see
[Place catalogue preparation and refresh](docs/place-catalogue-refresh.md).

Nothing needs Postgres any more. What is left of it in this repository (the
schema in `src/server/db`, which still supplies types, and the migration
tooling in `drizzle/` and `scripts/database`) is to be removed.

## Behavior references

- [Accepted navigation contract](docs/navigation-contract.md) — containers, history, dismissal, control meanings, baseline-to-target audit and delivery status for #358/#359.
- [Navigation implementation verification](docs/navigation-contract-2026-10-11/README.md) — browser/simulator results, selected captures and pending device acceptance.
- [Navigation behavior baseline](docs/navigation-audit-2026-10-11.md) — behavior and evidence captured before implementing the contract.
- [Map/list parity contract](docs/map-list-parity-contract.md)
- [Stats parity contract](docs/stats-parity-contract.md)
