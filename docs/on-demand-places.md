# Places along selected routes (web v1)

Selecting activities on the web map automatically matches their stored GPS against
the active Switzerland/Austria/Italy catalogue. Opening a route detail also asks
for its matches. Matched peaks, passes and huts appear on the map; route details
show interactive peak, pass and hut symbols directly on the elevation profile.
The filled symbols use Font Awesome 6 Solid: mountain for peaks, road for passes,
and house-chimney for huts. Place labels continue to identify passes as passes.
There is no duplicate place list. Hover, keyboard focus or a tap reveals the name.
Repeated encounters
retain separate distances. A place shared by selected routes has one map marker.
Choosing a profile symbol focuses its map popup; clicking the marker preserves
the activity selection. This delivery changes web UI only.

## Request and data flow

`GET /api/activities/{id}/places` resolves the authenticated actor and reads the
persisted private result for the current stream and matching version. It never
fetches Strava. A stale result is hidden immediately on a server read and replaced
by an explicit `pending` response; `after()` requests a bounded local matching
pass for that activity. The periodic worker independently catches up all current
stored streams, including new activities, without relying on anyone opening them.
The combined Switzerland/Austria/Italy catalogue is preferred; Swiss-only local
catalogues remain supported.

A private read checks ownership, connection, revocation and erasure eligibility.
It compares stream generation/revision/source fingerprint, catalogue snapshot and
revision, and algorithm/discovery/settings recipe. A second read outside its
snapshot fences concurrent deletion, revocation, stream replacement or catalogue
publication. A check completing for unchanged inputs may safely leave one final
pending response, which keeps polling. HTTP responses are private/no-store.

The web reads `/api/places/version` on mount, window focus and every 30 seconds
while observing places. That token follows the catalogue revision and matching
recipe, and forms part of every account/activity/stream query key. Thus catalogue
and algorithm updates refresh even completed zero-match results without a stream
change. Pending checks poll (starting at three seconds, reduced for large
selections); completed responses carry their own result revision. Results from a
known mismatched token are hidden while the version is refreshed. Other account
caches are never reused.
Loading stays in a fixed-height chart header and a compact map status pill; it
does not add rows to the card. The themed map card shows the place name, kind and
elevation, plus a route count when shared. Map and detail observers share in-flight requests. A cancellable queue permits
two concurrent requests and prioritizes an inspected activity. Deselecting or
filtering a route removes its markers; switching accounts changes the query scope.

## Matching and presentation

The existing versioned pure encounter matcher is reused with a fixed server
policy. It splits recording gaps, excludes implausible segments and bounds
samples, candidates and comparisons. Only supported relations from completed
checks appear. Budget exhaustion, missing streams, unavailable catalogues and
uncovered routes are distinct from a completed check with no matches. Thresholds,
candidate radii and evaluation diagnostics are absent from the product UI.

Peak matching uses matcher v5's weighted spatial score:
`sqrt((horizontal_distance / peakRadiusM)^2 + (elevation_difference / peakVerticalToleranceM)^2)`.
A score at or below 1 supports a match. Both components come from the same
recorded point or reliable interpolated point. The matcher evaluates the full
encounter, including segment endpoints and the analytic minimum along each
segment. Sparse interpolation and recording gaps cannot supply a confirmed visit;
a reliable observed endpoint can still support one. Missing or unaligned recorded
elevation, or missing mapped elevation, falls back explicitly to horizontal-only
scoring (`horizontal_distance / peakRadiusM`). Zero elevation is valid data.
Passes and huts retain horizontal proximity matching.

Evidence retains the original horizontal closest point and separately records the
peak scoring point, its score, signed elevation difference, raw 3D distance,
scoring mode, reliability and route position. Peak profile annotations use that
scoring position. The debug popup shows both measurements; a weighted score is a
distance score, not a probability. The horizontal and vertical tolerances form an
ellipse, so being inside both individual limits alone does not guarantee a match.

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
  account changes, stream revision alignment, retry and coverage messages. Also
  checks distinct symbols, map style replacement, cached profile reopening, fixed
  loading height and the absence of the former place list.
  Screenshots/results are retained under `output/quality/browser/activity-places`.

The database and browser proofs run in CI; persistent-state coverage is described
below.

## Local batch matcher

`loadBatchPlaceCatalogue` loads the active catalogue metadata, its revision and
the requested minimal matching fields within one read-only repeatable-read
transaction. Without a scope it loads the full catalogue for explicit benchmarks;
normal refreshes supply the padded windows of the activities being processed.
It verifies the full active row count against the manifest without transferring
unselected place rows, and freezes the snapshot. Each group pins its loaded copy;
the run keeps the same catalogue revision across groups. There is no mutable
process-wide catalogue cache.

`createBatchActivityPlaceMatcher` builds a Cartesian spatial grid once, then
discovers candidates, checks coverage and scores visits entirely in memory.
It accepts no database discovery callback and has no fallback or retry path.
Stream preparation, gap handling, visit scoring and explicit incomplete statuses
reuse the existing matcher. The benchmark pins peak tolerances to **72 m / 72 m**;
the persisted server matcher and debug defaults use the same 72/72 policy.

Local discovery is versioned separately as `local-spherical-corridor-v1`.
Coverage requires each continuous section and its discovery corridor to lie
inside the published region, clear of exterior boundaries and holes. Great-circle
distances use a mean-earth sphere, with 2% + 2 m boundary clearance slack.
Candidate discovery admits 1% + 1 m distance slack; the actual visit scorer is
unchanged. These are explicit local discovery rules, not a bit-for-bit replacement
for PostGIS's projected buffer near catalogue borders. Recording gaps are never
joined. The index handles poles and longitude wrapping without a special fallback.

Run a clean local pass against stored activities in the local development DB:

```sh
pnpm benchmark:place-matching --athlete <your-athlete-id>
```

Add `--limit 120` for an evenly sampled subset. `--compare` runs an independent
database baseline first and requires identical complete API responses for the
same stream generations/revisions, including zero visits, repeated visit positions
and incomplete statuses. This baseline is a development check, never part of local
matching. Aggregate timings, policy/version identifiers and status counts go to
`output/quality/batch-places/benchmark.json` (override with `--out`). No matches are
persisted and no Strava calls or background jobs are triggered. The benchmark
remains read-only; the background worker below persists results using the same
local engine.

On 2026-10-24, a local M4 Pro comparison over **4,602 current stored activities**
and **80,366 places**, using two concurrent activity readers and 72/72 peak tolerances, verified
identical API results for every activity. The database pass took **305.8 s**;
the all-local pass took **76.2 s**, plus **0.43 s** to load/index the catalogue
(**4.0× faster** overall). Application CPU fell from 76.3 s to 45.5 s; this excludes
database CPU. Both returned 3,719 complete, 824 uncovered and 59 partial results.
The measurement includes stored stream reads and serialization, but no result
writes or scheduling overhead. Comparison artifacts are under
`output/quality/batch-places/local-full.json`. Coverage at arbitrary future border
cases may differ under the separately versioned local rule described above.

The final standalone command (without a database comparison pass in the same
process) took **39.4 s**, plus **0.45 s** to load/index the catalogue, used **26.9
application CPU seconds**, and peaked at **599 MiB process RSS**. It produced
3,484 activity–place pairs / 3,792 visits across 1,731 activities, with the same
complete/uncovered/partial counts. See
`output/quality/batch-places/local-only-full.json`. This separate measurement
includes stream reads and full application memory, not just the place index;
timings vary with process/DB warmth and allocation pressure.

The regional worker comparison subsequently verified all 4,602 current persisted
results without writing checks or leases: 215 bounded groups loaded **28,960 place
rows total**, averaging 135 places per group (maximum 967). This is **96.4% fewer
rows** than ten full-catalogue loads at the previous 500-activity batch size.
Serialized minimal matching fields totalled 5.46 MB; this is an estimate, not wire
protocol bytes. The comparison took 56.5 s including stream reads and full-result
assertions, using 37.3 CPU seconds and 441 MiB peak RSS. A separate matched single
activity loaded **12 places** in a 0.10 s run instead of 80,366 places. No scoring
or recipe version changed because the loaded subset preserves every candidate.

Reproduce with `pnpm benchmark:regional-place-matching --athlete <id>`; optional
`--limit` evenly samples the current checks, and `--activity <id>` tests one
activity. It refuses remote databases and requires current persisted checks as
its baseline. Results are under `output/quality/batch-places/regional-full.json`
and `regional-single.json`. The full-catalogue benchmark remains available for
explicit broad-rebuild comparisons.

## Persistent checks, versions and invalidation

`activity_place_checks` stores one private read model per activity and recipe,
including complete zero-visit checks, uncovered routes, partial checks and current
streams without usable GPS. A check is current only when all these inputs match:

- stream generation, revision and source fingerprint;
- active catalogue snapshot and the database catalogue revision;
- `MATCHER_VERSION`, `BATCH_DISCOVERY_VERSION`, result-format version and the
  deterministic hash of the calibrated server policy.

Increment `MATCHER_VERSION` for scoring/track-interpretation changes,
`BATCH_DISCOVERY_VERSION` for local geometry/discovery changes, and the result
format in `matching-version.ts` for read-model changes. Settings changes alter
the recipe hash automatically. Recipes coexist during rolling deployments so an
old worker cannot overwrite a new algorithm's result.

Stream/source changes make only that activity stale. Statement-level database
triggers advance `place_catalogue_revision` for writes to `places` or
`place_catalogues`, including direct edits, insertions, retirement and truncation.
A publication's multiple writes are visible atomically as one new revision to
readers; publishing the identical artifact performs no writes and invalidates
nothing. Catalogue changes conservatively invalidate every check. No enormous
update/delete of cached rows or geographic invalidation queue is required.
New and removed places must be published with their updated manifest count;
matching fails closed if the loaded catalogue disagrees with its manifest.

`POST /api/cron/match-activity-places` runs every five minutes after the webhook
drain, independently of whether that drain succeeds. It requires the existing
production/external-effects guards and `CRON_SECRET`. A run takes an expiring
120-second global lease, processes at most 500 stale activities by default (maximum
2,000), and stops starting work at a 40-second deadline. It reads a bounded
metadata pool four times the work limit (2,000 by default) in the existing
freshness order: unchecked first, then oldest checks, with descending activity ID
breaking ties. Each group starts with the first remaining candidate, then takes
the nearest routes from that pool using summary-bounds centres, falling back to
start coordinates. This also chooses the actual 500 spatially from the larger
pool. Location hints affect scheduling only; the stored GPS still defines the
complete place query and matching inputs.

Groups fill to 25 activities where memory budgets allow, including distant
neighbours in sparse regions to avoid singleton queries. They can grow to 500
when additional route centres are within 25 km of the fixed seed. Missing or
invalid hints remain eligible for the smaller groups, but cannot justify
geographic growth beyond 25 activities. A default cron run can therefore share
one place pull across all 500 activities when the geographic and track-size
budgets allow it. Each stored track is loaded separately, and each
group also stops growing at
100,000 original GPS samples or 1,000 continuous sections (the last activity can
cross the sample/section targets). Raw payloads are released after preparation;
the prepared tracks are reused for matching.
Group preparation also stops after five seconds or half the remaining run
budget, whichever is smaller, so slow input reads leave time to checkpoint work.
Separate boxes for continuous
sections are padded by the discovery radius, its 1% + 1 m discovery slack and
another 2 m margin. Longitude-wrap boxes are split, and poles are handled
conservatively. One spatial query loads the distinct places intersecting that
group's boxes, using the partial GiST index on `location::geometry`. It never
builds a single rectangle between distant routes, nor retries with a full
catalogue. A scoped snapshot rejects tracks outside its loaded windows. Empty
cycles never load the catalogue. The check itself is the
checkpoint, so interrupted runs resume from remaining stale rows. Failures record
only a safe code and back off five minutes; changed inputs bypass old backoff.
Partial results remain explicitly partial until inputs or recipe change.

A read-only local comparison on 24 October 2026 checked all 4,602 persisted
reference results against the 80,366-place catalogue. Every result was identical:

| Measurement                 | Sequential groups of 25 | Spatial groups up to 500 |
| --------------------------- | ----------------------: | -----------------------: |
| Place rows transferred      |                  28,960 |                   17,147 |
| Minimal matching JSON bytes |               5,458,077 |                3,243,890 |
| Place-data queries          |                     215 |                      192 |
| Wall time                   |                 58.20 s |                  57.38 s |
| Peak process RSS            |              437.36 MiB |               476.66 MiB |

Spatial grouping reduced place transfers by 40.8%. Track-size budgets limited
the largest group in this dataset to 97 activities; a regression test verifies
that 500 nearby short tracks share one place pull. The runtime and memory
figures are single-process local
measurements, not production throughput estimates; the comparison replaces
lease/check writes with result assertions. `benchmark:regional-place-matching`
now also reports distinct places, repeated place rows across groups and group
activity counts. It verifies every result and retires committed IDs explicitly,
so spatially reordered work cannot skip or duplicate activities.

Each commit locks and rechecks the lease, catalogue revision, active snapshot,
eligible account, activity and exact current stream before atomically replacing
its check. Work computed before publication, erasure, revocation, deletion or
stream replacement cannot become current. Foreign keys cascade check deletion
with both the activity and its owner. No raw GPS or credentials enter stored
read models or job logs.

Migrations: `0026_activity-place-checks` and the spatial index in
`0027_regional-place-queries`. Apply before deploying readers/workers,
then deploy the updated application and Cloudflare Worker schedule. No additional
environment variable is required. Run local catch-up with
`pnpm places:match-local --batches 20`; this command refuses remote databases.
`pnpm db:test-place-matching` exercises the real Neon/Drizzle path on a guarded
local `*_test` database, covering zeroes, local/global invalidation, no-op
publication, concurrent stale commits/reads, recipes, leases, backoff and cascades.
The browser proof additionally covers a catalogue change without a stream change
and pending-to-complete refresh.

## Synchronizing matched places to web and iOS

The existing v1 activity aggregate includes an optional `placeMatches` bundle:
status, stream identity, global `matchingVersion`, per-check `resultRevision`, and
matched place metadata/visits. It carries no raw GPS or matching evidence. Clients
receive only places referenced by their own activities, not the whole catalogue.

Both `/api/v1/sync/bootstrap` and `/api/v1/sync/changes` attach these bundles using
one bounded result lookup per page (plus the manifest lookup), in a repeatable-read
snapshot. They never run matching or load track payloads. Every sync response,
including photo pages and empty delta pages, includes
`freshness.placeMatchingVersion`. A result is attached only if its stored check
agrees with the current recipe, catalogue revision and activity streams; otherwise
its replacement bundle reports pending/missing streams with no visits.

The matching worker records an ordinary activity upsert in `sync_change` in the
same transaction as its check. This deliberately reuses the existing activity
aggregate rather than adding an entity type older apps cannot decode. An insert
failure rolls back both. The changes repository serializes sequence allocation
through commit with an athlete-scoped advisory lock: a concurrent later writer
cannot commit a higher sequence and make clients skip an earlier uncommitted one.
Timestamps remain diagnostic metadata, not sync cursors.

Clients commit the entire activity/bundle and their cursor together, using
IndexedDB on web and SwiftData on iOS. A refreshed bundle replaces all previous
visits for that activity, including an empty completed list. Activity deletion,
account clearing and authoritative snapshot replacement remove bundles with their
parent activity. A new global matching version hides old bundles immediately
when observed, even if that delta page has no changes; fresh results arrive as
background matching completes. Result IDs are equality tokens, not ordering keys.

An existing cache from before this extension performs one staged bootstrap when
it first receives the new manifest field. Failure leaves its completed offline
library and cursor intact. Older apps ignore the additive fields. New clients can
still decode responses from an older server that omits them.

Web map/profile observers read synchronized bundles and share a 30-second/focus
catch-up through the existing serialized library writer. Current synchronized
results render offline without per-activity requests. The direct places endpoint
remains a fallback for pending results or a cache that has not upgraded yet.
The iOS loader likewise prefers synchronized bundles and observes committed
activity/global invalidations. Pending direct responses poll every three seconds;
completed synchronized results do not depend on the former daily revalidation.

Verification includes browser IndexedDB transaction failure/rollback, zero-result
replacement, account isolation, global invalidation on empty pages and deletion;
native tests exercise offline rendering, late-response fencing, failed save and
one-time upgrade; database proofs exercise atomic check/feed commits, concurrent
sequence ordering, scoped reads and manifest invalidation. No additional migration
or environment variable is required for the sync extension beyond migrations
0026/0027 already needed by matching.

## Account-scoped matching debug mode

Debug access uses the existing server-side `ACTIVITYMAP_ADMIN_ATHLETE_IDS`
allowlist, exactly like the admin panel. No additional environment variable is
needed. An unset or empty admin allowlist denies everyone. The Settings toggle
is off by default, including for admins.

Allowlisted accounts see **Place matching debug mode** under **Settings →
Display**. Its toggle is session-only and resets when the signed-in account or
connection changes. Enable it, select activities on the map, then choose one
activity in the debug panel. The panel previews discovery, encounter entry/exit,
peak/pass/hut distances and peak elevation tolerance. Apply runs an experiment;
Reset restores defaults. The production map matches and elevation profile use
the calibrated 72/72 server policy outside the debug overlay. Experiments never write matches,
change server policy, fetch Strava or trigger matching jobs.

Teal markers indicate experimental matches, amber rejected places and grey
uncertain evidence. Click a marker or a candidate in the accessible list to see
its closest valid-route distance, elevation difference, default match status and
rejection reasons. Gained/lost counts compare against the default matcher on the
same stored track and catalogue snapshot. Candidate discovery includes at least
the default 300 m corridor, so shrinking discovery retains the baseline candidates
with an explicit outside-discovery explanation. This also means coverage is
checked for at least 300 m. Places outside the encounter entry radius remain
visible and measured. Recording gaps are never bridged.

`GET /api/debug/places` reports only the authenticated caller's capability.
`POST /api/activities/{id}/places/debug` validates the existing admin allowlist
before matching, validates bounded settings, and reuses the normal read-only
snapshot and ownership/revocation/stream-replacement fence. Responses are private
and never HTTP cached. Browser queries are account, session, activity, stream and
settings scoped, cancellable and discarded when inactive. Fixed sample,
candidate and comparison budgets cannot be raised by clients. Coverage failures
and partial checks are labelled explicitly; incomplete results are never reported
as conclusive rejections. Debug closest-point measurements have an additional
fixed comparison budget. Their elevation difference describes the closest valid
point; repeated encounter decisions still come from the complete matcher.

Verification: `pnpm test:place-debug-ui` exercises the actual settings toggle and
map components on desktop and phone, including threshold application, validation,
rejection details, incomplete results, errors, access denial and account changes.
It runs in CI and saves screenshots under `output/quality/browser/place-debug`.
The existing `pnpm db:test-on-demand-places` also checks the debug handler against
a guarded local test database, including no writes and concurrent input or
ownership changes.
