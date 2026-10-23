# Switzerland OSM catalogue measurement

Measured on 22 October 2026 for the [point-based v1 proposal](activity-place-inference.md).

The regional snapshot contains **12,931 unique matching OSM source objects**, of
which **11,325 have usable names under the proposed current-name policy**. Every
selected peak/pass/saddle already has a valid point. All 922 selected hut objects
also yielded valid points: 349 directly and 573 by validated outline conversion.
This supports the proposed point catalogue; it does not validate activity visits.

## Source and method

- Source: [Geofabrik Switzerland, dated snapshot 261020](https://download.geofabrik.de/europe/switzerland-261020.osm.pbf), obtained via the [regional download page](https://download.geofabrik.de/europe/switzerland.html).
- Embedded OSM data timestamp: **2026-10-20T20:23:47Z**; regional replication sequence **4945**.
- Downloaded bytes: **548,888,071** (548.9 MB decimal; 523.5 MiB).
- Published MD5 verified: `a169a37219e94927cf6d92e81df40dd4`.
- SHA-256: `8e2d91fab19a65898fa6b8e56d51f4a14952110c7bfcb2a495fd02911931a0b0`.
- Scanned **64,039,876** input objects: 57,511,155 nodes, 6,382,809 ways and 145,912 relations.
- Selectors: `natural=peak`, `natural=saddle`, `mountain_pass=yes`, `tourism=alpine_hut` and `tourism=wilderness_hut`. Settlements were not selected.
- Count by `(element type, ID)`, not name or geographic proximity. Categories deliberately overlap. Real-world duplicate representations have not been conflated.
- The extract includes border buffers and complete crossing features. These are **extract counts**, not an exact Swiss administrative-boundary census. See [Geofabrik's coverage explanation](https://download.geofabrik.de/technical.html).

The downloaded PBF, checksum, coverage polygon, source-page copy and provenance
manifest are retained in the ignored [measurement directory](../output/osm-catalog/switzerland-2026-10-20/).
No application database was accessed.

## Counts and elevation

“Usable named” requires a nonblank current `name`, language-specific `name:*`, or
`int_name`. Alternative/old names alone do not qualify. The language-only cases
were individually inspected, as described below. Elevation percentages use the
usable-named count in that row as their denominator.

| Category               | All source objects | Usable named | Named objects with elevation |
| ---------------------- | -----------------: | -----------: | ---------------------------: |
| Peaks                  |              9,246 |        8,011 |                7,738 (96.6%) |
| Natural saddles        |              2,679 |        2,393 |                2,255 (94.2%) |
| Tagged mountain passes |                870 |          826 |                  784 (94.9%) |
| Alpine huts            |                671 |          632 |                  441 (69.8%) |
| Wilderness huts        |                251 |          219 |                   78 (35.6%) |
| Unique union           |             12,931 |       11,325 |               10,568 (93.3%) |

**786 source objects carry both saddle and mountain-pass tags**, including 756
usable-named objects. The category rows must therefore not be summed as distinct
places. There are 2,763 distinct saddle/pass objects, of which 2,463 are named;
only 84 pass objects lack `natural=saddle`. Preserve both classification tags
without duplicating the catalogue row or default visit count.

All 11,700 present `ele` values passed the strict numeric-metres parser. There
were no blank or unparseable elevations; 1,231 selected objects have no `ele`.
The parser accepts signed decimal values with an optional lowercase `m` suffix
and rejects ranges, lists, comma numbers and other units. This confirms syntax,
not real-world elevation accuracy. Missing elevation is especially common for
wilderness huts and cannot become a prerequisite for their inclusion.

## Names and the wildcard correction

The initial literal `name` / `name:*` / `int_name` predicate produced **11,326**
objects. One is not actually named: `way/759713657` has only `name:signed=no`.
That tag describes naming metadata, so the reviewed usable-named count is one
lower. The raw analyzer output retains the original count for reproducibility;
[reviewed fields](../output/osm-catalog/switzerland-2026-10-20/analysis/reviewed-fields.json)
records the explicit correction.

The other six objects without a primary `name` have genuine `name:de`, `name:it`,
`name:rm` or `name:en` values. All are saddles, three also tagged as passes.
There are **11,319 primary names**, **692 objects with language-like name keys**,
only **23 English names**, and **zero `int_name` tags** in the selected union.
English-preferred display will therefore normally use the original/local name.
Five excluded alpine huts have alternative/old names only; the current-name
requirement remains an explicit policy choice.

The implementation should recognize actual name fields rather than accepting
every `name:*` key. A key-shape heuristic is useful for this audit, but is not a
complete language-tag validator for production.

## Available fields

All **12,931** selected objects have source type, ID, version and edit timestamp.
All **12,358** selected nodes have valid coordinates. Ways and relations carry
references, with representative coordinates derived separately as described
below. Public Geofabrik downloads omit contributor identity and changeset
metadata; those fields are not required by this catalogue.

There are **379 distinct tag keys** across the selected objects. The complete
per-category CSVs linked below count every tag, with both all-object and
raw-named denominators. The following table uses **reviewed usable-named
objects** as denominators. “Present” means a nonblank tag; for example, an
`access` or `drinking_water` value can be negative, conditional or restrictive.
Presence does not establish an open hut or an available service.

| Field                                                                   | Peaks (8,011) | Saddles (2,393) | Passes (826) | Alpine huts (632) | Wilderness huts (219) |
| ----------------------------------------------------------------------- | ------------: | --------------: | -----------: | ----------------: | --------------------: |
| Language-specific name                                                  |    498 (6.2%) |      135 (5.6%) |  103 (12.5%) |         43 (6.8%) |              2 (0.9%) |
| English name                                                            |      6 (0.1%) |        9 (0.4%) |     8 (1.0%) |          7 (1.1%) |              0 (0.0%) |
| Alternative/old/local/official/short name, including localized variants |    308 (3.8%) |       97 (4.1%) |    58 (7.0%) |         40 (6.3%) |             13 (5.9%) |
| Wikidata ID                                                             | 5,214 (65.1%) |     253 (10.6%) |  215 (26.0%) |       236 (37.3%) |             21 (9.6%) |
| Wikipedia link                                                          |    660 (8.2%) |      142 (5.9%) |  128 (15.5%) |       155 (24.5%) |            24 (11.0%) |
| Website or contact website                                              |      2 (0.0%) |        0 (0.0%) |     0 (0.0%) |       440 (69.6%) |            86 (39.3%) |
| Operator                                                                |      2 (0.0%) |        4 (0.2%) |     3 (0.4%) |       293 (46.4%) |            98 (44.7%) |
| Access tag                                                              |      1 (0.0%) |        0 (0.0%) |     0 (0.0%) |         18 (2.8%) |            66 (30.1%) |
| Opening hours                                                           |      0 (0.0%) |        0 (0.0%) |     0 (0.0%) |        65 (10.3%) |              9 (4.1%) |
| Capacity                                                                |      0 (0.0%) |        0 (0.0%) |     0 (0.0%) |       288 (45.6%) |            95 (43.4%) |
| Winter-room capacity                                                    |      0 (0.0%) |        0 (0.0%) |     0 (0.0%) |       198 (31.3%) |              5 (2.3%) |
| Drinking-water tag                                                      |      0 (0.0%) |        0 (0.0%) |     0 (0.0%) |       233 (36.9%) |            54 (24.7%) |

Other observed fields include summit crosses/registers, prominence, phone/email,
reservation details, winter rooms, food, toilets and external references.
Completeness varies sharply: for example, prominence is present on only 71 named
peaks (0.9%), so it cannot be assumed available for ranking or matching.

## Point normalization feasibility

These are all-object representation counts before the name filter:

| Category               | Nodes | Ways | Relations |
| ---------------------- | ----: | ---: | --------: |
| Peaks                  |  9246 |    0 |         0 |
| Natural saddles        |  2679 |    0 |         0 |
| Tagged mountain passes |   870 |    0 |         0 |
| Alpine huts            |   274 |  395 |         2 |
| Wilderness huts        |    75 |  176 |         0 |

All peak/saddle/pass source objects are already points. Huts comprise **349 nodes,
571 ways and 2 multipolygon relations**. Thus **62.1% of all huts** need conversion;
for the 851 usable-named huts, **523 need conversion and 328 are already nodes**.

The geometry audit resolved four relation-member ways and **3,455 referenced
node positions**, validated every selected hut outline without geometric repair,
and generated strictly interior representative points. All **922 huts** succeeded:
**zero missing dependencies, invalid outlines or unsupported representations**
in this snapshot. Both relations were assembled from two outer ways.

The audit explicitly rejects unsupported relation structures, invalid/open rings
and missing coordinates. It uses planar topology in longitude/latitude to derive
interior points; it does not interpret degrees as metres. This is evidence that
point normalization is practical for this regional input, not proof that every
future OSM geometry will work or that the points identify entrances. Route-to-point
visit thresholds and GPS uncertainty still need a separate labelled evaluation.

## Actual output sizes and runtime

- Full selected source-object JSONL, including original tags and references:
  **5,039,492 bytes (5.04 MB)** for 12,931 records.
- Compact hut point records: **307,967 bytes (0.308 MB)** for 922 records.
- Full category/field scan: **70.5 seconds**, peak process RSS
  **211.3 MiB**.
- Selective hut geometry audit: **53.5 seconds**, peak process RSS
  **195.7 MiB**.

These are measured serialized output and local-process figures, **not PostgreSQL
storage or deployment-runtime measurements**. A subsequent
[PostgreSQL/PostGIS benchmark](osm-catalog-postgres-measurement.md) loaded these
records and measured **8.88 MiB including indexes** for 11,325 usable-named places
with all original tags, versus 8.56 MiB with curated tags. Activity encounters,
database history and production update churn remain unmeasured. The selected
catalogue is small relative to the full 549 MB source input.

## Artifacts and reproduction

- [Count/field summary JSON](../output/osm-catalog/switzerland-2026-10-20/analysis/summary.json)
- [Reviewed usable-name field coverage](../output/osm-catalog/switzerland-2026-10-20/analysis/reviewed-fields.json)
- [All selected source objects](../output/osm-catalog/switzerland-2026-10-20/analysis/selected-source-objects.jsonl)
- [All tag keys, unique union](../output/osm-catalog/switzerland-2026-10-20/analysis/tag-frequencies-all_selected.csv)
- [Peak fields](../output/osm-catalog/switzerland-2026-10-20/analysis/tag-frequencies-peak.csv), [saddle fields](../output/osm-catalog/switzerland-2026-10-20/analysis/tag-frequencies-saddle.csv), [pass fields](../output/osm-catalog/switzerland-2026-10-20/analysis/tag-frequencies-mountain_pass.csv)
- [Alpine-hut fields](../output/osm-catalog/switzerland-2026-10-20/analysis/tag-frequencies-alpine_hut.csv), [wilderness-hut fields](../output/osm-catalog/switzerland-2026-10-20/analysis/tag-frequencies-wilderness_hut.csv)
- [Hut geometry summary](../output/osm-catalog/switzerland-2026-10-20/geometry/hut-geometry-summary.json) and [derived points](../output/osm-catalog/switzerland-2026-10-20/geometry/hut-points.jsonl)
- [Reproducible scripts and instructions](../scripts/prototypes/osm-catalog/README.md)

The two scripts record their versions/hashes and input lineage. Synthetic fixtures
covered overlapping selectors, name/elevation edge cases, source metadata,
duplicate rejection, split polygon rings, courtyard holes and malformed geometry.
An independent reaggregation of the full JSONL reproduced category counts,
source-type totals, overlaps and every tag-frequency CSV count/percentage.

Generated artifacts remain under ignored `output/`; the report and scripts are
repository documentation/source. Source data: **© OpenStreetMap contributors**,
[ODbL](https://www.openstreetmap.org/copyright), distributed by Geofabrik.
