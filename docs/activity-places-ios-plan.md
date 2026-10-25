# Matched places on iOS

Implementation notes and remaining plan, 23 October 2026. Based on merged
[PR #445](https://github.com/wirhabenzeit/activitymap/pull/445).

## Decision

Reuse the deployed web endpoint, `GET /api/activities/{id}/places`, with bearer
authentication. iOS consumes its exact existing response and matching behavior.
There are no new server routes, OpenAPI operations, migrations or deployment
requirements for this native delivery.

Matching stays on the server. The native client does not download the reference
catalogue, store full GPS for matching or run its own matching algorithm. The
medium-term source will be persisted server relations behind the existing read
boundary; storage location and physical database topology remain server details.

## Shared wire contract and transport

The existing endpoint returns an unwrapped JSON response with:

- Account/activity identity, stream generation/revision, catalogue snapshot and
  matcher version.
- Explicit `complete`, `missing_streams`, `uncovered`, `partial` and `unavailable`
  states. Completed zero-match results remain distinguishable from incomplete
  processing.
- Place UUID, name, kinds, coordinates, optional mapped elevation and separate
  visit distances. A null provider distance is a valid map-only encounter.

The Swift DTO generator now reads `activityPlacesResponseSchema` and
`matchedPlaceSchema` directly from `src/contracts/activity-places.ts`. No native
response variant or additional matching-context fields are invented.

`ActivityPlacesAPI` uses an explicit unwrapped GET in `APIClient`. HTTP error
mapping, bearer authentication, disabled cookie handling, cancellation,
request IDs and Retry-After behavior remain shared with the rest of the client.
Standard v1 calls still require their versioned response envelope. Activity IDs
and stream revisions remain decimal strings throughout transport and storage.

## Native cache and freshness

SwiftData keeps the latest accepted result per deployment/account/activity,
including successful empty results. Map and detail share one loader and request
queue, with at most two simultaneous network requests. Saved-place reads run
independently so slow requests cannot hide cached places from other chooser
results. An inspected activity takes priority. One consumer leaving does not
cancel another consumer's demand.

| Situation                                             | Behavior                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Current completed result under one day old            | Immediate reuse across selection changes and app launches                     |
| Completed result at least one day old, online         | Show the valid saved result while lazily rechecking through the same endpoint |
| Saved completed result, offline                       | Keep it available regardless of age, subject to source and session validity   |
| No saved result, offline                              | Keep the route usable and omit place indicators silently                      |
| Incomplete result                                     | Preserve its status and use a fifteen-minute retry cooldown                   |
| Changed recorded streams                              | Invalidate derived places immediately and reload active demand                |
| New catalogue/matcher identity observed in a response | Invalidate older identities in disk reads and visible results                 |
| Transient request failure                             | Preserve a still-valid result and honor retry timing                          |
| Deletion, replacement, logout or scope change         | Remove/fence affected private data and reject late writes/publications        |

The web endpoint does not expose a cheap catalogue-version check. Consequently,
the client cannot learn about a new publication until it fetches an activity's
matches. Daily online revalidation bounds that delay while avoiding a match
request for every selection. It does not imply knowledge of server changes
while offline. Changes to matching parameters also require the server's matcher
version to change, or become visible on a subsequent timed recheck.

A small local catalogue/matcher identity is retained in `StoredPlacesContext`.
It is learned from activity responses and does not represent another endpoint.
The model name and stored keys remain compatible with the first Dev install;
older DTO payloads with extra context fields are safely ignored during decode.
A later-started accepted response fences an older in-flight response from
restoring a retired identity.

Ordinary activity sync reconciles validity and may revalidate demanded results
whose daily freshness window elapsed. It never runs matching across the whole
library. There is no library-wide places bootstrap/batch operation yet.

## Map and elevation presentation

The map renders places for every selected, filter-visible route, matching the
web. A map tap's selected chooser results contribute places immediately,
regardless of which route is active or whether Combine is enabled. The
elevation profile remains specific to the active route. The same selected scope
controls map requests, markers and hit testing; narrowing it
cancels requests no longer needed by either the map or an open profile.
Shared UUIDs become one marker with a distinct contributing-route count. Tapping opens a compact card
with name and mapped elevation, while preserving route
selection and camera position. Markers keep a fixed center anchor; the card uses
a separate bottom anchor so opening it cannot move its icon. The focused card
stays above neighboring markers and survives map style changes. OSM attribution
is available through the map's attribution control. Shared vector definitions
generate matching web and native peak, curved pass and overhanging-roof hut
symbols. Map and profile use small monochrome circles with blue selection.
Geographic annotations remain visible in both landscape orientations.

The profile keeps repeated encounters as separate symbols/actions. Projection
requires an exact stream-generation/revision match, subtracts the profile's
first provider-distance value and interpolates onto the supplied elevation
curve. It never substitutes mapped place altitude for recorded profile altitude.
Visits outside the averaged summary's distance range are clamped to its endpoints.
Null distances and ambiguous repeated-distance positions are omitted from the
chart while remaining eligible for the map. Symbols sit just above the profile
with light dashed guides beneath them and room at both endpoints.

Selecting a profile encounter in Map detail focuses the matching map card and
highlights its place symbol, revealing the place on the map when needed.
The selected encounter's name, distance and recorded altitude appear in a blue
readout above the chart. List/Stats detail uses that local readout without
switching tabs. A stationary chart tap dismisses the place, while scrubbing
preserves it. Profile symbols select their place directly with a plain
button, without a menu's lift animation. Repeated encounters retain separate
marks, and named VoiceOver actions reach every encounter, including overlaps.
There is no additional Places button beside the profile. Sample scrubbing and horizontal
activity paging keep their existing behavior. Place focus is independent of the
transient sample cursor and clears with obsolete source/selection/scope state.

The activity-detail hierarchy and compact phone chart footprint are retained.
Place loading, empty results, unavailable coverage and request failures stay
silent on both map and profile. Cache reuse and request backoff still apply.
Native cards respect display units and light/dark appearance.

## Implementation boundaries

Paths in this table are relative to `ios/ActivityMap/ActivityMap/` unless noted.

| Concern                           | Implementation                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Existing server read              | `src/app/api/activities/[id]/places/`, unchanged                                                 |
| Shared wire schema                | `src/contracts/activity-places.ts`, unchanged                                                    |
| Generated transport DTOs          | `scripts/generate-api-dtos-swift.ts`, `Networking/DTO/ActivityMapAPI.generated.swift`            |
| Web transport                     | `Networking/ActivityPlacesAPI.swift`, explicit unwrapped GET in `Networking/APIClient.swift`     |
| Durable results and identity      | `Persistence/StoredActivityPlaces.swift`, `LocalStore+ActivityPlaces.swift`                      |
| Shared request lifecycle          | `Places/ActivityPlacesLoader.swift`                                                              |
| Session and source reconciliation | `Sync/SyncController.swift`, `Persistence/LocalStore+Summaries.swift`, replacement/cleanup paths |
| Map markers/cards                 | `Map/MatchedPlacesLayer.swift`, `Places/MatchedPlaces.swift`, `Map/MapScreen.swift`              |
| Profile projection/interactions   | `Places/MatchedPlaces.swift`, `Streams/ElevationProfile.swift`, `ElevationProfileView.swift`     |

## Verification

`ActivityPlacesTests` exercises the actual bare web response and URL, bearer
headers, ordinary v1-envelope enforcement, error/backoff handling, lossless IDs,
wrong-activity rejection, shared demand, daily revalidation, offline reuse,
completed zeroes, disk-schema upgrade, account isolation, source/context/deletion
fences, bounded request priority, stale-source recovery and profile projection.
It also checks that saved chooser results appear while other routes' requests
are blocked and that all visible selected routes contribute places regardless
of the active route or Combine mode.

`ActivityPlacesUITests/testOfflineMapProfileStyleAndSelection` uses production
map/profile components with synthetic offline data and an inline style. It
checks marker cards, separate repeated-visit actions, style replacement, focus
and route-selection preservation. It is included in both native harness profiles.
The overlapping-route tap journey starts with no selection and verifies places
from both routes before either is activated, with shared places rendered once.
The rotation journey covers portrait, both landscape orientations and style changes.

Run `pnpm check` plus the affected native cache/transport suites and places UI
journey. The broader native PR profile also covers existing browsing, sharing,
sync and stats flows. Screenshots live under
`output/quality/ios-matched-places/`. Simulator evidence does not replace
physical-device touch and VoiceOver acceptance.

## Later server relation delivery

Replace on-demand computation with reads from published server relations while
preserving the read model and native rendering/cache boundaries. Route selection
then reads results without starting matching.

Server prerequisites remain:

- Atomically publish relation replacement and durable per-activity processing
  state, including completed zeroes. No relation rows cannot distinguish
  unprocessed from a successful check with no places.
- Bind published results to stream and catalogue/matcher identity. Retained older
  output must not masquerade as a completed current result.
- Make newly published results discoverable independently of activity/stream
  changes, using a monotonic result revision and invalidation/removal events.
- If relations live in another physical database, use durable publication,
  delivery and reconciliation rather than assuming a cross-database transaction.

Then add measured, bounded batch reads and opportunistic catch-up, prioritizing
active/recent routes and paging older libraries without blocking activity sync.
Bootstrap/change-feed delivery can provide broader offline availability later;
client page mutations/checkpoints must commit atomically and retain rebootstrap
recovery. This remains independent of the current native feature.
