# Hosted Convex findings — 2026-11-07

**Follow-up:** [The full-library comparison](full-library-findings.md) verifies
all 4,602 local activities and measures realistic rematch groups. The initial
40-fixture experiment below remains as historical evidence.

The first hosted experiment is complete on
[activitymap-geo-lab / spotted-fennec-603](https://dashboard.convex.dev/t/dominik-schroder/activitymap-geo-lab/spotted-fennec-603).
The beta geo component reproduces correctness problems. An ordinary Convex tile
index feeding ActivityMap's unchanged local matcher passed all 40 replay
comparisons. This supports continuing with the tile loader, not replacing the
production backend yet.

## Deployment and data

Convex SDK 1.46.0, geospatial 0.2.1; deployment type: development. The initial local
login belonged to a different team; the owner completed browser login to the
correct team before any deployment writes. All benchmark functions are internal.
Production ActivityMap code and data were not changed. The root TypeScript config
only excludes the independently typechecked benchmark package.

Imported 80,366 public catalogue points (32,378,455 JSONL bytes), plus 1,403
synthetic points. The public catalogue uses the regular tile index; only synthetic
points are in the S2 component. The import fingerprint and local raw evidence
are in the ignored `lab/results/` folder. The checked-in measurement artifact is
[hosted-results.json](hosted-results.json); it contains aggregate fixture results,
not recordings, account IDs or activity IDs.

## Hosted component probes

The definitive run took place after the synthetic seed completed. An earlier
overlapping smoke probe is excluded from the saved synthetic result.

| Probe                           | Hosted outcome                                        |
| ------------------------------- | ----------------------------------------------------- |
| Dense, 300 points, page size 17 | All 300, no duplicates, 18 pages; 2,170 ms total      |
| East dateline rectangle         | 2 points versus 1 under Cartesian bounds (±180 alias) |
| West dateline rectangle         | 0 versus 1                                            |
| Full-longitude polar rectangle  | 0 versus 1                                            |
| Full-world rectangle            | 0 versus 303                                          |
| Wide −170…170° rectangle        | 2 versus 300                                          |
| One-result sparse rectangle     | Empty result after 1,474 ms                           |

The sparse probe's actual log reports 1,100 post-filtered points, 2,202 index rows,
346 index queries, 3,303 total documents read and 745,319 database I/O read bytes.
It used a dataset filter, unlike the earlier unfiltered local reproduction.
Neither run hit a deployed platform limit; both demonstrate that a small result
limit does not bound scanning. The hosted counters are stronger evidence than
estimating cost from the 14-byte return value.

## Tile-index replay

Loaded candidates through an ordinary `(dataset, tile)` Convex index, with
0.25-degree tiles, 256-row pages and exact rectangle post-filtering. Reused the
existing TypeScript matcher and its coverage policy locally. Each comparison
asserted both exact candidate IDs and complete matching-response equality.

| Measurement                        | Result                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| Replay comparisons                 | 40 / 40 passed                                         |
| Selection                          | 24 sample-count strata + 16 long/dense stress fixtures |
| Largest local recording tested     | 45,262 GPS samples                                     |
| Matching statuses preserved        | 29 complete; 11 uncovered                              |
| Server lookup time                 | Median 65.5 ms; p95 254 ms; maximum 329 ms             |
| Tile-query executions              | 218; zero cache hits                                   |
| Documents read                     | 12,759                                                 |
| Candidates returned across replays | 1,520                                                  |
| Actual database I/O read bytes     | 7,089,602 (7.09 MB)                                    |

Read bytes/documents are summed from unique completed `lab:tilePage` executions
in Convex logs. All 218 expected pages are represented. Read amplification was
about 8.4 documents per returned candidate; smaller/adaptive tiles or sharing
tiles across a rematch batch may improve it. The timings cover server-side tile
loading, not local scoring, internet latency or CLI startup. These are single
observations per fixture, not a repeated-load performance distribution.

## What this establishes and what remains

Convex can serve the complete current local catalogue through ordinary indexes
without relying on its beta S2 component, while preserving the tested matcher
outputs. Pagination has explicit completion and fails on exhausted budgets.
It is therefore worth extending the tile-loader experiment.

Still unproven: full-library replay and actual rematch grouping/concurrency;
larger production tracks (the issue reports up to 172,071 samples); partial and
budget-exhausted result parity; arbitrary boundary/pole cases for the tile loader;
snapshot publication during reads; long-term cost and repeated-load latency.
The full catalogue was not indexed into the beta geo component because the
hosted correctness probes already fail. No full hosted matcher, stream storage,
auth or iOS migration was attempted.

Next, replay the full eligible library in the current worker's batch sizes,
reuse each tile once per batch and compare with the existing regional Postgres
benchmark. Measure cache hits and misses separately and then decide whether
moving matching into a Convex action is useful. Keep PostGIS until those broader
checks pass. No recurring tasks or background rematch jobs were installed.
