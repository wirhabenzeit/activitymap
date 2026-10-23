# Switzerland catalogue: measured PostgreSQL storage

Measured on 22 October 2026 using the actual records and normalized points from
the [Switzerland snapshot audit](osm-catalog-switzerland-measurement.md).

**11,325 usable-named places occupy 8.88 MiB including indexes when all original
OSM tags are retained.** A curated tag whitelist reduces that to 8.56 MiB.
The extra 0.31 MiB is small enough that retaining full source tags is a reasonable
default for this foundation, alongside typed application fields. This measures
catalogue storage, not activity encounters or a complete deployed system.

## Columns and JSONB

Use typed columns for fields that drive constraints, joins, display and matching:
internal place ID, source element type/ID, categories/subtypes, primary name,
elevation, geography point, source version/time, lifecycle and semantic revisions.
Keep localized names/aliases in a small `names jsonb` and original OSM tags in a
single `geo_place_sources.tags jsonb`.

The 379 observed tag keys are spread across the selected dataset. Named objects
have **52,799 tag pairs in total: 4.66 per source object on average**. Full tags
average **116.8 bytes per JSONB attribute**, versus 89.4 bytes for the curated
variant. Attribute sizes are diagnostics; the table below measures actual
allocated table/index storage.

Retaining tags does not require exposing them all through the API, treating
them as validated domain fields, or indexing every key. Normalize an explicit
application allowlist; promote future fields to typed columns when their query
or validation requirements warrant it. Unused tag edits should not invalidate
activity matches. No blanket GIN index is included. PostgreSQL supports both
whole-document and targeted [JSONB indexes](https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING).

This choice does **not** retain entire OSM objects: way-node lists, hut outlines,
contributor identities and changesets are absent from the serving tables.

## Actual allocated storage

MiB means 1,048,576 bytes. Each row below is a separate catalogue copy with the
same three-table schema and six index definitions. Within each cohort the only
data-retention difference is the source `tags` JSONB value.

| Included objects                | Source tags  | Rows per table | Tables, incl. TOAST/FSM/VM |  Indexes |        Total | Bytes/object |
| ------------------------------- | ------------ | -------------: | -------------------------: | -------: | -----------: | -----------: |
| Usable named                    | Curated      |         11,325 |                   5.86 MiB | 2.70 MiB | **8.56 MiB** |          793 |
| Usable named                    | All original |         11,325 |                   6.16 MiB | 2.71 MiB | **8.88 MiB** |          822 |
| All selected, including unnamed | Curated      |         12,931 |                   6.52 MiB | 3.05 MiB | **9.57 MiB** |          776 |
| All selected, including unnamed | All original |         12,931 |                   6.84 MiB | 3.05 MiB | **9.88 MiB** |          801 |

Exact named totals are **8,978,432** and **9,306,112 bytes**. Full tags add
**327,680 bytes (0.3125 MiB; 3.65%)** to the observed total. The source-table
difference itself is 319,488 bytes; the remaining 8,192 bytes are a one-page
GiST index build-layout difference on otherwise identical place data. Do not
attribute that index-page variation to tag retention.

Named-cohort breakdown, including each table's indexes:

| Table                       | Curated tags |    All tags |
| --------------------------- | -----------: | ----------: |
| `geo_places`                |  4,210,688 B | 4,218,880 B |
| `geo_place_sources`         |  3,284,992 B | 3,604,480 B |
| `source_region_memberships` |  1,482,752 B | 1,482,752 B |

The lower bytes/object for the all-object cohort reflect the additional sparse,
unnamed records and page allocation. They do not imply a different schema.

## Schema and method

- Runtime: **PostgreSQL 17.11**, **PostGIS 3.5.6**, native macOS arm64 via the
  official [Postgres.app PG17 bundle](https://postgresapp.com/downloads.html).
  PostgreSQL major version matches the repository's local Docker configuration.
- Isolated temporary cluster, private Unix socket, no TCP listener. No
  application database, production schema or cloud branch was accessed.
- UTF-8, 8,192-byte pages, default `pglz` TOAST compression. Normal logged tables,
  default fill factors. Fresh deterministic source-type/ID load order; indexes
  built after import; `VACUUM (ANALYZE)` before measurement.
- Source snapshot: **2026-10-20T20:23:47Z**, regional replication sequence 4945,
  SHA-256 `8e2d91fab19a65898fa6b8e56d51f4a14952110c7bfcb2a495fd02911931a0b0`.
- Same reviewed eligibility as the snapshot report: excludes the
  `way/759713657` metadata-only `name:signed=no` case and includes six genuinely
  localized-name-only records. Objects are not conflated into real-world places.

`geo_places` uses UUID identities, text arrays preserving kinds and overlapping
subtypes, display name, names JSONB, `real` elevation, actual
`geography(Point,4326)` coordinates, derivation/version, lifecycle, display/match
revisions and creation/update timestamps. Text statuses/version names were used
without packing them into small integer codes. UUIDs are deterministic benchmark
identities, not a proposed OSM-based permanent identity generation rule.

`geo_place_sources` stores the typed source identity, UUID place reference,
version/time, validation status, last-seen timestamp, source tags and a 32-byte
geometry fingerprint **width proxy**. The proxy reserves realistic digest width;
it is explicitly not a true resolved-geometry fingerprint and must not be used
as a production invalidation key. Point coordinates themselves are real audited
coordinates, including derived interior points for hut outlines.

`source_region_memberships` stores one small-integer region ID, source identity
and bigint snapshot revision per object. Actual region metadata/clipping polygons
are excluded. The six indexes per variant are:

1. Place UUID primary key.
2. Geography-point GiST index.
3. OSM `(type, ID)` source primary key.
4. Source-to-place UUID lookup index.
5. Region/source membership composite primary key.
6. Reverse source/region membership lookup index.

Foreign keys connect sources to places and memberships to sources. No name,
category-array or JSONB GIN search indexes are included; those require their own
query-driven sizing if added.

The curated source-tag variant retains `natural`, `mountain_pass`, `tourism`,
`ele`, `wikidata`, `wikipedia`, `website`, `contact:website`, `operator`, `access`,
and recognized current/localized/alternative names. Both variants intentionally
duplicate normalized names/elevation in original source tags, so the comparison
does not mix tag retention with a normalization change. The manifest records the
exact name-key heuristic and manually reviewed exceptions; this is a fixed-input
benchmark, not a production language-tag validator.

Sizes come from [`pg_table_size`, `pg_indexes_size` and `pg_total_relation_size`](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-DBSIZE),
summed across the three application tables. TOAST is already included in table
and total bytes. The whole-database size includes PostGIS/system overhead and
all four experimental copies, so it is not used as the per-catalogue result.

All **24 live validation checks passed**: equal place/membership rows within
each cohort, equal source metadata except tags, full tags containing all curated
tags, the corrected naming exclusion, expected elevations/overlaps, and three
spatial probes returning identical source identities. An independent export
comparison also confirmed all **12,931 full-tag dictionaries** exactly match the
original JSONL. The temporary server was stopped and its read-only distribution
image unmounted after the results were saved.

## What this establishes

For this regional input, the catalogue occupies only around **9 MiB**, and full
source-tag retention adds little. The result supports the hybrid schema and
removes storage as a strong argument for aggressively trimming raw tags.

This is a fresh-load baseline. It excludes WAL, backups/Neon history, update
bloat, retained retired sources, staging, region polygons, outbox/jobs, redirects,
activity encounters/memberships and cell dependencies. It does not measure
weekly sync churn, query throughput or visit-classification quality, and is not
a Neon billing measurement. Actual global category counts and tag distributions
must be measured before projecting worldwide storage.

## Reproduction and artifacts

- [Generator and instructions](../scripts/prototypes/osm-catalog/README.md).
- [Input/schema manifest](../output/osm-catalog/switzerland-2026-10-20/postgres/benchmark-manifest.json).
- [Exact load SQL](../output/osm-catalog/switzerland-2026-10-20/postgres/load.sql) and [measurement SQL](../output/osm-catalog/switzerland-2026-10-20/postgres/measure.sql).
- [Measured JSON with per-table/index details](../output/osm-catalog/switzerland-2026-10-20/postgres/measurement.json).
- [Validation SQL](../output/osm-catalog/switzerland-2026-10-20/postgres/validation.sql) and [results](../output/osm-catalog/switzerland-2026-10-20/postgres/validation.json).
- [Runtime/download provenance](../output/osm-catalog/switzerland-2026-10-20/postgres/runtime.json).

The generator validates input hashes and cohorts, refuses to overwrite output,
and makes no database connection. SQL refuses any database name except the
explicit benchmark name and refuses existing target schemas. Generated artifacts
remain under ignored `output/`; report and generator belong in repository source.

Source data: **© OpenStreetMap contributors**, [ODbL](https://www.openstreetmap.org/copyright),
distributed by Geofabrik.
