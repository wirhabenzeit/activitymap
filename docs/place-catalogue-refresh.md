# Place catalogue preparation and refresh

The places v1 catalogue is independent of activity ingestion. Prepare a complete
regional snapshot without database access, then publish that exact artifact with
a separate command. Both commands can run locally; a future CI job can use the
same entry points. Nothing runs automatically when the web application starts.

## Release boundary and schema contract

The catalogue foundation can be released independently of activity matching.
Migration 0025 adds retained snapshot metadata and coverage in `place_catalogues`,
plus nullable region ownership and retirement time on `places`. Existing OSM
identity uniqueness, spatial indexing and internal place UUIDs remain the
identity contract. Legacy rows are preserved and require explicit adoption.
Retired rows remain available to existing foreign keys, but positive place reads
exclude them. No new activity cross-reference schema is required for ingestion.

Preparation and combination have no database access. Publication writes only
catalogue rows and metadata. The published-catalogue reader exposes the active
manifest and coverage without loading extraction files; callers must use one
repeatable-read transaction for metadata and corresponding place queries.
The focused production release includes catalogue schema, ingestion, publication
and shared spatial reads. Experimental activity matching, local preview adapters,
debug controls, title experiments and native UI changes remain on the separate
`codex/activity-place-inference-design` branch. No scheduler, background matching,
public endpoint or product UI is introduced. The existing activity-evidence table
is included only to preserve the already tested migration history; ingestion
does not populate it.

Deploy migration 0025 before backend code that reads the new fields. Publish the
catalogue as a separate operator action after reviewing its dry run. An empty
database accepts the combined catalogue directly; existing frozen data must be
adopted first, with consolidation needed only when replacing an assigned region.
Before production release, rehearse migration, publication, exact-repeat
publication and application reads on an isolated production-derived database.
Local proofs and the production-derived rehearsal below have passed. The
controlled production rollout is still pending.

A failed publication rolls back automatically. Successful publication is not
automatically undone: older source epochs are deliberately rejected. Keep the
input artifacts and a tested database restore plan for recovery after a committed
publication. An application rollback can retain the additive schema; do not drop
catalogue columns or tables as an application rollback step.

## Prepare an artifact

Run from the repository root with Node.js and the project's dependencies installed.
Preparation runs entirely in TypeScript/Node using project dependencies, with no
Python environment, subprocesses or external OSM tools:

```sh
pnpm places:prepare --region switzerland \
  --out output/places/switzerland-YYYY-MM-DD
```

This downloads the complete Geofabrik Swiss PBF and coverage `.poly`, runs the
Node PBF reader and selective hut geometry resolver, measures pass and peak
terrain (see [noise filter](#noise-filter-terrain-and-tags)), and validates the source
hash, header timestamp, implementation provenance, counts and geometry. It
normalizes named peaks, natural saddles, road/trail passes and mountain huts.
Unsupported source representations are explicitly audited in the manifest;
malformed geometry within the supported building model fails preparation.
Unnamed/unselected objects are excluded by the existing normalization policy.

To prepare already downloaded files, supply both `--pbf /path/to/snapshot.osm.pbf`
and `--poly /path/to/coverage.poly`. Switzerland, Austria and Italy have predefined
URLs; other regions require `--source-url` and `--coverage-url`. Downloads are
restricted to HTTPS `download.geofabrik.de` URLs. Terrain is always read from
the public Copernicus bucket, so preparation needs network access even with
local source files.
The region identifier is included in new artifact identities. Old frozen v1
artifacts remain readable, with an explicit publication region.

The output directory must be new. The command produces `places.jsonl`,
`coverage.geojson` and `manifest.json`, publishing the manifest last as the
completion marker. The manifest binds the region, source timestamp/checksum,
coverage, selector/resolver implementations, normalization, terrain method and
filter policy, toolchain, counts, artifact checksum and OSM and Copernicus
attribution. Preparation opens no database connection.
Temporary source files are removed afterwards. Retain the completed artifact
for publication retries and reproduction; retain original downloads separately
if you need to rerun the extraction itself.

## Publish or refresh

Apply the checked-in migration `0025_place-catalogue-refresh` through the normal
migration runner before using the publisher. Migrations and catalogue publication
are separate operations. Test the migration and artifact on an isolated database
before production publication.

The publisher reads only explicitly supplied `PLACES_*` connection settings.
It does not load dotenv files or fall back to the application's `DATABASE_URL`.
For a local database:

```sh
export PLACES_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/main'
export PLACES_EXPECTED_HOST='127.0.0.1'
export PLACES_EXPECTED_DATABASE='main'

pnpm places:publish --artifact output/places/switzerland-YYYY-MM-DD \
  --region switzerland
```

Default execution is a dry run. It reports the current and proposed snapshot IDs,
source timestamp, category counts, coverage changes, additions, updates,
unchanged places, retirements and reactivations, with bounded named examples.
The dry run writes no rows. When reviewed, publish with the exact previous
snapshot ID returned by the report, or `none` for an unpublished region:

```sh
pnpm places:publish --artifact output/places/switzerland-YYYY-MM-DD \
  --region switzerland --apply --expect-current none
```

On refresh, replace `none` with the report's `previousSnapshotId`. If another
publisher changed the active snapshot meanwhile, publication fails and requires
a new dry run. More than 20% retirement is flagged in the dry run and requires
`--allow-large-retirement` on apply, after inspecting source completeness.

For production, use a dedicated direct connection with credentials authorized
for catalogue tables. Set the expected production host/database explicitly.
Remote connections require `?sslmode=verify-full` (legacy `require` also enables
certificate verification); other URL driver options are rejected. Neon targets
also require `PLACES_EXPECTED_BRANCH_ID`, checked against the connected server.
Credentials belong in the operator environment or CI secrets, never in artifacts.
The publisher needs catalogue SELECT/INSERT/UPDATE and table-lock permissions;
its runtime SQL does not write activities, streams, accounts or activity evidence.

## Refresh behavior

- A repeated identical artifact is a no-op, preserving IDs and timestamps.
- Existing `(osm_type, osm_id)` identities retain their internal UUID on updates.
  Nodes and ways with the same numeric ID remain distinct.
- Missing sources are retired only among rows assigned to the refreshed region.
  Retired rows stay stored for reference integrity and recover their UUID if they
  reappear. A representation replaced by a different OSM identity is a new place;
  there is no automatic name/proximity merging.
- Snapshot metadata and coverage are retained in `place_catalogues`. A partial
  unique index permits one active snapshot per region. All upserts, retirements
  and the active snapshot change commit in one transaction; an interrupted or
  failed refresh leaves the preceding catalogue intact.
- Older source snapshots, regressed per-object versions/timestamps and conflicting
  contents for an existing snapshot identity are rejected.
- A source already assigned to another region is rejected. Combine overlapping
  country extracts into one serving catalogue before publication. The explicit
  consolidation workflow below can replace an existing Swiss region while
  preserving source identities.
- Activity evidence is not rewritten or recomputed. Existing snapshot guards
  invalidate old results after refresh, and retired places are excluded from
  positive place reads. Background publication remains experimental.

## Noise filter: terrain and tags

The OSM selectors include noise: lowland road crossings tagged as passes (Forch
near Zürich), small bumps tagged as peaks, and Alm huts and restaurants tagged
as `tourism=alpine_hut`. Since `osm-places-v2`, preparation measures every pass
and peak on one global terrain model and applies one versioned rule set to
all countries. Hidden places stay in the artifact and the `places` table, with
their metrics and a `hidden_reason`, so publication keeps their UUIDs and
references. Candidate discovery and the batch matching catalogue skip them.
A new filter policy or terrain method changes the catalogue snapshot identity,
so existing activity results become stale and are rematched without the
hidden places: visits already matched to a now-hidden place disappear too.

### Terrain

Preparation reads [Copernicus GLO-30](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model)
cloud-optimized GeoTIFFs from `https://copernicus-dem-30m.s3.amazonaws.com/`
with HTTP range requests, using the pinned `geotiff` package. Only the internal
1024 × 1024 blocks around passes and peaks are fetched and decoded, with a
bounded in-memory cache; nothing is written to disk. Missing 1° tiles (HTTP 404)
are sea and give no metrics. Every other failure is retried for about a minute
and then fails the preparation, so a network problem cannot silently become
"no terrain". The DEM is a surface model (forest canopy included) on a 1
arc-second grid with pixel-is-point registration.

- **Pass amplitude** (`pass_amp_m`). Circles of 200, 400, 800, 1,500 and 2,500 m
  around the node, 72 bilinear samples each, minus the DEM height at the node
  (`dem_elevation_m`). Per circle, `rise` is the second-highest maximum among
  the arcs above the node (two flanks), `drop` the second-deepest arc below it
  (two valleys), and `amp = min(rise, drop)`. The best circle wins. A road over
  a plain slope scores zero.
- **Peak local prominence** (`peak_prominence_m`). Start at the highest DEM cell
  within 250 m of the node and run an 8-connected priority flood (highest cell
  first) inside a ±3 km window. The lowest height popped before a cell higher
  than the start is the key col. If the window edge is reached first, the drop
  to that edge cell is stored with `peak_prominence_capped = true`: a lower
  bound, for peaks that dominate their window.

Metrics are rounded to decimetres. The method parameters are `TERRAIN_METHOD`
in `src/server/places/terrain.ts`; its version and hash are recorded in the
manifest under `terrain`, with the DEM URL and attribution.

### Rules

`PLACE_FILTER_POLICY` in `src/server/places/place-filter.ts` holds every
threshold and pattern; its version and hash are also bound in the manifest.
A `wikipedia` or `wikidata` tag keeps any place (Ornpass has only Wikidata).

| Kind | Hidden when                                                                                                | `hidden_reason`       |
| ---- | ---------------------------------------------------------------------------------------------------------- | --------------------- |
| Pass | name is only an elevation or a generic word (`q. 2699`, `P2650`, `1557`, `Forcella`, `Joch`, `sea`)        | `generic_pass_name`   |
| Pass | elevation (OSM `ele`, else DEM) below 1,200 m and `amp` below 60 m                                         | `low_relief_pass`     |
| Peak | local prominence below 30 m and not capped                                                                 | `low_prominence_peak` |
| Hut  | no club operator, no info tag, and an Alm, Malga, Casera, Baita, restaurant, inn, forestry or hunting name | `non_mountain_hut`    |

Club operators match SAC, CAS, DAV, ÖAV, Alpenverein, CAI, Club Alpino, AVS,
Naturfreunde, SAT and similar. Info tags are capacity, beds, website,
contact:website, url, phone, contact:phone, reservation, opening_hours,
wikipedia and wikidata. Missing terrain never hides a place. Same-name passes
within 1 km are one pass (duplicate Ricken nodes scored 47 and 73 m): if any
node is kept, all are. A place with several kinds is hidden only when every
kind is hidden. Combining recomputes decisions over the combined rows, since a
same-name group can cross a country border.

The thresholds were fitted on the Swiss and Austrian gazetteer decisions of the
per-country prominence research (draft PR #472), which needed national lidar
models and about 15 GB per country. That research is not part of preparation.

### Measured run (2026-10-31)

The 20 October extracts were prepared again with terrain on a local machine,
reading Copernicus over the network. The three countries ran in parallel.

| Country     | Places | Passes hidden |   Peaks hidden | Huts hidden | DEM tiles / blocks |  Time |
| ----------- | -----: | ------------: | -------------: | ----------: | -----------------: | ----: |
| Switzerland | 11,325 |    100 (4.1%) |  1,664 (20.8%) |   36 (4.2%) |           14 / 119 |  2:46 |
| Austria     | 21,948 |     52 (1.8%) |  6,185 (35.3%) | 298 (18.9%) |           25 / 295 |  4:50 |
| Italy       | 49,607 |   876 (10.8%) | 19,144 (50.0%) | 387 (12.0%) |           78 / 709 | 11:52 |

The combined `ch-at-it` catalogue hides 28,370 of 80,366 places: 1,018 passes,
26,639 peaks and 714 huts. Every pass and peak got terrain; a few transient S3
read failures recovered on retry.

Against the research decisions these numbers reproduce the Python prototype.
Pass agreement is 92.6% (CH), 82.1% (AT) and 51.9% (IT); 97.9% of Swiss and
98.9% of Austrian gazetteer passes are kept. Almost all disagreements are
alpine cols that the per-country rule hid and this rule keeps (Passo dei
Volontari, Passo Ronchina, Vetternscharte). On peaks with a research summit,
15.1% / 26.9% / 37.2% are hidden (research rule 12.6% / 23.5% / 31.4%) with
93.0% / 90.7% / 87.2% the same decision. Peaks without any research summit
within 250 m are mostly below 30 m, which is why the totals above are higher.
Forch, Regensberger Pass, Sternenbergpass and Talhöchi are hidden; Buchenegg,
Hulftegg, Furkapass, Ornpass, both Ricken nodes and Passo di Gavia are kept.

### Compatibility

`osm-places-v1` artifacts and manifests stay readable: they have no `terrain`
section and no filter counts, and every place is listed. Already published v1
catalogues keep serving until a v2 artifact is published. Migration
`0029_place-terrain-filter` adds the nullable metric and `hidden_reason`
columns; deploy it before backend code that reads them. `counts.filter` in the
manifest reports hidden places by kind and reason and the passes and peaks
without terrain. Publication dry runs list up to 20 hidden examples.

Attribution: © DLR e.V. and Airbus, Copernicus programme. The Copernicus DEM is
free to use with this attribution; the map layers that show places carry it
next to the OSM attribution.

## Adopt an existing frozen local catalogue

Migration 0025 leaves existing places unassigned. Publish their **exact original
artifact** first, with the desired region and `--expect-current none`. The
publisher proves every existing source row matches before assigning the region,
retaining all UUIDs. A newer/different artifact is rejected until this adoption
has completed. In the existing Swiss development setup the original is
`output/places/switzerland-2026-10-20`.

`loadPublishedCatalogue` reads the active manifest and coverage for an explicit
region. `loadServingCatalogue` prefers `ch-at-it` and falls back to `switzerland`;
an explicit region argument disables fallback. Both accept the caller's database
transaction, so a concurrent refresh cannot mix catalogue versions with the
associated place reads. Integration with selected-activity matching remains on
the experimental design branch.

## Verification

```sh
pnpm db:test-place-refresh
```

Supply `MIGRATION_DATABASE_URL`, `MIGRATION_EXPECTED_HOST`,
`MIGRATION_EXPECTED_DATABASE` and `MIGRATION_REQUIRE_TARGET_GUARDS=true` pointing at
a migrated local database whose name ends in `_test`. The proof creates and
removes a unique scratch schema. It covers adoption, dry-run isolation, exact
repeats, refresh diffs, stable IDs, retirement/reactivation, rollback after an
injected database failure, concurrent publishers/readers, spatial exclusion of
retired rows and independent regional refreshes. Public catalogue tables are not
changed by the proof.

The catalogue-only release was also verified from an isolated copy of the staged
foundation, excluding the local matching adapter. All 1,183 unit tests,
typecheck, scoped lint and schema generation checks passed. An empty local
database accepted all migrations; frozen import, refresh/consolidation, existing
matching/query and spatial-schema proofs passed, and a second migration run was
a no-op. The serving reader proof covers Swiss fallback, combined preference and
strict explicit region selection. Source exclusion names use normalization's
same nonblank-name and language preferences, including translated-name fallback.

Implementation verification on 23 October 2026 rebuilt all 11,325 Swiss places
from the existing complete 20 October extract, then published the resulting
artifact to a disposable database. The refresh, frozen-import and spatial-matching
integration proofs pass. The full unit suite passes (1,180 tests), along with
typecheck, scoped lint and migration consistency checks. Migration 0025 and exact
frozen-catalogue adoption were applied to local development `main`; activity,
account, stream and saved-evidence fingerprints and place identity fingerprints
were unchanged. A live selection match successfully used database-backed
metadata. No production database was accessed or changed during this local
verification.

### Node preparation implementation

The PBF reader streams bounded file blocks and supports raw and zlib compression,
sparse/dense nodes, packed/unpacked fields, exact 64-bit IDs and delta references,
metadata timestamps and coordinate offsets. Unknown required features,
history extracts, unsupported compression, truncated input, invalid parallel
arrays and oversized blocks fail preparation. Contributor identities are not
emitted. The reader follows the [official OSM PBF schemas](https://github.com/openstreetmap/OSM-binary/tree/master/osmpbf).

Only selected place sources and required hut member ways/node positions are
retained between passes. There is no complete node-location index. Preparation
limits selected sources to 100,000 and 64 MiB of serialized source data, and hut
node dependencies to 1,000,000. Hut geometry is bounded to 10,000 vertices and
uses the existing robust coverage topology checks. Unclosed/branching rings,
self-intersections, holes outside an exterior, touching boundaries, overlapping
components and unresolved references fail rather than being repaired.
Unsupported relation member types/roles are audited exclusions. Hut points are taken from an interior horizontal
cross-section, with holes excluded and containment checked.

New artifacts fingerprint the TypeScript reader, selector, normalizer and geometry
implementations, plus Node/ICU versions. Source hashes are checked before/after the
streaming passes, and implementation changes during preparation are rejected.
The artifact format and publisher remain compatible with earlier frozen artifacts.
Historical Python measurement scripts are retained on the experimental design
branch for the original audit; the production preparation command does not read
or execute them.

The full Swiss Node run reproduced all 11,325 source memberships and identical
names, categories, elevations and source metadata from the audited extract. Of
523 derived hut points, two differ only by floating-point rounding (maximum
coordinate difference 1.78 × 10⁻¹⁵ degrees); all other coordinates are identical.
Synthetic tests cover exact IDs above JavaScript's safe integer limit, signed
deltas, raw/zlib blocks, dense/sparse nodes, negative coordinate offsets, missing
metadata/dependencies, corrupt input, concave buildings, courtyard holes and
split/reversed multipolygon rings. Preparation verification does not publish to
production or modify activity evidence.

## Switzerland, Austria and Italy

V1 uses a combined `ch-at-it` serving catalogue built from the three complete
country extracts. Prepare each country separately; all three have predefined
Geofabrik download URLs:

```sh
pnpm places:prepare --region switzerland --out output/places/switzerland-current
pnpm places:prepare --region austria --out output/places/austria-current
pnpm places:prepare --region italy --out output/places/italy-current

pnpm places:combine --region ch-at-it \
  --input output/places/switzerland-current \
  --input output/places/austria-current \
  --input output/places/italy-current \
  --out output/places/ch-at-it-current
```

Use input extracts with the same PBF header timestamp; pinned dated downloads
are useful when a provider updates the countries at different times. Combining
rejects different epochs, normalization/toolchain differences, and conflicting
records for the same OSM source identity. Each component's snapshot ID, download
URL, source timestamp, PBF hash/size, preparation fingerprints and artifact hash
are retained in the combined manifest.

Shared `(osm_type, osm_id)` objects become one place, retaining their internal
UUID when published. `node/123` and `way/123` remain separate. Names or proximity
are never used to merge different OSM identities. `duplicates.jsonl` lists every
shared supported source, its name/version and the country extracts containing it.
Its checksum, byte count, number of shared sources and number of duplicate
occurrences removed are bound into the combined snapshot identity. Inspect this
report to understand actual border overlap rather than guessing from names.

Country coverage polygons are validated individually and then unioned in Node
with pinned `polygon-clipping` 0.15.7. The result is validated again. Matching uses
the union: internal country seams do not become coverage boundaries. External
boundaries, holes and regions outside the three-country union retain the existing
coverage rules. The bundle's `source.pbf_sha256` and related source hashes are
ordered component fingerprints; the individual real PBF hashes remain in
`components`.

Unsupported source representations are explicitly listed under
`source.exclusions`: peak/pass areas, non-multipolygon hut relations, unsupported
hut member types/roles, and hut ways mapped as lines. V1 does not invent points
for these features. Eligible malformed building polygons and missing dependencies
still fail preparation. This refines the earlier blanket rule about unsupported
geometry: unsupported representations are audited exclusions; corrupt input and
unusable geometry within the supported building model remain errors.

To replace an existing published Swiss-only catalogue, first dry-run the
consolidation with its current snapshot ID:

```sh
pnpm places:publish --region ch-at-it --artifact output/places/ch-at-it-current \
  --replace-region switzerland --expect-replaced <current-swiss-snapshot-id>
```

After reviewing the report, repeat with `--apply --expect-current none`. This
operation requires a new target region, verifies the previous snapshot, requires
the combined inputs to include the old region and its complete coverage, and
preserves all existing UUIDs, including retired rows. Ownership transfer,
retirement, old-region deactivation and new metadata publication are atomic.
A failed consolidation leaves the old catalogue active. Later combined refreshes
use the ordinary `--expect-current` workflow, without replacement flags.

The serving-catalogue reader automatically prefers `ch-at-it` when it is
published and otherwise uses the existing Swiss catalogue. Explicit region
selection is strict. Neither combining nor consolidation recomputes or publishes
activity evidence.

### Measured three-country run

The complete extracts used the same source epoch, `2026-10-20T20:23:47Z`.
Extraction on the local development machine took:

| Country     | Supported places before deduplication | Extraction time |
| ----------- | ------------------------------------: | --------------: |
| Switzerland |                                11,325 |            65 s |
| Austria     |                                21,948 |            97 s |
| Italy       |                                49,607 |           280 s |

Combining took another 3 seconds, for approximately 7 minutes 24 seconds overall,
excluding downloads and database publication. These are measured local timings,
not service guarantees.

The 82,880 input rows produced **80,366 unique places**. There were 2,512 shared
OSM source identities and 2,514 repeated occurrences removed:

| Extract membership         | Shared sources |
| -------------------------- | -------------: |
| Switzerland + Italy only   |          1,283 |
| Switzerland + Austria only |            233 |
| Austria + Italy only       |            994 |
| All three                  |              2 |

The two sources present in all three extracts are Muttlerkopf (`node/328329229`)
and Reschenpass - Passo Resia (`node/1251838509`). All overlapping source records
agreed; no name/proximity matching was needed. The manifests audit 19 distinct
unsupported source representations (22 occurrences across inputs): 18 peak/pass
areas and one hut site relation.

The artifact is `output/places/ch-at-it-2026-10-20`, with snapshot identity
`osm-places-v1:1a9e03962c0a18e0bea01dfddb5feaa1f96b1b0c65636b22a8e881f77811ac9b`.
It was published to local development `main`, preserving all 11,325 original
place UUIDs and the activity/account/stream/evidence fingerprints. PostGIS probes
confirmed coverage across each pair of country borders and rejection outside
the union. A live selected-activity match used the combined catalogue successfully.
The full unit suite passes (1,183 tests), as do typecheck, scoped lint and refresh
integration proofs, including failed and successful consolidation. This initial
measurement only changed local development data; the production-derived
rehearsal is recorded below.

## Production-derived rehearsal (2026-10-23)

This rehearsal used the catalogue foundation at `0fa79162` on the experimental
branch, including internal matching probes. The focused release retains the same
three migration files and catalogue processing implementation; it excludes the
experimental matcher, preview adapters and UI. The migration and ingestion
results below apply to that shared foundation.

The release was rehearsed on `rehearsal/place-catalogue-2026-10-23`
(`br-autumn-sun-a23xnrae`), a fresh data-and-schema child of production
`main` (`br-proud-rice-a2hvhn9j`) in the canonical Vercel-managed Neon project
`neon-indigo-mountain` (`black-snowflake-48725396`). The test branch expires on
25 October 2026 at 12:35 UTC and its compute suspends after five idle minutes.
The parent relationship was verified through Neon. Every direct connection used
the test endpoint, verified TLS, an exact expected child branch and database;
the migration runner also explicitly forbade the production branch.
Application environment files and deployment settings were unchanged.

Production's copied migration history was an exact, checksum-matching prefix
through `0022_manual-strava-import`. The rehearsal therefore applied all three
pending places migrations, not just the refresh migration:

- `0023_activity-places`
- `0024_places-proximity-visits`
- `0025_place-catalogue-refresh`

All three applied successfully in approximately 2.2 seconds. Existing data in all
30 pre-existing application tables retained identical counts and full-row
fingerprints, including 11,703 activities and 11,703 stream rows. The newly
created activity-evidence table was empty. Migration status reported 26 applied
migrations and zero pending; repeating migration was a no-op.

The combined artifact and snapshot described above were then published:

| Operation                | Result                                                | Command time |
| ------------------------ | ----------------------------------------------------- | -----------: |
| Publication dry run      | 80,366 additions; no updates, retirements or adoption |        3.0 s |
| Publication              | 80,366 unique, active OSM source identities           |       16.8 s |
| Exact-repeat publication | All 80,366 unchanged                                  |        8.9 s |

These are measured command wall times, including startup, artifact validation and
network access. Because production has no existing places catalogue, first
publication needs neither frozen adoption nor Swiss-region replacement flags.
The rehearsal used `--expect-current none` for first publication and the exact
published snapshot ID for the repeat.

Full-row fingerprints of both catalogue tables confirmed that the repeat
preserved all place UUIDs, contents and import/publication timestamps. All 31
noncatalogue application tables, including activity evidence, retained identical
fingerprints after publication, application probes and the repeat. No activity
evidence was published or recomputed in the database.

Application read probes used the real repository and matching service with the
published database metadata in a repeatable-read transaction. Three sampled
owned activities completed report-only matching successfully: one had three
matched places among four candidates, while two had no candidates. Measured
evaluation/read times were 1,161 ms, 656 ms and 628 ms. Existing positive-membership
queries returned no saved results, as expected for the empty evidence table;
an unrelated actor also received no memberships. No HTTP endpoint or deployed UI
was enabled by these internal read probes.

Real PostGIS discovery confirmed coverage across each country pair and rejection
outside the three-country union. The Austrian–Italian probe found one candidate;
the other border probes had none. The final public-schema fingerprint matched
local development exactly:
`23e54b8e4e9035caf95fe21efadf7462f2dc3737791749e6550c58ede1ca478d`.

A final read-only check of the production branch still showed 23 applied
migrations and no `places` or `place_catalogues` table. No production schema or
data was changed. Production rollout must still follow the protected migration
workflow in [database migrations](database-migrations.md), followed by a separately
reviewed catalogue publication. This rehearsal does not test a deployed UI or
replace the production recovery-branch/backup step.

## Focused release validation (2026-10-23)

The production release was extracted onto a fresh branch from current `main`,
excluding experimental matcher/preview code, title experiments and native UI
changes. `pnpm check` passed: 1,130 unit tests, browsing/stats/settings UI suites,
quality-harness tests, typecheck, lint and generated-artifact checks. Fresh local
migrations, spatial schema/erasure, frozen import and refresh/consolidation proofs
passed. Schema generation produced no drift, a second migration run was a no-op,
and the resulting schema fingerprint matched the production-derived rehearsal.
