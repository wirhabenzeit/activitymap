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

## Searching the personal place library

Web and iOS build a local place index from the current activity bundles already
delivered by library sync. Search does not download the catalogue, call a matching
endpoint, or fetch one result per activity. The web projection and native
`PlaceLibrary.currentResult` check account/activity identity, matching version and
stream generation/revision before exposing memberships. A changed global version
also invalidates the native projection when activity payloads themselves have not
changed. Completed empty replacements and deletions remove previous memberships.

Typing in the activity filter remains activity-name search. Choosing a labelled
place suggestion consumes that query and creates one explicit Place chip;
subsequent text is an independent AND constraint. Removing the chip preserves
text and other filters; Clear filters removes it. Stats applies the same place
predicate while retaining earlier history for its own reporting/comparison
periods. Suggestions always cover known visits across all dates and sports,
including when other filters currently yield no activities.

On web, text entry remains urgent while activity projections and autocomplete
use deferred search values. The browsing query retains its identity during the
urgent pass so it does not cause a context-wide results render on each key.
Other filters and clearing search remain immediate. Deferred suggestions cannot
be selected while they belong to an older query. Normalized place names are
cached when the synced place index changes, rather than rebuilt while typing.

The index exposes stable place identities, related activity IDs, distinct-activity
counts, first/latest known activity-local visit dates and separate matching-status
counts. Repeated encounters do not inflate membership counts; they remain intact
in the route/profile bundles. Multi-kind memberships retain all kinds. Callers can
build an index over a filtered activity scope using the shared activity predicate;
they must retain the source library's completeness rather than infer completeness
from positive memberships alone. Suggestions are paged/bounded and distinguish
identically named places with kind and elevation. Current sync bundles
contain display names only, so alternate-name search awaits a future additive
metadata change; this slice changes no server contract or database schema.

The compact place detail uses the all-date/all-sport index.
Opening it does not change selection or camera; Show activities / Show on map are
explicit filter/navigation actions and preserve the existing other activity
constraints. Account changes hide old details and clear the place constraint.
Web persists only the account-scoped filter identity/name with existing UI
preferences; native keeps it in memory like its other ordinary filters. Offline
reads use the existing authorized cached library. Unknown/pending, missing GPS,
uncovered and incomplete results remain distinct internally; the search and detail
UI omit coverage caveats and scope captions.

`effectiveActivityPlaces` / `PlaceLibrary.effectivePlaces` are the common
membership boundary for future personal include/exclude overrides (#463). This
delivery does not implement correction writes or fabricate manual encounter
positions.

Verification: `shared/place-library-fixtures.v1.json` supplies cross-client
counts, freshness and filter cases; `pnpm test:place-search-ui` checks production
web controls with synthetic activities, including keyboard selection, restored
filters, comparison history, completed-zero replacement, account changes and zero
API requests. `PlaceLibraryTests` and `PlaceSearchUITests` cover the native model
and the real filter/detail interaction and are registered in the native harness.

## Request and data flow

Backend jobs own all matching. The periodic worker discovers new, changed and
stale activities from stored streams without anyone opening them, and library
sync publishes each result to web and iOS. Opening, selecting or re-rendering a
route never starts matching or requests places.

`GET /api/activities/{id}/places` is a read-only compatibility route for shipped
clients that predate sync-only places. It resolves the authenticated actor and
reads the persisted private result for the current stream and matching version.
It never fetches Strava and never schedules computation: a stale or unprocessed
result reads as an explicit `pending` response until the scheduled matcher reaches
it. Current web and iOS builds no longer call it; remove the route once supported
iOS builds all read synchronized bundles.
The combined Switzerland/Austria/Italy catalogue is preferred; Swiss-only local
catalogues remain supported.

A private read checks ownership, connection, revocation and erasure eligibility.
It compares stream generation/revision/source fingerprint, catalogue snapshot and
revision, and algorithm/discovery/settings recipe. A second read outside its
snapshot fences concurrent deletion, revocation, stream replacement or catalogue
publication. A check completing for unchanged inputs may safely leave one final
pending response. HTTP responses are private/no-store.

Clients take the matching version from the sync manifest. It follows the
catalogue revision and matching recipe, so catalogue and algorithm updates hide
even completed zero-match results until their replacement arrives, without a
stream change. Other account caches are never reused. The web library syncs on
open, when the page becomes visible, when it reconnects and every two minutes
while visible; iOS syncs every minute while active.

Hydration, pending, unavailable, missing-GPS, partial and uncovered states each
have their own fixed-height chart-header status, and selected routes awaiting a
result show a compact map pill. Pending never reads as a completed empty result.
None of these states add rows to the card. The themed map card shows the place name, kind and
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

`POST /api/cron/match-activity-places` runs every fifteen minutes at :02, :17,
:32 and :47, independently of the five-minute webhook drain. The two-minute
offset normally lets that drain finish first. It requires the existing
production/external-effects guards and `CRON_SECRET`. A run takes an expiring
120-second global lease, processes at most 500 stale activities by default (maximum
2,000), and stops starting work at a 40-second deadline. It reads a bounded
metadata pool four times the work limit (2,000 by default) in the existing
freshness order: unchecked first, then oldest checks, with descending activity ID
breaking ties. Each group starts with the first remaining candidate, then takes
the nearest routes from that pool using summary-bounds centres, falling back to
start coordinates. This also chooses the actual 500 spatially from the larger
pool. Candidates come from an indexed pending-work table rather than scanning
all activities. Location hints affect scheduling only; the stored GPS still defines the
complete place query and matching inputs.

Groups fill to 25 activities where memory budgets allow, including distant
neighbours in sparse regions to avoid singleton queries. They can grow to 500
when additional route centres are within 25 km of the fixed seed. Missing or
invalid hints remain eligible for the smaller groups, but cannot justify
geographic growth beyond 25 activities. A default cron run can therefore share
one place pull across all 500 activities when the geographic and track-size
budgets allow it. Input reads use a bulk sample-count query followed by one
bulk GPS-payload query for the prefix that fits the sample budget. Counts for
deferred tracks are reused within the run, keyed by exact input identity;
payload reads always recheck authorization and current stream identity. Each
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
checkpoint, so interrupted runs resume from remaining pending rows. Successful
commits retire pending work atomically with the check and sync event; failures
retain it at the retry time. Stream identity changes enqueue only the affected
activity; unavailable/deleted streams remove it until fresh streams arrive.
Account reconnection restores eligible work, and catalogue/recipe changes seed
all stale work once via a version checkpoint. Current results queued by a
reconnection are retired using cheap version metadata. Failures record
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

Each group commits all computed checks with one multi-row upsert and one bulk
sync-feed insert in the same transaction. Feed locks for all affected athletes
are acquired in deterministic order in one SQL statement. Each commit locks and
rechecks the lease, catalogue revision, active snapshot, eligible accounts,
activities and exact current streams. Stale rows are excluded without losing
valid neighbours; a changed global lease or catalogue fences the entire batch.
Already computed results are flushed even when the work deadline is reached.
Work computed before publication, erasure, revocation, deletion or
stream replacement cannot become current. Foreign keys cascade check deletion
with both the activity and its owner. No raw GPS or credentials enter stored
read models or job logs.

A separate local write-path benchmark on 24 October 2026 measured the same 500
activities against an isolated snapshot, using the Neon/Drizzle WebSocket driver
and real transactions, freshness locks, upserts and sync-feed inserts:

| Measurement      | Per-activity I/O |   Bulk I/O |
| ---------------- | ---------------: | ---------: |
| SQL statements   |            7,076 |        254 |
| Wall time        |          17.60 s |     2.90 s |
| Application CPU  |           5.19 s |     1.83 s |
| Peak process RSS |       332.78 MiB | 383.08 MiB |

Both runs persisted identical results and exactly 500 sync events, using 12
place loads totalling 595 rows. The bulk run used 12 input batches and 12 commit
batches. This is about 6 times faster locally with 96.4% fewer SQL statements;
network latency and hardware differ in production. The larger bounded reads
increase peak memory in this measurement. All 4,602 reference results also passed
the read-only comparison. Job metrics now separate input reads, place loads,
matching/preparation and commits (`inputReadMs`, `catalogueLoadMs`, `matchingMs`,
`commitMs`), plus `inputBatches` and `commitBatches`.

Reproduce actual writes with `pnpm benchmark:place-matching-io --mode after`.
This command requires an **isolated local snapshot** with settled reference
checks: it deletes the selected checks, recreates them and appends sync events.
It refuses non-local databases, names not ending in `_test`, or missing explicit
`MIGRATION_DATABASE_URL`, `MIGRATION_EXPECTED_HOST`,
`MIGRATION_EXPECTED_DATABASE`, `MIGRATION_REQUIRE_TARGET_GUARDS=true` guards.
Use `--limit` (default 500) and `--out` to select workload and report path.

For `--mode before`, create the historical worker/repository copies from the
reviewed pre-change ref first (reports and these copies stay under ignored
`output/quality/`):

```sh
python3 - <<'PY'
from pathlib import Path
from subprocess import check_output
root = Path('output/quality/batch-io-before')
root.mkdir(parents=True, exist_ok=True)
for kind, name in [('application', 'worker'), ('repositories', 'repository')]:
    text = check_output(['git', 'show', f'980d455a:src/server/{kind}/place-matching.ts'], text=True)
    for module in ['changes', 'place-matching-input']:
        text = text.replace(f"'./{module}'", f"'~/server/repositories/{module}'")
    for module in ['batch-activity-places', 'match-activity-places']:
        text = text.replace(f"'./{module}'", f"'~/server/application/{module}'")
    text = text.replace("'~/server/repositories/place-matching'", "'./repository'")
    (root / f'{name}.ts').write_text(text)
PY
```

Migrations `0026_activity-place-checks` and `0027_regional-place-queries` must
already be applied before deploying readers/workers. Roll out the additive
`0028_pending-place-matching` migration as described below, then deploy the
Cloudflare Worker schedule. No additional
environment variable is required. Run local catch-up with
`pnpm places:match-local --batches 20`; this command refuses remote databases.
`pnpm db:test-place-matching` exercises the real Neon/Drizzle path on a guarded
local `*_test` database, covering bounded bulk reads, cached-size authorization,
partial stale batches, atomic multi-owner check/feed rollback, zeroes,
local/global invalidation, no-op publication, concurrent stale commits/reads,
recipes, leases, backoff and cascades.
The browser proof additionally covers a catalogue change without a stream change
and pending-to-complete refresh.

Migration 0028 is additive and compatible with older workers. During rollout,
new workers detect whether both queue tables exist and keep the previous scan
until the migration is applied. Deploy the application, apply the guarded
production migration, then deploy the Cloudflare schedule and confirm a live
cycle. Both database triggers and the queue acknowledgement are transactionally
coupled to their corresponding stream/check writes. Deletion cascades remove
pending rows. No raw GPS or results are copied into the queue.

An idle comparison on the same settled 4,602-activity local snapshot measured
three previous full-scan cycles at 3,008 / 2,920 / 2,860 ms, versus 98 ms for
queue initialization and 21 / 19 ms thereafter. Both ran actual leases and
published no sync events. Production latency differs. Reproduce with
`pnpm benchmark:place-matching-io --idle --mode after --out <report>` on an
isolated guarded local `*_test` snapshot; `--mode before` uses the historical
copies described above (the pre-queue ref is `ab386071`). The database proof
also replaces the source-hash function with a throwing implementation during
an idle run, proving that settled activities are never hashed.

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

Web map/profile observers read synchronized bundles only, and updates arrive
through the ordinary library sync. Current synchronized results render offline
without per-activity requests. The iOS loader likewise reads synchronized bundles
from SwiftData and rereads demanded routes when committed activity or global
invalidations are observed. Neither client calls the direct places endpoint.
Native direct-response rows from older builds are no longer read and are deleted
as sync touches their activities.

Verification includes browser IndexedDB transaction failure/rollback, zero-result
replacement, account isolation, global invalidation on empty pages and deletion;
native tests exercise offline rendering, pending-to-complete delivery, failed save
and one-time upgrade; database proofs exercise atomic check/feed commits, concurrent
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
