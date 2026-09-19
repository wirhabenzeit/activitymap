# ActivityMap

Map, list, and analyze all your Strava activities.

[Demo](https://activitymap.dominik.page)

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

- Calendar heatmap
- Timeline of total distance/elevation/time per period, with local averaging
- Configurable scatter plot of all activities
- Progress plot per year or month

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) + React 19
- [Drizzle ORM](https://orm.drizzle.team/) on Postgres
- [better-auth](https://www.better-auth.com/) for Strava OAuth
- [Mapbox GL](https://www.mapbox.com/) / [react-map-gl](https://visgl.github.io/react-map-gl/) for the map view
- [TanStack Table](https://tanstack.com/table) and [TanStack Charts](https://tanstack.com/charts) for the list and stats views
- [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) for the component layer

## Project layout

- `src/app` — routes (`list`, `map`, `stats`), API routes, and server actions
- `src/components` — UI, split by feature area (`map`, `list`, `stats`, `settings`, `layout`)
- `src/server` — Strava sync, offline import, and database access
- `src/store` — client-side state (Zustand)
- `src/cron` — scheduled sync jobs

## Local database

```bash
docker compose up -d
pnpm db:migrate
```

Schema changes use checked-in Drizzle migrations; `db:push` is intentionally
not supported. Vercel Preview branches migrate automatically before their
builds, while Production migrations are automatically queued on `main` and
remain approval-gated. See [Database migrations](docs/database-migrations.md)
for the complete workflow.
