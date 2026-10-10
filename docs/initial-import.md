# Visible initial activity import

Newly connected accounts import their most recent 200 Strava activity summaries
in four foreground requests of up to 50 activities each. A short final page
finishes earlier; an empty first page displays an explicit empty-history message.
Web and iOS show progress without blocking browsing, refresh their activity data
after every committed page, and distinguish this milestone from background
history, detail, photo and stream enrichment.

`GET /api/v1/initial-import` reads account-scoped progress. `POST` advances at most
one page and accepts no client-supplied account, range, page or quota. Both cookie
and native bearer authentication use the existing actor resolver. Browser POSTs
with an Origin must be same-origin. Responses are private and never cached.
Strava requests use the existing shared request budget and external-effects guard.

The `initial_activity_import` checkpoint pins an upper time bound for paging and
uses a 90-second lease to serialize concurrent clients. Activity rows, their
change-feed upserts, and the page checkpoint commit in one database transaction.
Only missing activity rows are seeded, so enrichment and webhook updates remain
authoritative. Commit rechecks the connected account and lease; expired or
revoked-account responses cannot advance the checkpoint. Failures preserve earlier
pages and expose a retry deadline. Clients honor that deadline and cancel scoped
work on logout/account changes. Native deployments missing this additive endpoint
continue ordinary sync.

Migration `0022_initial-activity-import.sql` marks already-connected accounts as
past onboarding. Those accounts retain their existing background sync and do not
get a new import banner. The milestone does not mark global Strava freshness or
detail/photo coverage complete. A short page marks the oldest activity reached;
the existing workers continue enrichment and any remaining history.

## Verification

- Application, handler and web-loop tests cover bounded pages, empty/small
  histories, returning accounts, credential changes, budget cooldowns, HTTP
  Retry-After, publication order and cancellation.
- `pnpm db:test-initial-import` runs against a guarded local `*_test` database.
  It proves lease concurrency/replacement, atomic page/change-feed writes,
  revocation, replay, preserving existing details, rollout behavior and deletion
  cascading. CI runs it after migrations.
- `node scripts/verify-initial-import.mjs http://127.0.0.1:3000` checks the real
  web banner and React Query invalidation with synthetic responses. It verifies
  first-batch browsing while the next response is held, completion/dismissal,
  empty history, retry cooldowns, returning users, account switching and
  desktop/mobile/landscape/dark layouts. It creates and removes its own temporary
  fixture route, so run separately from lint/type-check file discovery.
- iOS `InitialImportTests`, `SyncControllerTests` and `SyncEngineTests` verify
  progressive cache publication, retry deadlines, logout fences and returning
  users in the simulator.

These checks use synthetic upstream pages and isolated local state. They do not
measure real Strava latency or exercise a live OAuth sign-up.

The [browser verification result](initial-import-browser-verification.json) and
[mobile capture](initial-import-mobile.png) document the local fixture run. The
capture uses the production banner with a synthetic browse list.
