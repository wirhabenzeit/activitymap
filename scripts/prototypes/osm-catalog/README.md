# Regional OSM catalogue measurements

Offline measurement tools for the [place catalogue proposal](../../../docs/activity-place-inference.md).
They read a downloaded OSM snapshot and write local audit artifacts. They do not
connect to the application database or query public OSM APIs.

## Dependencies

Use a separate Python environment. The Switzerland measurement used Python 3.14,
`osmium==4.3.2` and `shapely==2.2.0`. The field/count analyzer needs only `osmium`;
Shapely is used by the separate hut-point geometry audit.

## Count objects and inspect fields

```sh
python measure_snapshot.py /path/to/region.osm.pbf /path/to/analysis \
  --source-url https://download.geofabrik.de/europe/switzerland-261020.osm.pbf \
  --expected-sha256 8e2d91fab19a65898fa6b8e56d51f4a14952110c7bfcb2a495fd02911931a0b0
```

Use the correct source URL and checksum for the input. The example pins the
Switzerland snapshot containing data through 2026-10-20T20:23:47Z. Download from
the [provider's regional page](https://download.geofabrik.de/europe/switzerland.html)
and verify the published checksum first; dated files have limited retention.

The analyzer reports the five overlapping source categories: peaks, natural
saddles, road/trail passes, alpine huts and wilderness huts. It also reports the
unique source-object union. Objects are not merged into real-world destinations.
The raw analyzer preserves the original broad nonblank `name` / `name:*` /
`int_name` predicate, with diagnostics for metadata-like `name:*` keys. The
[measured report](../../../docs/osm-catalog-switzerland-measurement.md) excludes one
`name:signed=no` false positive and records that review in `reviewed-fields.json`.
The proposal now requires actual language-specific names rather than a wildcard
match. Do not interpret the raw `named_eligible` flag as production eligibility.

Outputs:

- `summary.json`: source checksum/header, category counts, selected field
  coverage, representation structure, method, runtime and peak process memory.
- `selected-source-objects.jsonl`: every matching source object, including
  unnamed objects, original tags, source version/time and node/way/relation
  structure. Contributor identity and changeset metadata are omitted.
- `tag-frequencies-*.csv`: all tag-key frequencies by category and unique union,
  with explicit all-object and named-object denominators and nonblank counts.

Use a fresh output directory. The analyzer refuses to overwrite an existing
measurement. `summary.json` is published last as the completion marker. Large
source files and generated artifacts belong under the repository's ignored
`output/osm-catalog/` directory, not in Git.

Counts cover the provider's extract, including border buffers and complete
crossing features, rather than an exact administrative-country clip. JSONL byte
sizes are serialized output sizes, not PostgreSQL storage estimates. The count
analyzer does not resolve way/relation coordinates; the hut-point audit handles
that separately.

## Resolve hut points

```sh
python resolve_hut_points.py /path/to/region.osm.pbf \
  /path/to/analysis/selected-source-objects.jsonl /path/to/geometry
```

This reads only selected huts and their required references into memory, checks
the input against the analyzer's snapshot checksum, and performs selective way
and node passes. It validates supported outlines without repairing them and
generates strictly interior points. Unsupported relation roles/nesting, missing
references and invalid geometry remain explicit outcomes.

Outputs are `hut-geometry-summary.json`, `hut-geometry-audit.jsonl` and
`hut-points.jsonl`. Naming flags are inherited from the raw analyzer, including
its documented metadata false positive. These are geometric feasibility results,
not entrances or validated activity visits. Small topology fixtures can be run
with `python resolve_hut_points.py --self-test`.

The observed Switzerland result was 922 valid hut points: 349 direct nodes and
573 derived points, with no unresolved/invalid geometry in this snapshot. Of
those huts, 851 have usable names after the documented naming correction.

## Prepare a disposable PostgreSQL storage benchmark

`prepare_postgres_benchmark.py` uses only the Python standard library and does
not connect to a database or network. Run it after both measurements and the
explicit naming review:

```sh
python prepare_postgres_benchmark.py \
  /path/to/switzerland-2026-10-20 \
  /path/to/switzerland-2026-10-20/postgres
```

The output directory must not already exist. It contains `load.sql`,
`measure.sql` and `benchmark-manifest.json`. The manifest records input hashes,
the whitelist, name policy, expected counts and each schema assumption.

The SQL targets a **new disposable local database** named
`activitymap_osm_benchmark`; `--database-name` changes the explicit database-name
guard. It requires PostgreSQL with PostGIS available. Pass the isolated local
socket/port and database explicitly when running `psql`; do not use an
application connection string. For example, with an already prepared local
server:

```sh
psql -X -h /path/to/isolated/socket -p PORT -d activitymap_osm_benchmark \
  -f /path/to/postgres/load.sql
psql -X -h /path/to/isolated/socket -p PORT -d activitymap_osm_benchmark \
  -f /path/to/postgres/measure.sql > /path/to/postgres/measurement.json
```

`load.sql` creates four schemas: `named_selected` and `named_alltags` contain
11,325 reviewed usable-named objects; `all_selected` and `all_alltags` contain
all 12,931 selected source objects. Within each cohort, the only storage-policy
difference is selected versus all original source tags in JSONB. Core fields,
names JSONB, actual points, deterministic UUIDs, source metadata and one region
membership per source are identical. Core names and elevation intentionally
remain duplicated in source tags in both variants. Both retain saddle/pass
overlap. Every variant has the same six indexes, including point GiST and source
identity indexes; none has a GIN tag index. Indexes are built after insertion,
followed by `VACUUM ANALYZE`.

The 32-byte `geometry_fingerprint_width_proxy` column is explicitly a **storage
width proxy**, computed from source references and the normalized point. It is
not a true resolved-source-geometry fingerprint and must not become a production
invalidation key.

`measure.sql` emits one JSON result containing server/PostGIS versions, storage
settings, table/index/TOAST sizes, per-object totals, tag-size diagnostics and
count/category/elevation/spatial sanity checks. TOAST is already included in
table/total sizes and must not be added twice. The whole-database size includes
PostGIS and all four variants; compare the application-table totals instead.
These are fresh-load measurements, excluding update bloat, WAL/backups, retained
history, import infrastructure and private activity relations.

The source data is © OpenStreetMap contributors, available under [ODbL](https://www.openstreetmap.org/copyright).
Generated source-data artifacts retain that provenance.
