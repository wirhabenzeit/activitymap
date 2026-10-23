# Activity places: local development

The activity-places experiment uses the existing local development database,
`main` on port `5432`, so the frozen Swiss catalogue and inferred visits sit beside
the activities and stored streams already used by the application. Manual import
and matching use a guarded direct connection and do not require a running web
application. No activity copying or separate feature database is needed.

This slice and its migration remain local work. Do not deploy this branch to
Preview or Production until deciding to proceed with the feature.

## Prepare the existing development database

Back up `main` before changing the database image or applying the new migration.
Choose a fresh backup filename and keep the dump private under ignored `output/`:

```bash
umask 077
mkdir -p output/places/local-backups
places_backup_dir=$(mktemp -d output/places/local-backups/main-before-places-XXXXXXXX)
docker compose exec -T postgres pg_dump -U postgres -d main --format=custom \
  > "$places_backup_dir/main.dump"
```

The development Compose PostgreSQL image installs PostGIS binaries for PostgreSQL
17 on the host architecture. Rebuild/recreate the service while preserving the
existing `db_data` volume; do not remove the volume or initialize a replacement
database:

```bash
docker compose up --build -d --wait postgres neon-proxy
```

The image installs binaries only. The checked-in additive migration creates the
extension and new tables through the normal migration history. It does not reset
existing activities, accounts or streams. For a fresh database, leaving extension
creation to the migration also keeps the empty-database baseline valid.

Configure the explicit development target in the terminal used for migrations,
catalogue import and matching:

```bash
export MIGRATION_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/main
export MIGRATION_EXPECTED_HOST=127.0.0.1
export MIGRATION_EXPECTED_DATABASE=main
export MIGRATION_REQUIRE_TARGET_GUARDS=true

pnpm db:migrations:check
pnpm db:migrate
pnpm db:migrate:check
```

Keep these target settings in the shell; the existing application connection and
`.env` do not need to change. Migration reset fixtures and synthetic database proof
commands belong in a disposable `_test` database, as described below; do not run
them against `main`.

## Export and import the frozen Swiss catalogue

The offline exporter reads the already downloaded 20 October 2026 PBF and its
selection/geometry audits. It verifies the pinned PBF hash and the audit inputs,
recomputes naming/category/elevation rules, and publishes a new artifact directory:

```bash
pnpm places:export \
  --source output/osm-catalog/switzerland-2026-10-20 \
  --out output/places/switzerland-2026-10-20

pnpm places:import --artifact output/places/switzerland-2026-10-20 --dry-run
pnpm places:import --artifact output/places/switzerland-2026-10-20 --apply
```

Use the guarded local target exported above. The importer defaults to dry-run,
never loads `.env`, and rejects remote targets, missing guards and URL query
parameters that could override the driver host/database/search path. It does not
apply migrations. The exporter refuses an existing output directory; choose a
fresh one when regenerating rather than overwriting the evidence.

The artifact contains canonical `places.jsonl`, `coverage.geojson` and a
manifest published last. The manifest binds source/PBF/geometry/coverage hashes,
selectors, normalization and Node/ICU versions, expected counts and OSM/ODbL
attribution. Node/ICU versions are recorded because recognition of language-name
keys depends on the bundled language registry. Unrecognized names remain in raw
tags but cannot qualify an otherwise unnamed place. There are no source-ID naming
exceptions. Counts are 8,011 peaks, 2,393 saddles, 826 road/trail passes, 632 alpine
huts and 219 wilderness huts; 756 saddle/pass overlaps produce a union of 11,325.
The set includes 523 polygon-derived hut points and six language-only names.

Coverage preserves the downloaded provider polygon and its hash. It is not a
claim of an exact historical extract boundary or of completeness beyond it.
Complete crossing features may lie outside the polygon. The later matcher must
assess coverage of an activity's entire discovery corridor.

Before opening the database transaction, the importer validates every row,
category count, checksum and point. A transaction-scoped advisory lock plus table
write lock serializes publication; readers see the previously committed catalogue
until all insert batches commit. It never updates, truncates or deletes places.
An identical rerun reports `unchanged` and preserves IDs/import times. Different
snapshots, missing/extra rows or conflicting contents are refused, including in
dry-run mode. This command deliberately does not repair a partial/manual catalogue.

After applying the migration, inspect the installed extension:

```bash
docker compose exec -T postgres \
  psql -U postgres -d main -c 'SELECT postgis_full_version();'
```

## Optional disposable databases for proofs

The standalone `docker-compose.places.yml` stack is for synthetic database proofs
and destructive migration replay fixtures. It is not the normal development or
real-activity evaluation target. It has a separate `activitymap-places-poc`
Compose project, `places_db_data` volume and loopback-only port `55432`:

```bash
docker compose -f docker-compose.places.yml up --build -d --wait

# Use a separate terminal so normal development commands still target main.
export MIGRATION_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/activitymap_places_test
export MIGRATION_EXPECTED_HOST=127.0.0.1
export MIGRATION_EXPECTED_DATABASE=activitymap_places_test
export MIGRATION_REQUIRE_TARGET_GUARDS=true

pnpm db:migrate
pnpm db:test-activity-places
pnpm db:test-place-catalogue
pnpm db:test-place-matching
```

The `_test` suffix is required by proof guards. Catalogue and matching proofs use
unique scratch schemas, clean up their own fixtures, and preserve public tables.
Historical `db:migrate:test-*` upgrade fixtures reset their target database, so
that database must be disposable even if other proofs preserve it. Do not copy
the development account or private activities into this stack for normal matching.
To stop it while retaining its test volume, use
`docker compose -f docker-compose.places.yml down`.

CI uses the same package-installation script with a PostgreSQL 17 service. Its
`activitymap_test` database starts empty, then the complete migration history and
activity-places database proofs run in the migration job. No extension is installed
into `template1`, and no migration baseline exemption is needed.

## Development database integration status, 22 October 2026

Integration into the existing development database is complete. The PostgreSQL
service now runs PostgreSQL 17.11 with PostGIS 3.6.4 on its original
`activitymap_db_data` volume. Both pending additive migrations, `0022` and `0023`,
were applied through the checked migration runner; all 24 migrations are current.
The Swiss import inserted 11,325 places, and an identical second import reported
`unchanged`.

All 4,578 activity rows and 100 stream rows have identical ordered JSON-content
digests before and after the change. Of these streams, 78 have current GPS data
with time and altitude channels. A private, readable custom-format backup and
before/after digests are retained under
`output/places/backups/main-before-places-2026-10-22-p6pobd3f/`.

The pre-existing libc collation-version mismatch in `main` was repaired by
rebuilding its indexes before refreshing its recorded collation version. The
application's actual Neon WebSocket/Drizzle connection through the local proxy
successfully reads the same activities, streams and places from `main`; `.env`
still uses its original local target. No production connection or migration was
used. The extra isolated test container is stopped, with its test volume retained.

At this checkpoint no real activity matching had been published (`activity_places` was empty).
The existing local streams are ready for scoped evaluation; their presence does
not establish matcher accuracy or complete Swiss coverage.

## Historical isolated schema verification, 22 October 2026

The migration was replayed on an isolated native PostgreSQL 17.11 / PostGIS 3.5.6
database, including the existing webhook, geometry-state and stream-lifecycle
upgrade fixtures. All 24 migrations apply; a second apply is a no-op and the
schema fingerprint command succeeds. Migration journal and generation drift
checks also pass. Historical migration files and the baseline manifest are
unchanged.

`db:test-activity-places` passes through the Neon WebSocket/Drizzle driver. It
checks exact bigint IDs and geography coordinates, JSON evidence round trips,
constraints, source/relation uniqueness, spatial and reverse indexes, and account
erasure. Synthetic data is rolled back. Detailed JSON evidence validation is in
the runtime contract; SQL validates the outer shape and basic invariants. Future
writers must use the shared validated builder/parser.

All 1,079 repository unit tests pass, including 16 geography/evidence tests.
Scoped ESLint passes. Full typecheck currently fails on three existing errors in
`scripts/prototypes/activity-names/holdout-report.ts` (lines 91 and 174), outside
this slice. The initial validation used native Postgres while Docker was
unresponsive; the subsequent container/import verification is recorded below.
No cloud database or deployment was used.

Drizzle Kit currently quotes the custom geography type as a single identifier
when generating its first column. The new migration explicitly uses valid
`geography(Point,4326)` SQL; inspect future generated changes involving this type.

## Historical isolated Swiss import verification, 22 October 2026

The standalone image built successfully for ARM64 and started PostgreSQL 17.11
with PostGIS 3.6.4. All 24 migrations applied to its fresh database. The offline
export produced a 6,436,400-byte canonical catalogue with SHA-256
`00e31db20fa347b8ab86eb213503d19bf52c2e285e5445f39df93236cba248dd`.
Its manifest and coverage are retained under
`output/places/switzerland-2026-10-20/` (ignored by Git).

Dry-run reported `would_import`; application inserted all 11,325 objects; an
identical second application reported `unchanged`. Every source field/raw tag was
compared on rerun, and a separate digest of all IDs/import timestamps was identical
before and after. Database counts match every expected category, source type,
523 derived points and 756 saddle/pass overlaps. All point geometries are valid;
52,799 original tag pairs are stored. `places`, including its indexes/TOAST, uses
6,971,392 bytes (about 6.65 MiB). `activity_places` remains empty until the matcher
slice. The detailed database check is saved as `database-verification.json`
alongside the artifact.

The synthetic database proof passed validation/dry-run checks, stable
IDs/timestamps, conflicting rows/snapshots, injected late-failure rollback,
concurrent first publication and reader isolation. All 1,112 repository unit tests
pass, with scoped lint and formatting checks passing. The three unrelated
typecheck errors above remain. CI configuration includes the synthetic proof;
remote CI has not been run.

## Match stored activities manually

The local matcher uses raw, fetched, non-invalidated streams already present in
this database. It does not fetch from Strava, use activity titles, or accept the
display polyline as a substitute. Use the existing local `main` database with its
stored activities, accounts and streams after the additive migration and catalogue
import. Select owned activities for evaluation there; no account/stream copy into
a feature-specific database is part of this workflow.

Use the same explicit local connection guards as the importer. Supply the local
user ID, athlete ID and each activity ID, keeping IDs as decimal strings:

```bash
pnpm places:match \
  --catalogue output/places/switzerland-2026-10-20 \
  --out output/places/runs/my-first-dry-run \
  --user '<local-user-id>' --athlete '<athlete-id>' \
  --activity '<activity-id>' --activity '<another-activity-id>' \
  --policy activity-places-matcher-v4 --dry-run
```

Dry-run is the default. To publish, run again with `--apply` and a new output
directory. The scope is limited to 100 activities per run. Ownership and eligible
Strava account checks still apply in the local database. A dedicated direct
session holds an athlete advisory lock for the whole run; simultaneous runs for
the same athlete are refused. Matching does not change stream fetch leases.

Outputs contain private route evidence. The command creates a private directory
and files, writes each activity's JSON and GeoJSON diagnostics before publication,
then durably replaces `manifest.json` after each activity. Keep these under
ignored `output/`. The manifest records the full frozen policy and its hash,
catalogue/coverage identity, exact activity scope and stream tokens, and explicit
outcomes, including complete zero matches. An interrupted run can have scoped
activities without records. Rerun those activities in a fresh directory; do not
infer their completion from existing relation rows.

Original GPS indices and between-sample fractions are retained. Full high
resolution sampling metadata is required to align auxiliary streams. Gaps split
the route. Recording time gaps remain informational: all recorded sections can
be completely evaluated even when unrecorded intervals exist. GPS discontinuities
exclude their affected segments without making the whole activity partial. Work
limits and unknown processing errors still block completion. Missing or unaligned
timing/elevation alone does not block a proximity visit.
The search checks the entire discovery corridor against catalogue coverage.

Only complete results can replace an activity's relations. Publication rechecks
ownership/account eligibility, authoritative activity source and stream
generation/revision under locks. Concurrent changes produce `superseded`.
Incomplete, uncovered and failed attempts retain previous rows and remain
explicitly incomplete in their manifest.

`src/server/places/queries.ts` exposes injected backend services for activity
places, activities visiting a place, and most-visited places. Supply a validated
`EvaluationContext` from `evaluationContextFromManifest`; services do not open
files or read raw samples. Results count distinct activities from the requested
successfully published scope, and report how much of that scope is current.
Old rows retained after a failed run do not count as results of the new run.
These explicit-run services are not wired to a public API. The local-only UI
below reads current positive memberships through a separate compact endpoint.

The starting policy is deliberately experimental: a 300 m discovery radius,
100/150 m encounter entry/exit radii, 35 m peak visits and 50 m pass/hut visits.
Peaks use an optional 100 m elevation tolerance when both elevations are known.
Saddles and road passes both emit `visited_pass`, with no angle/direction test;
hut support means vicinity. Thresholds and inferred visits still require review
on labelled real tracks. Synthetic fixtures establish implementation invariants,
not classification accuracy.

The optional matching proof above exercises the real repository path with
synthetic data in a disposable test database. No additional schema migration, OSM
update job, live API or production database change is part of this slice.

## Historical isolated matcher verification, 22 October 2026

The complete unit suite passes 1,139 tests. Scoped ESLint, formatting and diff
checks pass. Full typecheck still reports only the three pre-existing prototype
errors noted above.

`db:test-place-matching` passes against the isolated PostgreSQL 17/PostGIS
container. Its disposable schema exercises the real matcher, spatial repository,
publication and query services together: dry-run and apply, complete zero
matches, gaps and coverage holes/borders, candidate limits, original references,
ownership, local-date/sport filters, distinct-activity counts, stale source and
generation rejection, rollback after deletion of the previous set, account
revocation/deletion, and concurrent manual-run refusal. Public table counts are
unchanged by the proof.

The candidate query preserves a correlated spatial lookup for each section;
without that boundary PostgreSQL could flatten it into a catalogue scan. The
synthetic proof checks GiST availability. A separate read-only `EXPLAIN ANALYZE`
with normal planner settings on the actual 11,325-place catalogue selected
`places_location_idx` for an invented six-sample route near Rigi (300 m discovery
radius). Its execution took about 4.4 ms in that one local check; this is not a
long-activity performance benchmark.

At that verification checkpoint, the isolated public database contained 11,325
places and no activities, streams or activity-place relations. Real-track
precision/recall and threshold calibration remain unmeasured. The next evaluation
uses an explicitly selected subset of activities already in local `main`, with
human-reviewed visit labels.

## Full local library dry run, 22 October 2026

The refreshed existing development database `main` was evaluated against the
frozen Swiss catalogue without publishing relations. All 4,602 activities were
processed: 985 complete, 1,156 partial, 2,403 outside the full catalogue discovery
corridor, and 58 without usable stored GPS. There were no processing failures.
Before/after content fingerprints matched for activities, streams, places,
activity-place relations, users and accounts; `activity_places` remains empty.
Production was not accessed during this evaluation.

The current rules support 317 distinct activity/place pairs from complete
activities and 1,102 from partial activities, spanning 455 distinct places in
total. These are experimental detections, not manually verified visits. Partial
evidence is kept separate: 832 partial activities include gaps exceeding the
120-second continuity threshold. Uncovered activities are unassessed, not zero
visits. Hut support remains proximity to the representative point.

Private review artifacts are under ignored
`output/places/dry-run-2026-10-22/`: `run.json`, batch manifests, full compressed
per-activity reports, `results.jsonl`, `aggregate.json`, `activities.csv`,
`encounters.csv`, `place-visits.csv` and 18 selected cases in `review-cases.json`.
The one-off wrapper batches at most 100 activities, forbids publication, and
preserves completed reports when resuming. These files contain private activity
data and must remain outside version control.

The run exposed expensive geography containment and boundary-distance queries.
Coverage now checks one anchor per continuous section and boundary clearance
over overlapping 64-vertex pieces that preserve every original segment. A
connected section cannot leave coverage without crossing the boundary. The
original whole-section buffer check and candidate query remain unchanged.
All 467 reports produced with the original query returned identical coverage,
candidate sets and truncation flags with the optimized query. The expanded
spatial integration proof and three repository unit tests passed; concave
regions, holes, disconnected components and point sections are covered. No
matching thresholds or policy identities changed.

## Recording-pause grouping, 22 October 2026

Matcher `activity-places-matcher-v2` emits evidence version 2: each logical
encounter contains its continuous `fragments`, explicit unobserved `pauses`, and
assessments derived from the fragments. A time gap joins encounters when both
recorded endpoints are within the 100 m entry radius, the original samples are
adjacent and known provider distance does not advance more than 150 m during the
gap. Real exits/returns, invalid samples and non-time discontinuities stay
separate. Long summit rests and overnight hut stops have no pause-duration cap.
Geometry, distances and classifications remain confined to continuous fragments.
At this v2 checkpoint, grouping did not turn an activity with gaps into a
complete/publishable result; the subsequent v3 change below separates recording
pauses from processing blockers.
The existing JSONB column accepts this version without a database migration.
Old version-1 evidence must be recomputed before being read as version 2.

An offline replay of all 4,602 saved activity reports preserved every one of the
4,004 original evidence fragments exactly, now arranged into 3,657 encounters.
It joined 347 pauses across 266 activities: 255 at peaks, 73 at passes and 19 at
huts. Gravel Ticinese at Capanna Monte Bar changes from three fragments to two
encounters; Beautiful Ticino changes from two to one. Summit examples include
Foggenhorn and Grosser Mythen, each changing from two fragments to one encounter.
Supported relations, activity/place membership, outcomes and reasons are
unchanged. Boundary causes were reconstructed conservatively from saved sections;
this did not repeat spatial discovery or access any database or network.

The new private results and comparison summary are in ignored
`output/places/pause-grouping-2026-10-22/`; original dry-run reports are retained.
All 86 focused place/schema/application/repository unit tests and scoped ESLint
pass. Full typecheck still reports the same three pre-existing title-prototype
errors. No production migration or inferred-visit publication was performed.

## Historical v3: local evidence across recording pauses, 22 October 2026

Matcher `activity-places-matcher-v3` keeps `time_gap` as an informational
diagnostic. A recording pause still splits geometry and can link nearby encounter
fragments, but it no longer makes processing partial by itself. A supported
peak/saddle/hut encounter within a continuous fragment remains eligible to count.
Pass crossings still require continuous approach/departure evidence; isolated
samples stay uncertain. Other data errors, coverage failures and work limits
keep their existing blocking behavior. New/unknown reasons block by default.

`complete` now means all recorded sections were evaluated under this catalogue
and policy. A complete zero-match result means no supported visits were found in
the recorded evidence; it does not rule out visits during a recording gap. No
JSONB shape or database migration changes were needed (evidence version 2).

The offline v3 replay retained all evidence objects and all 347 pause joins
exactly. Only 669 activities whose sole blocker was `time_gap` changed from partial
to complete: 1,654 complete, 487 partial, 2,403 uncovered and 58 without usable GPS.
This makes 841 additional supported activity/place pairs eligible, raising the
eligible total from 317 to 1,158; 261 supported pairs remain in partial activities.
Capanna Monte Bar now has three eligible supported activities. Its fourth,
74 m nearby-only result remains unsupported.

Private results, summary and refreshed review are in ignored
`output/places/pause-local-evidence-2026-10-22/`. These are offline dry-run results;
neither development nor production databases were written. All 94 focused tests
and scoped ESLint pass. Full typecheck retains only the three previously noted
title-prototype errors.

## Simplified proximity visits (v4), 22 October 2026

The current matcher uses the proximity rules above. Missing elevation or timing
alone no longer makes a visit uncertain. Invalid samples/times, GPS jumps and
recording pauses remain local diagnostics; no geometry is interpolated through
them. Isolated samples and closest interpolation along segments over 100 m stay
uncertain. Processing limits and unknown errors still block publication.

Migration `0024_places-proximity-visits.sql` adds `visited_pass` to the relation
constraint, retaining legacy values. It was prepared but unapplied at this replay
checkpoint; the local publication below subsequently applied it. Production is
unchanged. Evidence stays version 2; matcher and parameter hashes change.

The offline replay processed all 4,602 saved activities against their original
full-resolution sections and frozen Swiss catalogue candidates. Discovery was
reused because all discovery, section-splitting and budget parameters are unchanged.
Every original geometric evidence field and all 347 pause joins were verified
unchanged: 4,004 recording fragments still form 3,657 logical encounters.

Results: 2,140 complete, one partial, 2,403 outside catalogue coverage and 58 without
usable GPS. Eligible supported activity/place pairs rise from 1,158 to 2,168
(+1,010), across 500 places. This includes 749 newly supported pairs and 261
previously supported pairs in activities that are now complete. Morning Ride's
Brünigpass visit is supported at 3.5 m; its unrelated GPS jump no longer blocks it.
Capanna Monte Bar still has three supported activities.

Private results, reproducible replay, summary, changes and review builder are in
ignored `output/places/simple-visits-2026-10-22/`. No database was accessed and no
visits were published. The 95 focused tests pass. Full typecheck still reports
only the three existing title-prototype errors in
`scripts/prototypes/activity-names/holdout-report.ts`.

## Local publication and UI, 22–23 October 2026

After the user reviewed and accepted v4, migration 0024 was applied to existing
local `main` through the guarded runner (25 migrations current). A private 258 MiB
custom-format backup, checked with `pg_restore --list`, is retained at
`output/places/local-backups/main-before-publication-ooDat27K/main.dump`.

The one-off publisher in `output/places/published-visits-2026-10-22/publish.ts`
verified the catalogue fingerprint against the original discovery run, checked
each current stream's generation/revision/source tokens, prepared its track
again, verified identical discovery geometry and recomputed all matching against
the frozen candidates. Every result had to equal the reviewed v4 evidence before
the normal guarded publication transaction committed it. Incomplete/uncovered
activities were excluded; cached spatial discovery was reused only after those
checks. Batch apply manifests retain completed zero-match outcomes too.

All 2,140 complete evaluations were published. `activity_places` contains 3,344
activity/place evidence rows, including 2,168 supported pairs across 500 places.
The remaining rows are nearby/uncertain evidence and are excluded from the UI.
The table including indexes and TOAST occupies 5,906,432 bytes (about 5.63 MiB).
Activities, streams, places, users and accounts had identical before/after
fingerprints. No production connection was used.

The development web UI now includes:

- **Map layers → Show visited places**, enabled initially and persisted as a UI
  preference. Points and popup activity counts use the same visible activity IDs
  as routes; highlighted activities emphasize their places. Place clicks do not
  select underlying routes.
- A compact **Visited places** list in the shared activity detail card, with
  category icons, mapped elevation when available, OSM links and attribution.
  Each activity/place appears once regardless of encounter count.

`GET /api/experimental/visited-places` requires authentication, scopes positive
memberships to the caller's eligible account and verifies current source/stream,
catalogue and matcher identities. It returns only compact place metadata and
activity IDs, never raw tracks, evidence or credentials. It is disabled outside
local development or when the configured application database is remote. No
public/mobile API or sync contract was changed. Absence does not claim zero visits;
the detail list is omitted when no current supported membership exists.

The client shares an account-scoped, memory-only query between map and details,
refreshes after local library commits, and does not persist place results into
offline storage. Production UI is disabled. The local app shell reads stored
account metadata instead of refreshing expired Strava credentials; deployed
credential handling is unchanged.

Verification covers 100 focused tests, 48 existing browsing/store tests, scoped lint, authenticated/anonymous API
reads, wrong-user/wrong-athlete SQL reads, an actual map popup, and desktop/phone
detail rendering. Foggenhorn appears in its activity; Capanna Monte Bar appears
once in Gravel Ticinese despite its two encounters. Temporary local test sessions
were removed after browser verification. Private evidence and screenshots are in
the publication directory. Map filtering updates Capanna's count from three to
one; disabling/re-enabling the layer and persisted toggle state were also checked.
Final fingerprints after browser verification confirm the same five non-relation
tables remain unchanged. Full typecheck retains the three existing prototype
errors documented above.

### Live selection preview (2026-10-23)

The local map selection sheet now offers **Live place matching**. Select one to
five activities, enable the switch, and adjust peak/pass/hut distances from
5–100 m. **Apply distances** reruns the current matcher; **Reset** restores
35/50/50 m. Changing the selection automatically evaluates the new selection.
**Run again** explicitly reloads inputs. Turning the mode off restores stored
place results. Controls are temporary and are not persisted or shared in URLs.

`POST /api/experimental/live-places` uses the authenticated actor, current stored
full-resolution streams, and the validated local Swiss catalogue. Both the
endpoint and service require development mode, no Vercel deployment, and a local
database host. The catalogue artifact defaults to
`output/places/switzerland-2026-10-20`; a different frozen local artifact can be
selected with `ACTIVITYMAP_LOCAL_PLACE_CATALOGUE` before restarting the server.
The validated artifact is reused in memory; the database catalogue identity and
count are checked each run. No Strava/OSM requests, migrations, or relation
publications occur. Per-activity reads retain ownership/account/freshness checks.
Read-only previews do not take the batch publisher's athlete advisory lock.

The existing 100 m encounter entry, 150 m exit, 300 m discovery corridor, pause
grouping, and peak elevation rule remain unchanged. Only the three classification
radii are adjustable. The encounter inspector includes unsupported encounters
within those encounter boundaries, with closest distances and encounter counts;
it does not list every place in the 300 m discovery corridor. Incomplete or
uncovered evaluations are explicitly labelled and do not contribute map/list
visits. Missing stored GPS is reported without fetching it from Strava.

Results replace the map/list place source while preview mode is on. HTTP
responses are private and not cached. Temporary React Query entries include the
account scope, library revision, selected IDs, and thresholds; old results are
hidden during requests or after failure. No prepared-track cache or automatic
background matching is introduced.

Full-service measurements on local main: Gravel Ticinese took 525–787 ms for
one activity; a four-activity batch took 1,923 ms. These include stream reads,
track preparation, spatial discovery, classification, and result construction,
but exclude HTTP transport and browser rendering. Warm matcher-only times are
much smaller; discovery/input work dominates these runs.

Validation: 29 focused handler/config/matcher tests pass. Browser checks cover
threshold changes (Capanna Monte Bar at 50 m vs 10 m), reset, restoration of stored
mode, desktop/phone layout, and unchanged `activity_places` count/content hash.
The preview accepts localhost/127.0.0.1 loopback origins on the server's port;
unrelated origins and other ports are rejected. Scoped lint is clean. The full
repository typecheck still reports only the three existing errors in
`scripts/prototypes/activity-names/holdout-report.ts`.

The final browser run also confirms automatic recomputation after selecting a
different activity through in-app navigation. A concurrent repeat of the service
benchmark took 564–1,894 ms for one activity and 3,371 ms for four, so timings vary
with startup and local load. Both benchmark runs verified that an unrelated user
received no place/encounter data and that saved relation rows were unchanged.

### Live matching radius layer

Live mode now shows every spatially discovered candidate within the 300 m route
corridor, including candidates without an encounter. The detail-sheet visited
list continues to include only complete supported matches. Each candidate has a
metre-based geographic polygon for each place kind, using the applied peak/pass/
hut threshold. Solid teal indicates a supported match, dashed grey a non-match,
and dashed amber incomplete evidence. Match status is scoped to the visible
selected activities and to each place kind, so a hidden activity cannot colour a
candidate as matched. Multiple activity encounters share one point/radius per
place/kind.

Candidate popups show the applicable radius, match status, and matched activity
count. Circles describe horizontal proximity only; GPS evidence and the peak
altitude check still apply. Draft slider changes do not resize the circles until
**Apply distances**, keeping their geometry consistent with the displayed result.
Stored mode restores the original supported-place layer without radius polygons.

Checks include physical radius accuracy at different latitudes, separate radii
for multi-kind places, and exclusion of hidden activity support. Local browser
checks verify all six Gravel Ticinese candidates, Capanna Monte Bar remaining
clickable at 10 m as a non-match, restoration at 50 m, and unchanged saved
relations. No migration or production changes are involved.
