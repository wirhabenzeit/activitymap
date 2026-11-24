# Plan: incremental place catalogue refresh

Status: PR 1 (the incremental catalogue) has shipped and is described in
[place-catalogue-refresh.md](place-catalogue-refresh.md#publish-or-refresh)
and `backend/README.md` ("Place catalogue"); the cutover is
[#609](https://github.com/wirhabenzeit/activitymap/issues/609). PR 2
(automation and demand-driven regions) has shipped too, except removing the
rowset tables, which follows the cutover in a separate PR; the commands are
in [place-catalogue-refresh.md](place-catalogue-refresh.md#choose-the-regions)
and its [weekly workflow](place-catalogue-refresh.md#weekly-refresh-workflow)
section. Together they replace the immutable-rowset publication so the
catalogue can be refreshed automatically every week. Where a PR ended
differently from this plan, the sections below say so.

## Problem

Every publication today is a new immutable rowset (`places` rows keyed by
`dataset`), so any change in OpenStreetMap:

- writes all ~176k places again (superseded rowsets are never removed), and
- moves every library to the new catalogue (`catalogue.adopt` →
  `catalogue.next`), which hides every match and re-matches every recording
  at about eight a second per library.

A monthly refresh in which a few hundred places change costs the same as the
first publication. That rules out automation.

## Target

One live places table. A publication writes only the difference from what is
live. Only recordings that pass through a changed tile are matched again.
Their old matches stay visible until the new ones arrive.

```
artifact ──diff against live hashes──► upserts + deletes ──► changed tiles
                                                                 │
                             activityPlaceTiles (tile → activity) ▼
                                             requestMatch for those activities
```

Place IDs are already stable across catalogues (`placeId` = UUID of
`<osm_type>/<osm_id>`), so the difference is a plain set comparison by ID.

## Data model (Convex)

### `livePlaces` (replaces `places`)

| Field      | Notes                                                     |
| ---------- | --------------------------------------------------------- |
| `key`      | place ID                                                  |
| `tile`     | `tileOf(location)`                                        |
| `place`    | `PlaceRow`, as today                                      |
| `hash`     | SHA-256 of the row's canonical form (as in `chainDigest`) |
| `revision` | catalogue revision that last wrote the row                |

Indexes: `by_key`, `by_tile_key`. `tilePage` reads `by_tile_key` without a
dataset.

### `placeCatalogueState` (singleton, replaces `placeCatalogues` for serving)

- `revision`: integer, bumped once per completed publication.
- `snapshotId`: the artifact last applied completely (for `--expect-current`
  and for `catalogueSnapshotId` in match results).
- `metadata`: storage ID of the manifest and coverage, as today.
- `count`, `setDigest`: row count and an order-independent digest of the
  live rows (sum or XOR of row hashes, mod 2²⁵⁶), maintained by every write.
  This replaces the import chain digest as the integrity check.
- `pending`: `{ snapshotId, revision, metadata, startedAt }` while a
  publication is being applied, otherwise absent.

### `placeTileChanges`

`{ revision, tile }`, written by every upsert and delete: the old and the new
tile for a moved place. On completion it lists the tiles to re-match.
As shipped, the walk deletes each tile's row once it has finished the tile,
so the rows left are its unfinished work, and a daily job
(`maintenance.resumeRematchWalks`) restarts the walk of a completed revision
that still has rows. Nothing deletes rows a walk has not reached.

### `activityPlaceTiles`

`{ owner, activity, tile }` with index `by_tile_owner`. Written in
`ingestion.matched`, replacing the activity's previous rows, from the tile
set `readMatchingTiles` already computes. It includes the discovery-radius
buffer, so a place that moves into reach of a track is caught. The budget is
256 tiles per activity (enforced today). Expect a handful of rows per
activity. Deleted activities drop their rows.

### Activity match projection

`projection.match` gains `revision` (the catalogue revision the match read
at its start). `matchingVersion` and `owner.catalogue` go back to identifying
the **recipe and the live lineage** only, not the place rows or the
coverage. They change only when a full re-match is really needed.

As shipped, the lineage is a constant, `LIVE_CATALOGUE`
(`{ snapshotId: 'places-live', revision: 'live-rows-v1' }` in
`src/server/places/catalogue-rows.ts`), and the live matching version is
`matchingVersion(LIVE_CATALOGUE)`. A stored match's `revision` tells live
from rowset matches: 1 or more is the live revision it read, 0 or absent a
rowset.

## Publication protocol

The publish command keeps its shape and guards (dry run by default,
`--expect-current`, the 80% retirement check).

1. **Read live hashes.** Page through `livePlaces` (`key`, `hash`, `tile`)
   over the write bridge (since PR 2, the read-only route
   `/internal/places/v1`): ~176k short rows, a few MB.
2. **Diff locally.** Compare with the artifact's listed rows to get inserts,
   updates, deletes and the affected tiles. The dry run reports these counts,
   examples and the tile count. When nothing differs and the coverage is
   unchanged, the command exits without writing.
3. **`beginApply`** with `expectCurrent`, the new `snapshotId`, the metadata
   file and the expected final `count` and `setDigest`. It refuses when
   `snapshotId` is not the expected current one, or when another `pending`
   publication for a different artifact exists. The same artifact resumes.
4. **`applyBatch`** of up to 500 operations (upsert or delete). Each one is
   idempotent: an upsert whose hash already matches does nothing. Each write
   updates `count` and `setDigest` and records `placeTileChanges` for the
   pending revision.
5. **`completeApply`** checks `count` and `setDigest` against the values
   announced in step 3. It then sets `revision`, `snapshotId` and `metadata`,
   clears `pending`, and schedules the re-match walk for the revision.

An interrupted publication is finished by running the same command again.
The diff in step 1 then only contains what is still missing. Rolling back
means publishing the older artifact: its diff reverts the change.

### Consistency during an apply

Matching may read a mix of old and new rows while batches are written. That
is acceptable because the re-match walk fixes it:

- a match records the `revision` that was current when it **started**;
- the walk re-matches every activity in a changed tile whose match revision
  is below the completed one.

A match that overlapped the apply therefore always runs again.

### Coverage changes

Coverage decides whether a track section gets "outside coverage" instead of
matches. With demand-driven regions (below), coverage grows regularly, so it
must not force a full re-match. The publisher diffs the old and new coverage
polygons and adds every tile intersecting the added or removed area to
`placeTileChanges`. The re-match walk then treats them like tiles with changed
places. Matching reads coverage from the pending metadata only after
`completeApply`, so a match never sees the new coverage with old rows.
`completeApply` deletes the replaced metadata file; a match that was about to
read it fails as retryable and its retry reads the new one.

Only a matching-recipe change takes the full path: a new `owner.catalogue`
and matching version, then `catalogue.adopt` (as today's
`convex run catalogueWorker:adopt`).

## Demand-driven regions

The catalogue covers wherever users have activities, not a fixed list of
eight countries (formerly `V1_PLACE_COUNTRIES`).

### Unit: Geofabrik extracts, country by default

Regions are Geofabrik extracts, read from Geofabrik's machine-readable index
(`https://download.geofabrik.de/index-v1.json`: ID, parent, PBF and `.poly`
URLs and a boundary polygon for every extract). That replaces the hard-coded
paths in `src/server/places/catalogue-regions.ts`. Downloads stay restricted
to `download.geofabrik.de`.

The rule: use the **country extract**. Go one level down only when the
country is larger than a size cap, for example US states or Canadian
provinces. A finer unit than country buys little. Places are tiny compared
with the PBFs, and smaller units add more seams where a track leaves coverage
at an internal border. The size cap only keeps each prepare job within one
runner's disk and time limit.

As shipped, the cap is about 6 GB (`REGION_SIZE_CAP_BYTES`), not 5: it
splits only the United States and Canada and keeps France (5.12 GB),
Germany (4.89 GB) and Russia (4.21 GB) whole. Russia was an example of a
split country here; at its size it fits one runner. A split country is
taken as the sub-extracts that hold demand, and the choice is sticky: a
country held whole stays whole, one held in parts grows by parts.

### Which regions are wanted

`activityPlaceTiles` already says which quarter-degree tiles hold activities,
for every track and not only start points. A track that crosses into a
neighbouring country therefore pulls in that country too.

- A Convex query returns the tiles that hold activities, with no owners or
  activity IDs.
- The region selection maps tiles to Geofabrik extracts by the index
  polygons, using the rule above.
- A region needs a minimum demand, so one stray GPS point does not pull in
  a continent's worth of extract.
- **Regions are sticky.** A region that is in the catalogue stays when its
  demand disappears (a deleted account, for instance). Removal is a manual
  decision; otherwise places would churn in and out.

As shipped:

- The query is `livePlaces.demandTiles`, read over the read-only route
  `/internal/places/v1`. It answers each tile with the number of activities
  whose match read it.
- A region is demanded when one tile intersecting it holds at least two
  activities (`DEMAND_MIN_ACTIVITIES`).
- Demand comes from `activityPlaceTiles` only. Activities without a match
  do not contribute a start tile, unlike planned: a match outside the
  coverage still records the tiles of its track, so the only activities
  missing are those without a usable track or over the match budget, and
  those not matched yet, which count from the first run after their match.
- There is no `placeRegions` table. The wanted regions are the regions of
  the live manifest, plus the demanded regions, plus `include`, minus
  `exclude` from the committed `config/place-regions.json`. The live
  manifest already records what the catalogue holds, and manual changes go
  through review in git; a second store would have to be kept in step.
  Removal is only by `exclude`.
- A newly demanded region the catalogue cannot take is skipped and named
  (`servableRegions`), so it cannot stop the refresh of the others: one
  whose boundary makes the combined coverage invalid (a ring wider than half
  the globe; Russia today) or brings it above 80% of the 500,000-edge
  budget of a match, and any beyond 256 regions. Live and included regions
  are never skipped. This was not in the plan; the coverage limits only
  showed when measured.
- All regions use one extract date: the newest of two to seven days back
  that every region has, so all share one `data_as_of`.

Measured: the eight current countries are 67,986 coverage edges (14% of the
budget) and about 37 KB of coverage JSON, 45 European countries 88,355
(18%), and all 190 countries would be 686,531 (37% over).

### Privacy in a public repository

The repository and its Actions logs are public. Tiles never leave the
resolve process (`pnpm places:resolve`): the workflow logs, job summaries
and uploaded artifacts contain only region IDs, counts and place diffs. A
region name reveals at most that someone has an activity in that country,
which is acceptable for the country unit. Finer units would reveal more,
which is another reason to stay at country level.

### Workflow changes

`resolve` first works out the wanted regions, then emits one `prepare`
matrix entry per region. GitHub allows 256 matrix jobs per workflow and 20
concurrent jobs for a free public repository, which is plenty of headroom.
`combine` takes the dynamic list. The combined region ID becomes
`places-live`. Adding a region is then an ordinary publication: many
inserts, a coverage diff, and a partial re-match of exactly the activities
in the new area.

As shipped, `resolve` reads the live manifest's regions and the demand tiles
with the read key, not a stored list; a catalogue holds at most 256 regions
(`MAX_CATALOGUE_REGIONS`, one `prepare` job each), and `prepare` runs at
most four jobs at a time, because each reads Copernicus terrain tiles.

A new user in a new country waits for the next weekly run. If that turns out
too slow, Convex can trigger the workflow early (`repository_dispatch`, with
a fine-grained token limited to Actions on this repository) when demand for
an uncovered region appears. This is not built.

## Re-match walk

`catalogue.rematchTiles({ revision })`, paged and paced like `catalogue.next`:

1. Page through `placeTileChanges` for the revision.
2. For each tile, page `activityPlaceTiles.by_tile_owner`, deduplicate per
   activity, and skip owners that do not ingest (`ingests(owner)`) or whose
   writer is not Convex.
3. Call `requestMatch` for activities whose `match.revision` is 1 or more
   and below the revision. `nextTarget` must accept a stale revision as a
   reason to match, not only a different `catalogue`.
4. Keep `REMATCH_PAUSE_MS` pacing so a large diff does not flood ingestion.

As shipped, the walk consumes the tile rows (see `placeTileChanges`), so its
cursor is only a position within the first tile left. A match that started
before a completion and is published after the walk passed it (its tiles
were not written yet) is queued again by `ingestion.matched`. A rowset match
is never stale by revision.

Old matches are **not** cleared, unlike a full adopt. The new result replaces
the old one through `publishMatchRecord`, so clients see one sync change per
re-matched activity.

`ingestion.matched` currently drops a result whose `matchingVersion` is not
the owner's. That stays, plus: drop a result whose revision is not newer
than the activity's stored match revision (`publishMatchRecord`).

## Migration and cutover

Two PRs. The cutover was planned between them, as operator commands rather
than a deploy. As it turned out, both PRs ship before the cutover, and a
third PR removes the rowsets after it.

### PR 1: incremental catalogue (backend and publisher), shipped

- `activityPlaceTiles` and `projection.match.revision`, written in
  `ingestion.matched` and removed with deleted activities.
- `livePlaces`, `placeCatalogueState`, `placeTileChanges`, the
  `beginApply`/`applyBatch`/`completeApply` mutations and their bridge
  routes in `http.ts`.
- The diffing publisher (`src/server/places/catalogue-publish.ts`), including
  the coverage diff to tiles.
- The re-match walk (`catalogue.rematchTiles`), and `nextTarget` accepting a
  stale match revision.
- **Per-owner reader selection.** `tilePage`, `nextTarget` and
  `ingestionWorker.match` read the live table when `owner.matchingVersion` is
  the live-lineage version, and the owner's rowset otherwise. New owners are
  provisioned onto the live lineage (`latestCatalogue`, `startLibrary`) once
  `placeCatalogueState` has a completed revision. Deploying the PR therefore
  changes nothing until the first live publication, and owners not adopted
  yet keep matching consistently. As shipped, mutations cannot compute
  matching versions (`node:crypto`), so `matchTarget` hands the worker both
  the completed live publication and the rowsets, and the worker chooses;
  live tiles are read by `livePlaces.tilePage`. `places.latestCatalogue`
  answers the live lineage once a publication has completed, so
  `latestCatalogue`, `startLibrary` and `catalogueWorker:adopt` needed no
  other change.
- `publishMatchRecord` accepts a result whose `revision` is newer than the
  stored match's, not only one for a different catalogue.
- `beginApply` can abandon a pending apply (`--replace-pending`), so a bad
  artifact that failed partway can be reverted by publishing the previous
  one.
- A paged internal mutation that deletes old `places` and `placeCatalogues`
  rows and their files (`places:dropRowsets`), not run on deploy. As
  shipped, it continues by itself and refuses before a live publication has
  completed and until the latest adoption (`catalogueAdoptions`) was to the
  live lineage. It does not check every owner: owners Convex did not ingest
  for at adoption keep their rowset version until a later adoption.
- Tests for the diff, idempotent and resumable apply, digest checks, tile
  rows, partial re-match selection and the fallback.

**Cutover after deploy** (operator,
[place-catalogue-refresh.md](place-catalogue-refresh.md#cutover-from-rowsets)):

1. `pnpm places:publish` with the current artifact (`--region v1-places`
   since PR 2). The live table is empty, so this is a full insert. New
   owners start on the live table when it completes; existing owners keep
   their rowset.
2. `convex run catalogueWorker:adopt`: one final full re-match, which moves
   every owner to the live table and fills `activityPlaceTiles` for every
   activity. It costs the same as one of today's publications, once.
3. Check that a sample of libraries has the same matches as before.
4. `convex run places:dropRowsets`.

Rollback before step 4 of the cutover: redeploy the previous version, which
still serves from the rowsets.

### PR 2: automation and demand-driven regions, shipped

- The Geofabrik index reader (`src/server/places/geofabrik-index.ts`),
  replacing the hard-coded paths in `catalogue-regions.ts`, with dated
  extract URLs and one extract date for all regions.
- Region selection with the size-cap rule
  (`src/server/places/region-selection.ts`), `pnpm places:resolve` and the
  override file `config/place-regions.json`.
- `livePlaces.demandTiles`, and a read-only bridge route
  `/internal/places/v1` (`liveState`, `liveHashes`, `demandTiles`) with its
  client `src/server/places/catalogue-reader.ts`. A dry run needs only the
  read key; `--apply` also needs the write key.
- The catalogue's writes (`uploadUrl`, `beginApply`, `applyBatch`,
  `completeApply`) on a route of their own, `/internal/places/write/v1`,
  with the same client file. Both catalogue routes take only the
  catalogue's keys (`ACTIVITYMAP_BRIDGE_PLACES_KEYS`,
  `ACTIVITYMAP_BRIDGE_PLACES_WRITER_KEYS`), which can neither read nor
  write a library; the app's keys are refused there.
- The publisher defaults to the region `places-live`, refuses a coverage
  boundary above the 500,000-edge budget, reports `coverage`, `regions`,
  `regionsAdded` and `regionsRemoved`, and writes the report to a file with
  `--report`.
- Combining takes up to 256 regions, and an artifact up to 900,000 rows
  (500 MiB).
- `.github/workflows/places-refresh.yml` with demand-based region selection
  in `resolve`.
- `place-catalogue-refresh.md` and `scheduled-jobs.md`.

Where it differs from the plan:

- No `placeRegions` table (see
  [Which regions are wanted](#which-regions-are-wanted)).
- Removing the rowset tables and the `begin`/`importBatch`/`complete`
  routes moves to a separate PR after the cutover
  ([#609](https://github.com/wirhabenzeit/activitymap/issues/609)): the
  rowsets are still serving until then.
- The live catalogue's reads moved from the app's write route to a
  read-only route, so the jobs that plan and review a publication never
  hold a key that can write. Its writes moved to a route of their own too,
  and both take keys of the catalogue's own, so the workflow's secrets
  cannot read or write a user's library.

First use, after the cutover: run the workflow by hand with `demand` off
(a no-op or a small diff on the live regions), then with `demand` on, then
enable the schedule. The setup it needs first, two GitHub environments and
the deployment's `ACTIVITYMAP_BRIDGE_PLACES_KEYS` and
`ACTIVITYMAP_BRIDGE_PLACES_WRITER_KEYS`, is in
[place-catalogue-refresh.md](place-catalogue-refresh.md#setup).

Known limits not addressed: artifacts are read whole into one string, which
bounds a catalogue at about 900,000 rows, and preparation stops at 100,000
selected sources per region.

## Automation: GitHub Actions

The repository is public, so runner minutes cost nothing. This is preferred
over a launchd job on a laptop: it has no wake, disk or local-secrets
problems, it keeps logs and artifacts, and a GitHub environment can gate the
apply step.

`.github/workflows/places-refresh.yml`, weekly (and `workflow_dispatch`).
As shipped (commands and operation in
[place-catalogue-refresh.md](place-catalogue-refresh.md#weekly-refresh-workflow)):

1. **`resolve`**: choose the regions
   ([Demand-driven regions](#demand-driven-regions)) and one Geofabrik date,
   and emit dated URLs (`europe/germany-YYMMDD.osm.pbf`) for all of them, so
   the epochs agree.
2. **`prepare`**: one matrix job per region (one runner each, because the
   extracts don't fit on one runner disk), at most four at a time:
   `pnpm places:prepare --source-url … --coverage-url …`. Upload each
   artifact.
3. **`combine`**: `pnpm places:combine --region places-live`. Upload the
   result as `places-live-<date>`, kept 90 days for rollback.
4. **`plan`**, in the `places-read` environment with the read key only: the
   dry run, its report in the job summary. It fails when the 80% guard
   trips (`--allow-large-retirement` is never passed) or the coverage has
   more than 500,000 edges.
5. **`apply`**, in the `places-production` environment, which holds the
   write key and has a required reviewer: apply with `--expect-current`
   from the plan. Skipped when the plan says `unchanged`. The reviewer could
   be removed after a few clean runs.

The plan had one `publish` job holding every secret. Splitting it lets the
reviewer approve after reading the diff, and keeps the write key out of
every job before the approval.

The schedule does nothing until the repository variable
`PLACES_REFRESH_SCHEDULED` is `true`. A failed run leaves the live catalogue
unchanged, or resumable when apply was interrupted. GitHub's failure
notification is the alert.

## Open questions

- Settled: a match result's `catalogueSnapshotId` is the snapshot of the
  revision that produced that match. Clients invalidate on `matchingVersion`,
  so no client change is needed.
- `combine` recomputes hide decisions over all countries, so a filter change
  can hide many places at once. That is a normal diff with many deletes and
  needs no special case; the report lists hide-reason counts
  (`hiddenByReason`).
- The cost of the cutover's adoption (step 2) is known (today's adopt). Time
  it on the current library count before choosing a window.
- An activity matched at an older live revision counts as stale even when
  none of its tiles changed, so its next run for any other reason (an edit,
  a provider event) matches it again, without a provider read.
- Settled: the region list is not stored; it is the live manifest's regions
  plus demand plus the override file.
- Russia is demanded but skipped: its boundary has a ring wider than half
  the globe, which the combined coverage cannot hold. Covering it needs
  either coverage that accepts such rings or taking it in parts.
- The coverage budget bounds how far demand can grow: all 190 countries
  would be 37% over it.
- Catalogue size: artifacts are read whole into one string (about 900,000
  rows at most; more needs a streaming reader), and preparation stops at
  100,000 selected sources per region.
- Whether two activities in one tile is the right demand threshold, and
  whether a weekly run is soon enough for a new country
  (`repository_dispatch` above).
