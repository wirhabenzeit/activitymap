# Place catalogue preparation and refresh

The places v1 catalogue is independent of activity ingestion. Prepare a complete
regional snapshot without database access, then publish that exact artifact with
a separate command. Every command can run locally; the weekly GitHub Actions
workflow runs the same entry points
([Weekly refresh workflow](#weekly-refresh-workflow)). Nothing runs
automatically when the web application starts.

## Where the catalogue lives

Preparation and combination have no database access: they turn OpenStreetMap
extracts into an artifact on disk. Publication sends the difference between that artifact and the live
catalogue to the Convex backend (`backend/convex/livePlaces.ts`), which
matches activities against it. The measured runs further down record extraction timings and counts.

Publication is not automatically undone. Keep the input artifacts: going back
to an earlier catalogue means publishing it again. The workflow keeps each
combined artifact for 90 days ([Roll back](#roll-back)).

## Prepare an artifact

Run from the repository root with Node.js and the project's dependencies installed.
Preparation runs entirely in TypeScript/Node using project dependencies, with no
Python environment, subprocesses or external OSM tools:

```sh
pnpm places:prepare --region switzerland \
  --out output/places/switzerland-YYYY-MM-DD
```

This downloads the complete Geofabrik Swiss PBF and coverage `.poly`, runs the
Node PBF reader and selective hut geometry resolver, reads the roads through
every pass and measures terrain for passes on minor roads (see
[noise filter](#noise-filter-osm-roads-and-terrain)), and validates the source
hash, header timestamp, implementation provenance, counts and geometry. It
normalizes named peaks, natural saddles, road/trail passes and mountain huts.
Unsupported source representations are explicitly audited in the manifest;
malformed geometry within the supported building model fails preparation.
Unnamed/unselected objects are excluded by the existing normalization policy.

To prepare already downloaded files, supply both `--pbf /path/to/snapshot.osm.pbf`
and `--poly /path/to/coverage.poly`. The region is a Geofabrik extract's
region ID: its ID in [Geofabrik's index](https://download.geofabrik.de/index-v1.json)
with `/` as `-` (`us/california` is `us-california`). Without `--source-url`
and `--coverage-url` the URLs are read from the index. Downloads are
restricted to HTTPS `download.geofabrik.de` URLs, following only redirects
that stay on that host. `-latest` redirects some regions (Germany) to a
mirror, which fails: pass the dated extract (`…/germany-261122.osm.pbf`) as
`--source-url`, as `pnpm places:resolve` prints it. Geofabrik serves one
connection at one to two megabytes a second, so a large country's extract
(France is 5 GB) takes most of an hour. A download that drops or stalls for a
minute is resumed from the bytes already received; it fails after two hours
in total, or after 20 minutes without a further byte. Geofabrik refuses
every connection from some addresses, about a third of GitHub's runners: a
download that gets no answer at all fails after two minutes, and works when
run again from another machine ("Re-run failed jobs" in the workflow).
Terrain is always read from the public Copernicus bucket, so preparation needs network
access even with local source files.
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

## Choose the regions

The serving catalogue is one combined region, `places-live`
(`LIVE_PLACE_REGION`), built from Geofabrik extracts. The extracts and one
extract date for all of them are chosen by

```sh
pnpm places:resolve [--no-demand] [--date YYMMDD] [--overrides <file>]
```

(`scripts/places/resolve-regions.ts`; the rules are in
`src/server/places/region-selection.ts`). It prints one JSON document on
stdout and its progress on stderr:

```json
{
  "date": "261122",
  "regions": [
    {
      "region": "austria",
      "pbf": "https://download.geofabrik.de/europe/austria-261122.osm.pbf",
      "poly": "https://download.geofabrik.de/europe/austria.poly",
      "reason": "live"
    }
  ],
  "added": ["us-colorado"],
  "skipped": [{ "region": "russia", "reason": "coverage" }],
  "counts": { "live": 8, "demanded": 1, "included": 0, "excluded": 0 }
}
```

`regions` is sorted by region ID and is what the workflow's `prepare` matrix
runs. `added` lists the regions the live catalogue does not hold yet,
`skipped` the demanded regions left out (below), and `counts` the regions
by reason; `demanded` counts only those kept. `--no-demand` keeps the live
regions and the overrides only, `--date` pins the extract date, and
`--overrides` replaces `config/place-regions.json`.

It reads the live catalogue with the catalogue's read key
(`ACTIVITYMAP_CONVEX_SITE`, `ACTIVITYMAP_PLACES_KEY_ID`,
`ACTIVITYMAP_PLACES_SIGNING_KEY`; see [Publish or refresh](#publish-or-refresh))
and fails before the first live publication.

### Which regions

The wanted regions are the live catalogue's regions, plus the demanded
regions, plus `include`, minus `exclude`. Each carries its `reason`:

- `live`: every region of the live catalogue's manifest stays, whatever its
  demand.
- `include`: named in the override file.
- `demand`: a region that one quarter-degree tile holding at least two
  activities (`DEMAND_MIN_ACTIVITIES`) intersects. A tile on a border
  demands every country it touches.

Demand is read from `activityPlaceTiles` only (`livePlaces.demandTiles`):
the tiles each activity's current match read along its track. A match that
ran outside the coverage still records its tiles, so activities in a
country the catalogue does not cover yet demand it. An activity without
rows adds no demand: one with no track (no GPS, or more than 100,000
samples), one whose match exceeded the tile or window budget, and one never
matched.

The unit is the country extract. A country above about 6 GB
(`REGION_SIZE_CAP_BYTES`; today the United States and Canada) is taken as
the sub-extracts that hold demand, such as `us-colorado`, so each prepare
job fits one runner's disk and time. France (5.12 GB), Germany (4.89 GB) and
Russia (4.21 GB) stay whole. The choice is sticky: a country the catalogue
holds whole stays whole, and one it holds in parts grows by parts. Sizes are
read only for a newly demanded country neither held whole nor in parts.

### Override file

`config/place-regions.json` lists region IDs, Geofabrik IDs with `/` as `-`:

```json
{
  "include": ["iceland"],
  "exclude": []
}
```

`include` adds a country or a part of one (not a continent). `exclude` wins
over every reason and is the only way a region leaves the catalogue: the
next publication deletes its places and its coverage (`regionsRemoved` in
the report), which can trip the 80% guard. An unknown region in either list
fails the run, and so does a live region the Geofabrik index no longer
lists, until it is excluded. The workflow reads the file from the branch it
runs on.

### Skipped regions

A newly demanded region is skipped, and named under `skipped`, on stderr
and in the workflow's job summary, when the catalogue cannot take it:

- `coverage`: adding its boundary makes the combined coverage invalid or
  brings it above 80% of the 10,000 ring vertices a coverage may hold
  (`COVERAGE_VERTEX_LIMIT`). The rest is room for boundaries that grow from
  one week to the next.
- `limit`: the catalogue already holds 256 regions
  (`MAX_CATALOGUE_REGIONS`, one `prepare` job each).

A skipped region is tried again on every run. Live and included regions are
never skipped; if they do not fit, combining or publishing fails and says
why.

### Extract date

All regions use one date: the newest of two to seven days back
(`EPOCH_DAYS_BACK`) on which every region's dated extract
(`…-YYMMDD.osm.pbf`) exists. All extracts of one day are cut from the same
planet state and carry the same `data_as_of`, as `combine` requires. Dated
files are used because `-latest` redirects some regions to a mirror, which
preparation refuses. The `.poly` boundary is Geofabrik's current one; it
has no dated copy.

### Privacy

The repository and its Actions logs are public. Tiles locate users'
activities, so they never leave the resolve process: its output and logs
name region IDs, URLs and counts only, and the publication report names
regions and places, never a tile.

### Coverage budget

A match checks an activity against the coverage boundary near it only, so
its cost does not grow with the number of regions. What is bounded is the
boundary itself: a coverage holds at most 10,000 ring vertices
(`COVERAGE_VERTEX_LIMIT`), because validating it compares every pair of
edges, and every match validates the coverage it loads. Measured from the
Geofabrik boundaries in November 2026: the eight countries of `v1-places`
have 1,835 vertices (9 ms to validate) and about 37 KB of coverage JSON;
the 45 regions that held activities then, Russia included, 6,913 (86 ms,
138 KB). All 190 countries have 35,688 vertices before shared borders are
merged, so a world catalogue needs a higher limit or a cheaper validation.

Known limits that are not addressed yet: artifacts are read whole into one
string, which bounds a catalogue at about 900,000 rows
(`MAX_CATALOGUE_ROWS`, 500 MiB), and preparation stops at 500,000 selected
sources per region.

## Publish or refresh

A catalogue is published to the Convex backend's live catalogue
(`backend/convex/livePlaces.ts`), one table of places that each publication
updates in place. Only the difference from what is live is sent, and only
activities whose match read a changed tile are matched again. Nothing else
stores the catalogue.

The publisher reads the live catalogue through `/internal/places/v1` and
writes through `/internal/places/write/v1`, each with a key of the
catalogue's own that can neither read nor write a library. A dry run needs
only the read key: `ACTIVITYMAP_CONVEX_SITE`, `ACTIVITYMAP_PLACES_KEY_ID`
and `ACTIVITYMAP_PLACES_SIGNING_KEY`, a key ID listed in the deployment's
`ACTIVITYMAP_BRIDGE_PLACES_KEYS`. `--apply` also needs the write key,
`ACTIVITYMAP_PLACES_WRITER_KEY_ID` and `ACTIVITYMAP_PLACES_WRITER_SIGNING_KEY`,
a key ID listed in `ACTIVITYMAP_BRIDGE_PLACES_WRITER_KEYS`. The catalogue
belongs to no account, so no user is named.

```sh
pnpm places:publish --artifact <dir> [--report <file>] [--region <region>]
pnpm places:publish --artifact <dir> --apply --expect-current <snapshot-id|none> \
  [--allow-large-retirement] [--replace-pending <snapshot ID>] \
  [--report <file>] [--region <region>]
```

Default execution is a dry run: it reads the live row hashes, diffs them with
the artifact and writes nothing. When reviewed, apply with the current
snapshot ID the report showed, or `none` when nothing was published yet:

```sh
pnpm places:publish --artifact output/places/places-live \
  --apply --expect-current <current-snapshot-id>
```

If another catalogue became current meanwhile, publication fails and requires
a new dry run. A catalogue with fewer than 80% of the live places is flagged
and requires `--allow-large-retirement` on apply, after inspecting source
completeness. The dry run reports the coverage's size
(`coverage.vertices`); an artifact above the 10,000-vertex limit is not
valid and cannot be combined in the first place. Only an artifact of the
serving region `places-live` (`LIVE_PLACE_REGION`) is accepted; `--region`
names another one explicitly. `v1-places`, the eight-country catalogue, is
what is live until the first `places-live` publication, so it needs
`--region v1-places`. `--replace-pending` is only accepted with `--apply`.

The report is JSON on stdout (progress goes to stderr); `--report <file>`
also writes it to a file. Besides `dryRun`, true without `--apply`:

| Field                              | Meaning                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `status`                           | `unchanged`, `would_publish` or `published`                                                                                    |
| `snapshotId`, `current`            | the artifact's snapshot and the completed live one (null before the first)                                                     |
| `revision`                         | the live revision this run completed (when published)                                                                          |
| `count`, `liveCount`               | places in the artifact (without hidden ones) and live now                                                                      |
| `hidden`, `hiddenByReason`         | places the noise filter hides, by `hidden_reason`                                                                              |
| `sourceDataAsOf`                   | the artifact's source timestamp                                                                                                |
| `changes`                          | `inserts`, `updates`, `moved` (updates to another tile), `deletes`, `unchanged`                                                |
| `examples`                         | up to 5 inserts, updates and deletes                                                                                           |
| `coverageChanged`, `affectedTiles` | whether the coverage changed, and how many tiles are matched again (a count only; tiles are never printed: logs may be public) |
| `largeRetirement`                  | fewer than 80% of the live places                                                                                              |
| `pending`                          | an unfinished publication: `snapshotId`, `startedAt`, `ageMinutes`                                                             |
| `coverage`                         | what every match reads: `polygons`, `vertices` (at most 10,000) and `metadataBytes` (manifest and coverage file)               |
| `regions`                          | the artifact's component regions                                                                                               |
| `regionsAdded`, `regionsRemoved`   | regions the artifact has and the live catalogue lacks, and the reverse                                                         |

`unchanged` means no row changes, no coverage change and nothing pending. It
writes nothing, also with `--apply`, even when the snapshot ID differs.

An interrupted apply is finished by running the same command again, with the
same `--expect-current` as the first time: the completed snapshot has not
changed yet. A different pending publication refuses until it is finished or
abandoned with `--replace-pending <its snapshot ID>`; publishing the previous
artifact that way is the rollback of a half-applied one. Publishing an older
artifact is the rollback of a completed one.

## Refresh behavior

- A place's ID is derived from its OpenStreetMap object (`placeId` in
  `src/server/places/catalogue-publish.ts`): a name-based UUID of
  `<osm_type>/<osm_id>`. The same object has the same ID in every catalogue,
  so no store has to remember IDs between publications. Nodes and ways with
  the same number remain distinct. A representation replaced by a different
  OSM object is a new place; there is no name or proximity merging.
- The places sent are the artifact's rows that the noise filter does not
  hide. A place that is missing from a newer catalogue is deleted.
- An apply announces the row count and an order-independent digest of the
  rows, sends at most 500 changes a call, and completes only when the live
  rows have reached both. Each completed publication counts the live
  `revision` up.
- On completion every activity whose match read a changed tile (the old and
  new tile of each changed place, and the tiles where the coverage changed)
  is matched again in the background, without reading the provider. Its old
  match stays visible until the new one arrives. A match that ran while the
  publication was being applied is matched again too.
- Matches read the coverage of the last completed publication, never of a
  pending one.
- After a deployment that changes the matching recipe, run
  `convex run catalogueWorker:adopt` in `backend/` to match every library
  again under the new recipe.

### Cutover from rowsets

Before the live catalogue, each publication was a new immutable rowset and
moved every library to it. Deploying the live catalogue changes nothing until
its first publication. Then, in this order:

1. `pnpm places:publish --region v1-places` the current `v1-places`
   artifact. The live table is empty, so this is a full insert. New
   libraries start on the live catalogue from then on; existing ones keep
   matching against their rowset.
2. `npx convex run catalogueWorker:adopt` in `backend/`: one full re-match
   that moves every library to the live catalogue and records the tiles of
   every match. It costs about as much as one rowset publication did.
3. Compare the matches of a sample of libraries with those before.
4. `npx convex run places:dropRowsets` deletes the rowsets and their files,
   continuing by itself until none are left. It refuses (`not_adopted`)
   before step 1 and until step 2 has moved every library.

Before step 4, rollback means redeploying the previous version, which still
serves from the rowsets. After the cutover, start the weekly workflow as
described under [First run](#first-run).

## Weekly refresh workflow

`.github/workflows/places-refresh.yml` rebuilds the catalogue from the week's
Geofabrik extracts and publishes the difference. It runs on Mondays at 03:17
UTC once enabled, and by hand (`workflow_dispatch`). Runs never overlap
(concurrency group `places-refresh`), also while one waits for its reviewer.

| Job       | Environment         | What it does                                                                                                                                                                                                                                            |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve` | `places-read`       | `pnpm places:resolve`; writes the regions, why each is there, the added and the skipped regions to the job summary                                                                                                                                      |
| `prepare` | none                | one matrix job per region, at most four at a time (each reads Copernicus); a region whose runner Geofabrik refuses fails within minutes and is re-run alone: `pnpm places:prepare` from the dated URLs; artifact `places-region-<region>`, kept 14 days |
| `combine` | none                | `pnpm places:combine --region places-live` over every region; artifact `places-live-<date>`, kept 90 days for rollback                                                                                                                                  |
| `plan`    | `places-read`       | dry run with the read key, `--report report.json`; the report goes to the job summary                                                                                                                                                                   |
| `apply`   | `places-production` | waits for the reviewer, then publishes with `--apply --expect-current` from the plan; skipped when the plan says `unchanged`                                                                                                                            |

`prepare` fails fast: one failed region fails the run before anything is
published. `plan` fails when the report flags `largeRetirement` (the
workflow never passes `--allow-large-retirement`).

The repository and its logs are public. Jobs print region IDs, counts and
place diffs only ([Privacy](#privacy)).

### Setup

Two GitHub environments, each with the variable `ACTIVITYMAP_CONVEX_SITE`
and the secrets of the catalogue's read key, `ACTIVITYMAP_PLACES_KEY_ID` and
`ACTIVITYMAP_PLACES_SIGNING_KEY`:

- `places-read`, without reviewer: enough to resolve regions and to dry-run
  a publication.
- `places-production`, with a required reviewer, additionally holds
  `ACTIVITYMAP_PLACES_WRITER_KEY_ID` and
  `ACTIVITYMAP_PLACES_WRITER_SIGNING_KEY`, the catalogue's write key.

The Convex deployment holds `ACTIVITYMAP_BRIDGE_PLACES_KEYS` and
`ACTIVITYMAP_BRIDGE_PLACES_WRITER_KEYS`, each a JSON object of key ID →
64-hex secret, like the other key maps (`backend/README.md`); the read key
ID must be listed in the first and the write key ID in the second. Neither
key can read or write a user's library, and the app's keys are refused on
the catalogue's routes, so either side can be revoked without touching the
other.

### Run it by hand

```sh
gh workflow run places-refresh.yml -f demand=false
gh workflow run places-refresh.yml -f demand=true -f date=261122
```

`demand` (default on) adds the regions that hold activities; off keeps the
live regions and the overrides only. `date` pins the extract date (`YYMMDD`);
by default it is the newest every region has.

### Enable the schedule

The scheduled run does nothing until the repository variable
`PLACES_REFRESH_SCHEDULED` is `true`:

```sh
gh variable set PLACES_REFRESH_SCHEDULED --body true
```

Scheduled runs always use demand. Set the variable to anything else to pause
them.

### First run

After the [cutover](#cutover-from-rowsets), with the setup above in place:

1. Run the workflow by hand with `demand` off. It rebuilds the live regions
   as `places-live`, which should be a no-op or a small diff against
   `v1-places`.
2. Run it with `demand` on and review the added regions.
3. Set `PLACES_REFRESH_SCHEDULED`.

### Review

The reviewer approves the `apply` job's deployment after reading two job
summaries:

- `resolve`: the regions with their reasons, the added ones and the skipped
  ones with why.
- `plan`: the report ([Publish or refresh](#publish-or-refresh)). Check
  `changes` and `examples` against what a week of OpenStreetMap edits
  should do, `regionsAdded` and `regionsRemoved` against the resolve
  summary, `hiddenByReason` for a filter change, `coverage.vertices` against
  the 10,000 limit, `affectedTiles` for the size of the re-match, and that
  `pending` is null.

Rejecting the deployment changes nothing.

### When a run fails

A run that fails before `apply`, or whose deployment is rejected, leaves the
live catalogue unchanged. An `apply` interrupted partway leaves a pending
publication: re-run the failed job (Re-run failed jobs, approved again),
which publishes the same artifact with the same `--expect-current` and sends
only what is still missing. Until it is finished, later runs fail at
`apply`, because a different artifact is pending; finish it, or abandon it
by hand with `--replace-pending <its snapshot ID>`. GitHub's failure
notification is the alert.

### Roll back

Publishing an earlier catalogue reverts a newer one. Download the kept
`places-live-<date>` artifact of an earlier run and publish it by hand:

```sh
gh run list --workflow places-refresh.yml
gh run download <run ID> --name places-live-<date> \
  --dir output/places/places-live-<date>
pnpm places:publish --artifact output/places/places-live-<date>
pnpm places:publish --artifact output/places/places-live-<date> --apply \
  --expect-current <current-snapshot-id>
```

The artifacts are kept for 90 days. A rollback that removes regions may need
`--allow-large-retirement`. To revert a half-applied publication, publish
the previous artifact with `--replace-pending <the pending snapshot ID>`.

## Noise filter: OSM roads and terrain

The OSM selectors include noise: local road crossings of low hills tagged as
passes (Regensberger Pass, Sternenbergpass) and Alm huts and restaurants tagged
as `tourism=alpine_hut`. Since `osm-places-v2`, preparation applies one
versioned rule set to passes and huts in all countries. It uses OSM data plus a
single terrain number, so it scales worldwide without national gazetteers or
elevation models. Peaks are never hidden.

Hidden places stay in the artifact, with their filter
inputs and a `hidden_reason`, so publication keeps their UUIDs and references.
Candidate discovery and the batch matching catalogue skip them. A new filter
policy or terrain method changes the catalogue snapshot identity, so existing
activity results become stale and are rematched without the hidden places:
visits already matched to a now-hidden place disappear too.

### Rules

`PLACE_FILTER_POLICY` in `src/server/places/place-filter.ts` holds every
threshold, road class and pattern; its version and hash are bound in the
manifest under `terrain`. A `wikipedia` or `wikidata` tag keeps any place
(Ornpass has only Wikidata).

| Kind | Hidden when                                                                                                          | `hidden_reason`     |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Pass | name is only an elevation or a generic word (`q. 2699`, `P2650`, `1557`, `Forcella`, `Joch`, `sea`)                  | `generic_pass_name` |
| Pass | on a minor road (tertiary, unclassified, residential, service, living street), on no main road, and `amp` below 60 m | `low_relief_pass`   |
| Hut  | no club operator, no info tag, and an Alm, Malga, Casera, Baita, restaurant, inn, forestry or hunting name           | `non_mountain_hut`  |

Preparation stores the sorted `highway` values of every OSM way through a pass
node as `pass_highways`. A pass on a motorway, trunk, primary or secondary road
is a through route and kept whatever the terrain (Furkapass, Ricken). Passes on
trails or on no way at all are kept: most of them are real cols, and their road
context cannot tell them apart. That includes Forch, a standalone
`natural=saddle` next to its road, which stays visible.

Club operators match SAC, CAS, DAV, ÖAV, Alpenverein, CAI, Club Alpino, AVS,
Naturfreunde, SAT, DNT, DOC, NZAC, CAF and similar. Info tags are capacity,
beds, website, contact:website, url, phone, contact:phone, reservation,
opening_hours, wikipedia and wikidata. Missing terrain never hides a place.
Same-name passes within 1 km are one pass: if any node is kept, all are. A
place with several kinds is hidden only when every kind is hidden. Combining
recomputes decisions over the combined rows, since a same-name group can cross
a country border.

### Terrain

Only passes whose decision needs it are measured: about one pass in fifteen,
and no peaks. Preparation reads [Copernicus GLO-30](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model)
cloud-optimized GeoTIFFs from `https://copernicus-dem-30m.s3.amazonaws.com/`
with HTTP range requests, using the pinned `geotiff` package. Only the internal
1024 × 1024 blocks around those passes are fetched and decoded, with a bounded
in-memory cache; nothing is written to disk. Missing 1° tiles (HTTP 404) are
sea and give no amp. Every other failure is retried for about four minutes and
then fails the preparation, so a network problem cannot silently become "no
terrain". The DEM is a surface model (forest canopy included) on a 1
arc-second grid with pixel-is-point registration.

The **pass amplitude** (`pass_amp_m`) samples circles of 200, 400, 800, 1,500
and 2,500 m around the node, 72 bilinear samples each, relative to the DEM
height at the node. Per circle, `rise` is the second-highest maximum among the
arcs above the node (two flanks), `drop` the second-deepest arc below it (two
valleys), and `amp = min(rise, drop)`. The best circle wins. A road over a
plain slope scores zero. Amps are rounded to decimetres. The parameters are
`TERRAIN_METHOD` in `src/server/places/terrain.ts`; its version and hash are
recorded in the manifest with the DEM URL and attribution.

### Why these rules

The rules were chosen against the Swiss and Austrian gazetteer decisions of the
per-country prominence research (draft PR #472), which needed national lidar
models and about 15 GB per country. Alternatives that were measured and
rejected:

| Pass rule (CH research decisions: 179 hide)            | Noise caught | Real passes hidden |
| ------------------------------------------------------ | -----------: | -----------------: |
| `amp` below 60 m on a minor road (shipped)             |           39 |                 17 |
| `amp` below 60 m below 1,200 m elevation               |           49 |                 47 |
| `amp` below 60 m where relief within 2.5 km is < 500 m |           45 |                 31 |
| no key col of a ≥ 30 m prominent peak within 250 m     |          115 |                481 |
| no `ele` and no pass word in the name                  |            5 |                 28 |

The elevation cutoff was fitted to the Alps and hid a third of the passes in
Germany and Norway and a fifth in France, mostly named cols. Local relief
moved the cutoff but kept one. Key cols from Andrew Kirmse's worldwide
prominence list on the same DEM cannot tell Forch from a real saddle: Forch is
the key col of an 89 m prominent hill. Name and tag rules alone hide more real
passes than noise. Road class is the only signal that separated the Plateau
crossings without a fixed number in metres.

A 30 m peak prominence rule would have hidden 43% of peaks, including 92 of 432
peaks visited in local development data, mostly familiar local hills and named
shoulders. Peak noise is milder than pass noise and a wrongly hidden summit
costs more than a kept bump, so peaks are not filtered and not measured.

### Measured run (2026-11-01)

The eight `v1-places` countries were prepared from the 30 October extracts on
one laptop, all eight in parallel, reading Copernicus over the network:

| Country     | Places | Passes hidden | Huts hidden | Road passes measured | DEM tiles / blocks |  Time |
| ----------- | -----: | ------------: | ----------: | -------------------: | -----------------: | ----: |
| Switzerland | 11,347 |     59 (2.4%) |   39 (4.6%) |                   68 |             8 / 49 |  2:57 |
| Austria     | 21,953 |     10 (0.4%) | 298 (18.9%) |                   18 |             8 / 21 |  3:22 |
| Italy       | 49,638 |    275 (3.4%) | 388 (12.0%) |                  470 |           50 / 243 | 12:16 |
| Germany     | 38,371 |     34 (5.1%) |    9 (1.6%) |                   51 |            24 / 43 | 15:54 |
| France      | 31,222 |    478 (7.2%) |   28 (1.6%) |                  936 |           63 / 348 | 23:58 |
| Norway      | 16,548 |      5 (2.8%) |    4 (0.4%) |                    3 |              5 / 6 |  5:05 |
| New Zealand |  9,841 |     50 (6.3%) |    3 (0.2%) |                    5 |              5 / 7 |  1:50 |
| Kyrgyzstan  |  4,201 |     12 (0.4%) |    1 (2.1%) |                   34 |            18 / 40 |  1:07 |

Times are dominated by the four streaming passes over each PBF; terrain reads
are a few hundred blocks per country. Every road pass that needed terrain got
it. Against the research decisions the Swiss rule catches 39 of 179 hides and
hides 17 kept passes (99.3% of gazetteer passes kept); Austria 6 of 489 and 4
(99.9% kept). Regensberger Pass (both nodes), Sternenbergpass and Talhöchi are
hidden; Forch, Buchenegg, Hulftegg, Ornpass, both Ricken nodes and Furkapass
are kept. New Zealand's hidden passes are mostly elevation-only names (`1212m`).

### Compatibility

`osm-places-v1` artifacts and manifests stay readable: they have no `terrain`
section and no filter counts, and every place is listed.
`counts.filter` in the manifest reports hidden places by kind and reason and
the road passes without terrain. Publication reports count hidden places by
reason.

Attribution: © DLR e.V. and Airbus, Copernicus programme. The Copernicus DEM is
free to use with this attribution; the map layers that show places carry it
next to the OSM attribution.

## Node preparation implementation

The PBF reader streams bounded file blocks and supports raw and zlib compression,
sparse/dense nodes, packed/unpacked fields, exact 64-bit IDs and delta references,
metadata timestamps and coordinate offsets. Unknown required features,
history extracts, unsupported compression, truncated input, invalid parallel
arrays and oversized blocks fail preparation. Contributor identities are not
emitted. The reader follows the [official OSM PBF schemas](https://github.com/openstreetmap/OSM-binary/tree/master/osmpbf).

Only selected place sources and required hut member ways/node positions are
retained between passes. There is no complete node-location index. Preparation
limits selected sources to 500,000 and 256 MiB of serialized source data
(Spain, the largest region measured, selects 100,097 of 25 MB), and hut
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

## Switzerland, Austria and Italy (`ch-at-it`)

The first combined serving catalogue, `ch-at-it`, was built from the three
complete country extracts. It is replaced by `v1-places` (below); the workflow
is the same. Prepare each country separately; their download URLs are read
from the Geofabrik index:

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
excluding downloads and publication. These are measured local timings,
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

## Eight countries (`v1-places`)

`v1-places` replaces `ch-at-it` with Switzerland, Austria, Italy, Germany,
France, Norway, New Zealand and Kyrgyzstan. Prepare each country from
extracts with the same source epoch, then combine:

```sh
pnpm places:prepare --region germany --out output/places/germany-current
# ... the other seven countries
pnpm places:combine --region v1-places \
  --input output/places/switzerland-current ... \
  --out output/places/v1-places-current
```

Geofabrik's `-latest` files can move to a new epoch between downloads; pin the
dated files (`europe/germany-261030.osm.pbf`) when the countries are fetched
over several hours. Each extract only contains the roads inside it, so a pass
on a border can list different roads per country; combining merges them and
recomputes the filter. Other filter inputs and all OSM fields must still agree.

Publish the combined artifact as described under
[Publish or refresh](#publish-or-refresh), with `--region v1-places`. It is
live until the first `places-live` publication, which the weekly workflow
builds from the regions it resolves.

### Measured eight-country catalogue

The 30 October extracts (`2026-10-30T21:24:51Z`) combine in 9 seconds to
**178,151 places** (145,021 peaks, 23,019 passes, 10,122 huts; 97 MB), with
4,953 shared border sources removed. 1,673 are hidden: 191 generic pass names,
722 low-relief road passes and 760 non-mountain huts; 176,478 are listed. The
artifact is `output/places/v1-places-2026-10-30`, snapshot
`osm-places-v1:138fead059c8543ef5ff58ccb921a7d10a6353d04c982067f766f65cd4e412a0`.
