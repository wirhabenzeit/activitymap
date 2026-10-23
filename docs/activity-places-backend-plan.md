# Activity places: backend proof-of-concept implementation plan

Planned 22 October 2026. Implements the initial experiment from the
[place catalogue proposal](activity-place-inference.md), incorporating the
[Swiss source audit](osm-catalog-switzerland-measurement.md) and
[PostgreSQL measurement](osm-catalog-postgres-measurement.md).

Implementation status, 22 October 2026: slices 1–4 are implemented locally:
the additive schema/evidence contract, frozen Swiss catalogue exporter/importer,
pure encounter matcher, manual runner, guarded publication and scoped queries.
The normal development target is the existing local `main` database on port
`5432`, preserving its activities, accounts, streams and `db_data` volume.
Synthetic and destructive database proofs use disposable `_test` databases.
Earlier schema/import/matcher verification used an isolated local database;
integration into `main` is recorded separately in the setup guide.
Slice 5 (labelled real-track evaluation) remains outstanding; thresholds are
experimental and no live API is wired into the application. See
[local setup and verification](activity-places-local-development.md).

## Deliverable and boundaries

Build a manually operated backend pipeline that imports the frozen Swiss place
catalogue, matches selected owned activities, persists inspectable encounters,
and answers activity/place and personal-count queries. The first delivery uses
**two new domain tables** and local run manifests. It does not expose a live
product API or change web/iOS behavior.

Use the 11,325 usable-named peaks, saddles, mountain passes and huts from the
2026-10-20 extract. Preserve overlapping categories and normalized hut points.
The catalogue is immutable for the experiment. Scripts may repeat the same
import and manually recompute activity results; they do not refresh OSM data.

Defer OSM synchronization, multiple-region reconciliation, source retirement or
conflation, automatic activity processing, job queues, spatial invalidation,
aggregate caches, native sync, titles and settlements. Keep ownership, deletion,
input-version checks and atomic publication from the start.

## 1. Schema and PostGIS foundation

Use `src/server/db/schema.ts` and the checked-in Drizzle migration workflow.
Do not load the benchmark SQL into the application: its four experimental
schemas and fingerprint-width proxies are not implementation migrations.

### `places`

One place initially corresponds to exactly one OSM source object.

| Columns                                     | Contract                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id uuid`                                   | Internal primary key, created once and preserved on repeat imports; not a name/coordinate hash                    |
| `osm_type`, `osm_id bigint`                 | Source type restricted to node/way/relation, positive ID; unique composite key                                    |
| `kinds text[]`, `subtypes text[]`           | Nonempty normalized categories, preserving saddle/pass overlap; validate allowed values and duplicate-free arrays |
| `display_name text`, `names jsonb`          | Nonblank usable display name; recognized current/localized/alternative names                                      |
| `location geography(Point,4326)`            | Valid normalized point; longitude/latitude order explicit at the database boundary                                |
| `elevation_m real`, `tags jsonb`            | Optional parsed elevation; all original source tags as string values                                              |
| `osm_version`, `osm_updated_at`             | Original source metadata, separate from import time                                                               |
| `point_derivation`, `normalization_version` | Direct node or validated hut-interior point, with versioned normalization rules                                   |
| `catalogue_snapshot_id`, `imported_at`      | Identifies the fixed source/checksum, selector/normalizer versions and coverage manifest                          |

Indexes: primary key, unique source identity and geography GiST. No blanket
JSONB/name/category-array GIN indexes initially. Use a tested Drizzle geography
mapping and round-trip points through the application's actual database driver.

Source metadata stays in this table for the POC. A later `place_sources` split
can backfill the embedded identity without changing `places.id`. Do not implement
automatic proximity/name-based conflation. Do not store the benchmark's
`geometry_fingerprint_width_proxy`; actual dependency hashing belongs to a
future update-aware importer.

### `activity_places`

One current row per **activity/place pair**, with one or more encounter episodes.

| Columns                                                                    | Contract                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `activity_id bigint`, `place_id uuid`                                      | Composite primary key; activity FK cascades on deletion, place FK restricts deletion                |
| `supported_relations text[]`                                               | Unique supported relationships summarized from episodes; empty for nearby/uncertain-only candidates |
| `encounters jsonb`, `evidence_version`                                     | Nonempty validated episode array with explanations and original-stream references                   |
| `input_stream_generation`, `input_stream_revision`, `input_source_version` | Identifies the exact stored activity-stream input                                                   |
| `catalogue_snapshot_id`, `matcher_version`, `parameters_hash`              | Exact catalogue and matching policy used                                                            |
| `run_id uuid`, `computed_at`                                               | Links the result to the manual evaluation run                                                       |

The primary key supports activity-to-place reads. Add `(place_id, activity_id)`
for place-to-activity reads. Store OSM/activity bigint identifiers as decimal
strings at JSON/CLI boundaries; never convert them through unsafe JS numbers.
Avoid a duplicate owner field: authorize by joining the owning activity.

Matcher v4 emits `reached_peak`, `visited_pass` (natural saddles and road/trail
passes) and `arrived_at_hut` (hut vicinity). Legacy `reached_saddle` and
`crossed_pass` remain readable; new evidence makes no crossing claim. SQL checks enforce JSON object/array
shape and nonempty encounter arrays; the runtime schema validates episode fields,
index ordering, units, finite values and allowed classifications.

Store only candidates with an actual encounter under the configured encounter
policy. More distant rejected candidates belong in the bounded diagnostic
report, not permanent relation rows. A nearby/uncertain encounter remains useful
inspection evidence but does not enter default visited-place counts.

### Encounter JSON contract

Use a runtime-validated, versioned schema shared by the pure matcher and writer.
Evidence version 2 stores logical encounters as groups of continuous `fragments`
and explicit `pauses`. Each fragment contains:

- `start_gps_index` and `end_gps_index`: inclusive bounds in the original
  `latlng.data` array; `section_id` distinguishes continuous recording sections.
- `closest: { kind: 'segment', start_index, end_index, fraction }`, with
  consecutive original indices and fraction in `[0,1]`: the closest point on a
  valid GPS segment. An isolated sample uses `{ kind: 'sample', index }`.
- Optional start/closest/end `elapsed_s`: seconds since activity start, available
  only when the time stream can be aligned reliably.
- Start/closest/end route-distance positions with an explicit basis: aligned
  provider distance, or computed distance within a continuous section. Never
  bridge a GPS gap merely to manufacture cumulative distance.
- `min_horizontal_distance_m`, optional recorded altitude and altitude difference,
  and the mapped elevation/point used. Keep recorded and OSM elevation distinct.
- Relation assessments with `supported`, `nearby` or `uncertain` outcomes,
  stable reason codes, and quality flags such as missing altitude or sparse GPS.

Preserve original indices even when validating/splitting a track. Missing fields
remain absent; zero is a real time, index or elevation value. Time/altitude/distance
arrays are not assumed aligned because their lengths happen to match. Interpolate
within a valid aligned segment only; never across a detected gap.

Each group retains all original fragment assessments, indices, distances and
section IDs. Its relation summary selects the strongest existing assessment per
relation (supported, then uncertain, then nearby; first fragment wins ties).
It never invents route geometry or elapsed stay time across a gap.

Join consecutive fragments only when the section boundary is a recording time
gap, the original GPS indices are adjacent and both endpoints lie within the
100 m encounter-entry radius. If aligned provider distance advances more than the
150 m exit radius during the gap, keep the encounters separate. Invalid samples,
bad times, jumps and an observed exit/re-entry also remain separate. The radius
comes from the matcher policy; it does not relax the category-specific visit
thresholds. There is no maximum pause duration, so summit and overnight hut stops
can remain one encounter. Each pause records its endpoint indices, elapsed times,
distances from the place and grouping radius. Time inside the gap is unobserved:
do not derive stay duration, route geometry or section distance across it.

Keep separate encounters for outbound/return hut visits or repeated pass visits
when the recording shows a real departure. Grouping does not remove track gaps or
combine the continuous evidence, and work limits still bound raw fragments.

Recording pauses and local GPS discontinuities are diagnostics rather than activity-wide
publication blockers. `complete` means all recorded sections were evaluated under
the selected catalogue and policy; it does not mean continuous GPS coverage or a
complete inventory of everything visited during unrecorded time. A locally
supported encounter can count even if a pause occurs elsewhere or at that place.
An isolated point remains uncertain. Invalid samples/times and spatial or speed
jumps split geometry; matching never interpolates through those boundaries.
Valid evidence elsewhere remains eligible. Work limits, catalogue coverage
failures and other processing errors retain their partial/uncovered/failed
handling. Unknown diagnostic reasons are blocking by default.
`supported_relations` is derived from supported episode assessments, never an
independent editable claim. Default rankings count each activity/place once;
the episode array can later move to `activity_place_encounters`.

### Infrastructure and migration acceptance

Use the existing development `docker-compose.yml` PostgreSQL 17 service with
PostGIS binaries installed, retaining its `db_data` volume and database `main`.
Back up that database before changing the image or applying the additive
migration. The catalogue and activity-place rows belong beside the existing
local activities; a separate feature database and copied activity dataset are
not required for development or evaluation.

The image and CI migration service install PostGIS binaries with the same script.
The migration owns extension creation, so fresh databases remain empty until the
baseline runs. The standalone `docker-compose.places.yml` project is optional
infrastructure for disposable `_test` databases and migration/proof fixtures.
Historical native local PostGIS validation and the isolated ARM64 Docker image
build/start have passed. The schema proof uses the application's Neon
WebSocket/Drizzle driver through a temporary loopback-only proxy.

Create the extension and additive tables through migration history. Check
PostGIS availability on an isolated Preview/Neon branch if deployment is later
approved; the initial implementation and validation remain entirely local.
Verify extension-owned public relations interact correctly with
`fingerprintPublicSchema` and Drizzle drift checks; do not rewrite the historical
baseline manifest to disguise extension differences.

Acceptance: full migration replay, a second no-op apply, existing-row fixtures,
source uniqueness, geometry round trips and GiST candidate query, relation
uniqueness, FK deletion behavior and unchanged existing application behavior.

## 2. Frozen catalogue artifact and importer

Keep PBF parsing outside the web runtime. Reuse the existing Python count/geometry
tools as inputs to a small normalization/export step. Produce validated JSONL
and a manifest with source/PBF/artifact hashes, data timestamp, coverage polygon
hash, selectors, normalization version, expected counts and attribution.

Do not copy the fixed-input benchmark's hard-coded naming exceptions as the
general importer policy. Implement recognized language-name keys, test metadata
keys such as `name:signed`, and reproduce the six legitimate language-only names
and 11,325 eligible objects in this snapshot. Resolve supported hut outlines
using the audited algorithm; reject invalid or unsupported point inputs.

Proposed manual entry point: `scripts/places/import-catalogue.ts`. It reads the
normalized artifact, validates the entire input before publication, then loads
all rows transactionally using the normal schema. Use an explicit target with
the repository's connection/target guards, a dry-run mode, and a transaction-scoped
importer advisory lock. The default must never silently select a production database.

An identical artifact rerun is a no-op preserving every internal ID. Existing
rows with conflicting contents or a different catalogue snapshot cause refusal;
this command is not an update/reconciliation implementation. Do not truncate,
delete or retire catalogue rows. Failed imports expose no partial catalogue.

Acceptance: expected per-category/union counts and 523 derived named-hut points;
same IDs/counts after rerun; original source-tag round-trip; rejection of malformed
input, duplicate source identities, invalid points and another snapshot; rollback
on injected failure. Keep full artifacts under ignored `output/`, with tiny
public synthetic fixtures in source control.

## 3. Pure deterministic encounter matcher

Proposed modules under `src/server/places/`: `types.ts`, `policy.ts`,
`track-sections.ts`, `encounters.ts` and `classify.ts`. Pure functions accept
validated streams, candidate places and a versioned policy; no database, network,
model calls, activity-title input or framework imports.

Pipeline:

1. Read stored raw `activity_streams.payload`, including GPS, time, distance and
   altitude plus their sampling metadata. Require usable, fetched, non-invalidated
   GPS. A failed latest refresh does not invalidate an earlier valid payload.
2. Split valid track sections around missing/invalid samples and configured time,
   distance or sampling gaps, preserving original indices. Record missing channels
   and alignment uncertainty.
3. Obtain bounded spatial candidates using the place GiST index and the buffered
   valid route sections. Use metre-based geography semantics and deduplicate by
   place ID. Avoid a global scan or one database query per GPS sample.
4. Calculate closest positions on valid segments, including intermediate points;
   collect contiguous approaches into episodes with explicit entry/exit rules.
   Re-entering after a real departure creates another episode.
5. Apply proximity rules: peaks within 35 m, passes and huts within 50 m.
   For peaks only, reject a vertical difference above 100 m when both elevations
   are available. Missing elevation or timing alone does not block a visit.
   Passes require no angle or approach/departure test; huts mean vicinity.
   Isolated samples and interpolation along segments over 100 m stay uncertain.
6. Group eligible fragments on either side of a recording pause without
   reclassifying their combined bounds or interpolating through the gap.
7. Emit relation summaries, episode evidence and bounded diagnostic rejections.
   If limits truncate candidates, sections or episodes, mark the activity partial
   rather than claiming a complete result. Preserve local gap diagnostics without
   making an otherwise fully evaluated activity partial.

Discovery radii, episode entry/exit/gap rules, vertical tolerances and maximum
work limits live in one versioned policy with a stable parameters hash. Starting
values are experimental: select/freeze them using the labelled development set,
then evaluate separately. Do not reuse the old title prototype's `accepted`
flags, rounded route progress, proximity merges or settlement logic as visit
ground truth. Useful geometry helpers can be reused only after their index,
sampling and gap behavior is verified.

Acceptance: synthetic fixtures for exact sample and between-sample closest points,
GPS gaps, duplicate/irregular times, unaligned streams, missing altitude, repeated
encounters, saddle/pass overlap and per-category decisions. Test important
boundaries and failure cases rather than asserting every implementation detail.

## 4. Manual runner, publication and query services

Add `scripts/places/match-activities.ts` and framework-independent services under
`src/server/application/activity-places.ts`, backed by
`src/server/repositories/places.ts` and `activity-places.ts`.

The command takes an explicit athlete/activity scope, frozen catalogue manifest,
policy version, verified database target and output directory. Inject that target
into the repositories rather than silently using a different default connection.
It supports dry-run/report-only execution,
bounded batches and repeat execution. It reads stored samples only: missing
streams are reported, not fetched from Strava. Reuse actor/account eligibility
and ownership checks; do not introduce an unrestricted client-facing athlete-ID
query path. Refuse simultaneous manual runs for the same athlete via an advisory
lock held on a dedicated direct/unpooled session for the run and released in
`finally`. A session lock acquired through unrelated pooled queries is not a
reliable run mutex. No scheduler/lease/job framework is needed for this experiment.

Compute outside database transactions. Before publishing each activity, recheck
the eligible account/owner and current stream generation, revision and source
version under the established lock order. Also recompute the authoritative
activity source projection (`md5(activity_stream_source(activity)::text)`) as the
existing stream repository does, and require fetched/non-invalidated stream
state; checking only the retained stream row's source version is insufficient.
Do not reuse or change stream-fetch
attempt IDs/leases as matcher claims. A changed input or revoked/deleted activity
makes the computed result superseded.

Replace all relation rows for that activity in one transaction, including
deleting previous rows when a complete recomputation finds no encounters. On
failure or partial processing, retain the last successfully published set and
record the failed/partial attempt in the manifest; do not expose half a replacement.
Re-running a fixed input/policy reproduces the semantic result without duplicate
memberships or episodes. Deletion/recreation must not let an old worker publish
against the new activity's stream generation.

Save a private, versioned run manifest with the exact activity scope, catalogue
and policy hashes, input tokens, and per-activity outcome: `complete` (including
zero matches), `missing_streams`, `uncovered`, `partial`, `failed` or `superseded`.
Coverage includes the whole discovery corridor, not just GPS samples; outside
coverage is not an empty successful match. Preserve the zero-match outcome
without inventing a fake place/relation row. Reconcile publication outcomes if
the process stops after a database commit but before the file is updated: the
simple recovery is to rerun that activity, not infer completion from row count.

Initial query services:

- `getActivityPlaces(actor, activityId, evaluationContext)`: current relation
  summaries and episode evidence, with stale/missing status supplied by the
  explicit evaluation context.
- `listActivitiesForPlace(actor, placeId, filters, evaluationContext)`: bounded,
  ordered activity results using supported relations and authorized ownership.
- `getTopPlaces(actor, filters, evaluationContext)`: distinct activity counts
  per place, with relation/category filters. Use direct SQL, no aggregate cache.

Use current stream tokens, requested catalogue/policy and the run's recorded
successful scope when reading. Older results retained after a failed rerun must
not masquerade as output of the requested run. Treat incomplete experiments as
counts over an explicitly processed subset, never the athlete's entire library.
The CLI supplies validated manifest context; application services do not load
local files. Preserve existing date/sport/filter semantics, including Stats'
separate reporting period when these queries later become product features.

Acceptance: unauthorized reads denied, activity/account erasure cascades, stale
publication rejected, zero-match replacement, failure rollback, repeat-run
idempotence, accurate distinct-activity counts and no samples fetched by query
services. At least one real PostgreSQL integration suite exercises transactions,
spatial queries and concurrent input changes through the actual repository path.

## 5. Evaluation and handoff

Select owned activities already stored in local `main`, using its existing raw
stream rows after the additive migration and Swiss catalogue import. Missing
streams remain an explicit outcome; the experiment does not copy activities into
a separate feature database or fetch missing samples as part of matching.

Use roughly 30–50 reviewed activities spanning hiking, ski touring and cycling,
plus known summits not reached, cliff-side paths, tunnels, sparse recordings,
missing altitude, repeated pass/hut encounters and border-crossing coverage.
Existing title experiments are development material, not an untouched holdout.
Review actual tracks/places and withhold activity titles from classification.

Produce JSON/GeoJSON diagnostic artifacts with the track sections, candidates,
encounter references, decisions and reasons; no UI implementation is required.
Freeze the policy and assess a separate labelled subset. Report counts and
precision/recall by relationship where labels support them, uncertainty/coverage,
matching runtime and relation/evidence storage. Threshold tuning and the extent
of supported classifications are explicit evaluation outcomes, not assumed facts.

POC completion means the frozen import is repeatable, encounter positions are
correctly traceable to input samples, database/query invariants pass, and reviewed
results establish which relationships can support useful filtering/counts.

## Suggested implementation slices

| Order | Slice                                          | Reviewable result                                                                |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | PostGIS + two-table schema + evidence contract | Additive migration, compatible local/CI environment, validated constraints       |
| 2     | Frozen catalogue normalization/import          | One manually repeatable import, fixed IDs/counts and source provenance           |
| 3     | Track sections + encounters + classification   | Pure matcher with index/time references and focused fixtures                     |
| 4     | Manual runner + guarded persistence + queries  | Scoped end-to-end backfill, manifests, place filters/counts via backend services |
| 5     | Labelled evaluation                            | Reproducible report, tuned/frozen policy and documented limitations              |

Run the relevant migration and PostgreSQL integration checks, typecheck, lint and
repository-required checks for each implemented slice. Add the new database proof
to CI; do not run an expensive real OSM download or private activity evaluation in
CI. Slices 1–4 are implemented at present; real-track evaluation retains the
acceptance criteria above. Synthetic fixtures validate implementation behavior,
not visit-classification accuracy.

## Boundary before a live API

A local manifest is appropriate for a manually scoped experiment. Before any
web/mobile API relies on processing completeness, add a small durable per-activity
processing-state table and atomically publish its zero-match/completeness state
with relation replacement. This is a deliberate next slice, not an implicit third
table in the initial two-table POC.

Then expose read-only authenticated v1 handlers through the existing
contracts/application/repository boundaries, with private no-store responses,
bounded query inputs, source attribution and the OpenAPI/Swift DTO workflow.
Opening an endpoint must not start matching, fetch streams or call OSM. UI,
incremental client sync and automatic rematching remain separate delivery work.
