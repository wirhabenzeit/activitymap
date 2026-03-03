# Offline Implementation Plan

## Goal
Make the web app offline-usable with an **offline read-first** approach:
- Render activities/photos from IndexedDB immediately.
- Refresh in background from network when available.
- Keep edit/sync/delete actions network-only in v1.

## Current Status (Phase 1 started)
- Added IndexedDB scaffolding in [src/lib/offline/db.ts](/Users/dominik/Documents/github/activitymap/src/lib/offline/db.ts):
  - `activities`
  - `photos`
  - `sync_meta`
  - `app_meta`
- Refactored [src/hooks/use-activities.ts](/Users/dominik/Documents/github/activitymap/src/hooks/use-activities.ts) to:
  - Hydrate from IDB using scope key (`auth:*` / `guest:*`)
  - Keep existing network query for background freshness
  - Persist network results back to IDB

## Phases

### 1. IDB Foundation
- [x] Create IDB database and core stores
- [x] Add typed read/write utilities for activities/photos/meta
- [ ] Add scoped clear helpers for logout/account switching

### 2. Read Path Integration
- [x] Make activities hook IDB-first
- [x] Make photos hook IDB-first
- [ ] Ensure stats/map/list read from local datasets without network requirement

### 3. Sync and Invalidation
- [x] Add bootstrap endpoint for initial hydration
- [x] Add delta endpoint (`changes since cursor`)
- [x] Persist sync cursor in `sync_meta`
- [x] Handle deletions explicitly (tombstones/deleted IDs feed)
- [ ] Add periodic full reconciliation fallback

### 4. Offline UX Policy
- [ ] Add global online/offline status indicator
- [ ] Disable edit/sync/delete actions offline with clear error messaging
- [ ] Differentiate offline failures from auth/session failures

### 5. Service Worker
- [x] Cache app shell/static assets
- [ ] Add runtime caching for selected GET endpoints
- [ ] Keep map tile caching best-effort (no guaranteed offline map packs)

## Invalidation Rules
- Cursor-based updates for upserts/deletes.
- Schema version-based cache migration/reset.
- User-scope isolation for all cached records.
- Clear user scope on logout or account switch.

## Notes
- v1 intentionally does **not** queue local writes while offline.
- Offline edits should fail fast with explicit UI feedback.
