# Place catalogue preparation and refresh

The places v1 catalogue is independent of activity ingestion. Prepare a complete
regional snapshot without database access, then publish that exact artifact with
a separate command. Both commands can run locally; a future CI job can use the
same entry points. Nothing runs automatically when the web application starts.

## Where the catalogue lives

Preparation and combination have no database access: they turn OpenStreetMap
extracts into an artifact on disk. Publication sends that artifact to the
Convex backend (`backend/convex/places.ts`), which matches activities against
it. The measured runs further down record extraction timings and counts.

Publication is not automatically undone, and libraries only ever move to the
newest complete rowset. Keep the input artifacts: going back to an earlier
catalogue means publishing it again as a new artifact.

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
and `--poly /path/to/coverage.poly`. The V1 countries in
`src/server/places/catalogue-regions.ts` have predefined URLs; other regions
require `--source-url` and `--coverage-url`. Downloads are restricted to HTTPS
`download.geofabrik.de` URLs, following only redirects that stay on that host
(`-latest` redirects to the dated extract). Terrain is always read from
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

A catalogue is published to the Convex backend, where activities are matched
against it. Nothing else stores it.

The publisher signs its requests with the write bridge key. It needs
`ACTIVITYMAP_CONVEX_SITE`, `ACTIVITYMAP_CONVEX_WRITER_KEY_ID` and
`ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY` in the operator's environment, and
the user and athlete ID of an account whose bridge scope signs the requests
(use an administrator; the catalogue belongs to no account).

```sh
pnpm places:publish --artifact output/places/v1-places-current \
  --user <user ID> --athlete <athlete ID>
```

Default execution is a dry run. It reports the proposed snapshot ID, its
source timestamp, how many places would be sent and how many the filter
hides, and the catalogue that is current now. It writes nothing. When
reviewed, publish with the current snapshot ID the report showed, or `none`
when nothing was published yet:

```sh
pnpm places:publish --artifact output/places/v1-places-current \
  --user <user ID> --athlete <athlete ID> \
  --apply --expect-current <current-snapshot-id>
```

If another catalogue became current meanwhile, publication fails and requires
a new dry run. A catalogue with fewer than 80% of the current number of
places is flagged in the dry run and requires `--allow-large-retirement` on
apply, after inspecting source completeness. Only an artifact of the serving
region (`v1-places`) is accepted; `--region` names another one explicitly.

## Refresh behavior

- A place's ID is derived from its OpenStreetMap object (`placeId` in
  `src/server/places/catalogue-publish.ts`): a name-based UUID of
  `<osm_type>/<osm_id>`. The same object has the same ID in every catalogue,
  so no store has to remember IDs between publications. Nodes and ways with
  the same number remain distinct. A representation replaced by a different
  OSM object is a new place; there is no name or proximity merging.
- The places sent are the artifact's rows that the noise filter does not
  hide. A place that is missing from a newer catalogue is simply not in it.
- A rowset is one snapshot under one row format (`PLACE_ROWS_VERSION`). It is
  sent in ID order, 500 places a call, and accepted only when its row count
  and digest agree with the publisher's; nothing reads it before. An
  interrupted publication is finished by running the same command again.
- A repeated identical artifact sends nothing and moves no library.
- Once the rowset is complete, every library moves to it
  (`catalogueWorker.adopt`): its old matches are hidden at once, and each
  recording is matched again in the background, about eight a second per
  library, without reading the provider.
- Libraries follow the newest complete rowset. A rowset that was complete
  before a newer one cannot become current again; publish a new artifact
  instead.
- After a deployment that changes the matching recipe, run
  `convex run catalogueWorker:adopt` in `backend/` to match every library
  again under the new recipe.
- Superseded rowsets are not removed yet.

## Noise filter: OSM roads and terrain

The OSM selectors include noise: local road crossings of low hills tagged as
passes (Regensberger Pass, Sternenbergpass) and Alm huts and restaurants tagged
as `tourism=alpine_hut`. Since `osm-places-v2`, preparation applies one
versioned rule set to passes and huts in all countries. It uses OSM data plus a
single terrain number, so it scales worldwide without national gazetteers or
elevation models. Peaks are never hidden.

Hidden places stay in the artifact and the `places` table, with their filter
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
section and no filter counts, and every place is listed. Already published v1
catalogues keep serving until a v2 artifact is published.
`counts.filter` in the manifest reports hidden places by kind and reason and
the road passes without terrain. Publication dry runs list up to 20 hidden
examples.

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

## Switzerland, Austria and Italy (`ch-at-it`)

The first combined serving catalogue, `ch-at-it`, was built from the three
complete country extracts. It is replaced by `v1-places` (below); the workflow
is the same. Prepare each country separately; all three have predefined
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
France, Norway, New Zealand and Kyrgyzstan (`V1_PLACE_COUNTRIES` in
`src/server/places/catalogue-regions.ts`, with their Geofabrik paths). Prepare
each country from extracts with the same source epoch, then combine:

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

Publish the combined artifact as described under [Publish or refresh](#publish-or-refresh).

### Measured eight-country catalogue

The 30 October extracts (`2026-10-30T21:24:51Z`) combine in 9 seconds to
**178,151 places** (145,021 peaks, 23,019 passes, 10,122 huts; 97 MB), with
4,953 shared border sources removed. 1,673 are hidden: 191 generic pass names,
722 low-relief road passes and 760 non-mountain huts; 176,478 are listed. The
artifact is `output/places/v1-places-2026-10-30`, snapshot
`osm-places-v1:138fead059c8543ef5ff58ccb921a7d10a6353d04c982067f766f65cd4e412a0`.
