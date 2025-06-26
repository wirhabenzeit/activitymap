# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ActivityMap is a Next.js 15 PWA for mapping, listing, and analyzing Strava activities with PostgreSQL backend and Mapbox integration.

## Core Commands

```bash
# Development
pnpm dev              # Start development server with Turbo
pnpm build            # Build for production
pnpm start            # Start production server
pnpm lint             # Run ESLint

# Database Management
pnpm db:push          # Push schema changes to database
pnpm db:studio        # Open Drizzle Studio (database GUI)
pnpm db:reset         # Reset database

# Testing & Utilities
pnpm test:sync        # Test Strava activity sync
```

## Architecture

**Stack:** Next.js 15 + React 19 + TypeScript + Tailwind CSS + Drizzle ORM + PostgreSQL

**Key Directories:**
- `src/app/` - Next.js App Router (API routes, pages)
- `src/components/` - React components organized by feature (ui/, list/, map/, stats/)
- `src/server/` - Server-side logic (database actions, Strava integration)
- `src/store/` - Zustand state management
- `drizzle/` - Database schema and migrations

**Core Features:**
- **Map View** (`/map`) - Interactive Mapbox maps with activity routes
- **List View** (`/list`) - Sortable data table with filtering
- **Stats View** (`/stats`) - Observable Plot visualizations (heatmaps, timelines, scatter plots)

## Development Setup

**Required Environment Variables:**
```bash
# Database (Vercel Postgres recommended)
POSTGRES_URL=
POSTGRES_PRISMA_URL=
# ... other Postgres variables

# Authentication
AUTH_SECRET=              # Generate with: npx auth secret
AUTH_STRAVA_ID=
AUTH_STRAVA_SECRET=

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=

# Strava Webhooks (optional)
STRAVA_WEBHOOK_VERIFY_TOKEN=
```

**Local Database Setup:**
Use `docker-compose.yml` for local PostgreSQL or connect to Vercel Postgres.

## Key Integrations

- **Strava API** - Activity sync via webhooks (`src/server/strava/`)
- **Mapbox GL JS** - Interactive maps with route visualization
- **Drizzle ORM** - Type-safe database operations
- **NextAuth.js** - Strava OAuth authentication
- **Observable Plot** - Data visualization charts

## Code Patterns

- Type-safe environment validation with `@t3-oss/env-nextjs`
- Server Actions for database operations
- Zustand stores for client state
- Radix UI + shadcn/ui components
- Tailwind CSS with design system tokens
- React Compiler optimizations enabled

## Performance Optimizations

- React.memo wrappers on heavy components (MapView, ListView, DataTable)
- Removed 'use no memo' directives to enable React optimizations
- Lazy loading implemented for view components
- RouteLayer component memoized to prevent unnecessary re-renders

## Important Notes

- No formal testing framework - manual testing with utility scripts
- PWA-enabled with offline support
- Mobile-responsive design
- Production-ready with Vercel deployment optimizations