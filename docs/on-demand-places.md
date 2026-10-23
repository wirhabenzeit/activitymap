# Places along selected routes (web v1)

Selecting activities on the web map automatically matches their stored GPS against
the active Switzerland/Austria/Italy catalogue. Opening a route detail also asks
for its matches. Matched peaks, passes and huts appear on the map; route details
show named encounters and marks on the elevation profile. Repeated encounters
retain separate distances. A place shared by selected routes has one map marker.
Choosing a named encounter focuses its map popup; clicking the marker preserves
the activity selection. This delivery changes web UI only.

## Request and data flow

`GET /api/activities/{id}/places` resolves the existing authenticated actor and
uses the application's Neon WebSocket/Drizzle connection. It reads stored raw
GPS, time, distance and altitude. It never fetches Strava or writes activity/place
evidence. There are no new migrations or scheduling requirements.

One repeatable-read, read-only transaction binds the owned current stream,
validated published catalogue metadata, spatial candidates and matching. The
combined catalogue is preferred; local Swiss-only catalogues remain supported.
An additional read outside the snapshot fences the response after deletion,
revocation, erasure scheduling, source invalidation or stream replacement.
Responses have private/no-store headers and use the existing authentication,
rate-limit and request-observation boundary. Raw evidence stays server-side.

The web caches results briefly by account, activity and observed stream version.
Map and detail observers share in-flight requests. A cancellable queue permits
two concurrent requests and prioritizes an inspected activity. Deselecting or
filtering a route removes its markers; switching accounts changes the query scope.

## Matching and presentation

The existing versioned pure encounter matcher is reused with a fixed server
policy. It splits recording gaps, excludes implausible segments and bounds
samples, candidates and comparisons. Only supported relations from completed
checks appear. Budget exhaustion, missing streams, unavailable catalogues and
uncovered routes are distinct from a completed check with no matches. Thresholds,
candidate radii and evaluation diagnostics are absent from the product UI.

These are proximity-based matches to OSM reference points. Hut matches describe
vicinity; they do not infer entry or an overnight stay. The initial policy is
still a starting point for real-track evaluation and future algorithm iterations.

Profile marks use provider distance from the supported encounter and interpolate
onto the displayed sampled elevation curve, rather than using the mapped place
altitude as the plot height. A section-local GPS distance is not a global profile
position: such matches can appear on the map and in the place list without a
profile mark. Stream generation and revision must exactly match the displayed
profile before annotations are shown.

## Verification

- `pnpm check`: typecheck, lint, generated checks and repository test suites.
- `pnpm db:test-on-demand-places`: requires explicit guarded local
  `MIGRATION_*` settings and a migrated database whose name ends in `_test`.
  Uses invented catalogue/account/stream fixtures through the actual Neon driver
  and HTTP handler. Proves lossless IDs, no data writes, account eligibility,
  stale input rejection, concurrent revocation/replacement, coverage and budgets.
- `pnpm test:activity-places-ui`: isolated browser proof with the production hooks,
  actual Mapbox layers, elevation chart and synthetic API responses. Covers
  shared requests, repeated encounters, keyboard focus, multi-selection, filters,
  account changes, stream revision alignment, retry and coverage messages.
  Screenshots/results are retained under `output/quality/browser/activity-places`.

Both integration proofs run in CI. Local read-only evaluation of five existing
Alpine activities completed in 122–202 ms each; three returned positive matches.
