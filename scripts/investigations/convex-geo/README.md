# Issue 478: geo investigation, 2026-11-07

Latest implementation: [production foundation and client projections](../../../backend/README.md),
[client measurements](client-preview-findings.md) and the
[remaining implementation plan](experimental-implementation-plan.md). The draft
includes lab prerequisites for review; persistent deployment validation, coordinated
owner handoff and the under-10-second loading target remain open. No production
cutover is enabled. The findings below retain their original experiment scope.

Earlier: [full-library batch-profile validation](full-library-validation-findings.md) — six complete passes, all 27,612 response checks passed; recordings retained until November 14.

**Approved real-data follow-up:** [Hosted batch comparison](batch-region-hosted-followup.md)
passed all 288 groups and audited/erased all uploaded records. Smaller batches
cost more on this cohort without a consistent hosted process-memory advantage.

**Batch/region follow-up:** [Controlled memory, geography and compute tests](batch-region-findings.md)
compare intermediate batch limits and separate recording volume from tile spread
and place density, with hosted generated-data and local real-recording evidence.

**Next implementation:** [Experimental backend plan](experimental-implementation-plan.md)
defines the recording-storage, durable-ingestion, hosted-matching and existing-client
milestones, with correctness gates and a complete performance/cost comparison.

**Full-library update:** [All 4,602 local activities now pass](full-library-findings.md)
with realistic worker groups in both uncached and cache-enabled Convex tile runs.

**Update:** [The first hosted experiment](hosted-findings.md) now reproduces the
component issues and passes 40 real-recording comparisons using an ordinary
Convex tile index. The original local investigation below is preserved for context.

Recommendation: retain PostGIS for now. Convex remains plausible as catalogue
storage feeding the existing TypeScript matcher, but its geo component is not
currently a drop-in replacement for the catalogue rectangle query. Two executable
reproductions below expose correctness and bounded-read concerns. This is an
investigation only; production code, dependencies and databases are unchanged.

## What ActivityMap actually needs

At ActivityMap `87dbd02e`, normal matching in
`src/server/application/place-matching.ts` calls `createBatchActivityPlaceMatcher`.
Postgres supplies an immutable, scoped catalogue; route distance, corridor
coverage and encounter scoring then run locally. The most direct Convex seam is
`loadBatchPlaceCatalogue`, not rewriting the matcher using nearest-neighbour
queries. Nearest-N searches around GPS samples can miss segment-interior visits
and dense-area candidates.

The separate `on-demand-places.ts` repository still exposes PostGIS discovery,
including its debug path. Its coverage semantics differ from the batch engine.
The existing `docs/on-demand-places.md` records a prior 4,602-activity comparison
with identical API results, explicitly without guaranteeing border parity.
Those are historical results, not measurements rerun here.

Read-only local inspection today found **80,366 active places** and **947 coverage
vertices** in the active CH/AT/IT catalogue. These are local counts, not a new
production audit. The 15 existing query-window, spatial-index, batch-coverage and
batch-matcher tests passed.

## New measured findings

Tested the real upstream S2 WASM and component query implementation at
[`e7e276e0c7c16e50e844486f351c0e2e0c266ab7`](https://github.com/convex/geospatial/tree/e7e276e0c7c16e50e844486f351c0e2e0c266ab7)
(package version 0.2.1), using convex-test 0.0.62, Convex 1.46.0 and Vitest 4.1.2.
This is local emulation: it does not certify deployed latency, billed bytes or
enforcement of platform limits. Four characterization tests pass by asserting
the observed behavior, including known undesirable behavior.

| Probe                                                          | Observed result                                                                                 | Implication                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 300 nearby points, identical sort keys, page size 17           | All returned once across 18 pages                                                               | Basic dense pagination works in this fixture                                    |
| Full-world rectangle, point at 8°E / 46°N                      | Point excluded                                                                                  | Do not pass full-longitude windows through unchanged                            |
| Polar window −180…180°, 89.99…90°N; point at 0° / 89.999°N     | Point excluded; component query also returns zero                                               | Directly relevant to full-longitude windows produced by ActivityMap             |
| Wide rectangle −170…170°, −10…10°; point at 0° / 0°            | Point excluded                                                                                  | Wide rectangles have different semantics from PostGIS Cartesian envelopes       |
| Rectangle cover with maxCells=8                                | World: 4; NW hemisphere: 436; Alps: 8; small route box: 7 cells                                 | maxCells is not a strict fanout cap; the world case is also geometrically wrong |
| Tiny rectangle, 1,100 nearby points outside it, result limit 1 | 1,100 index rows read and 1,100 points post-filtered; 70 index queries; zero results, no cursor | Page size does not bound work; the 1,024-row target is bypassed                 |

The upstream Go wrapper constructs a rectangle by adding two corner points to
`RectFromLatLng`, selecting the shorter longitude interval. This explains the
wide/full-world behavior. Exact dateline endpoints also deserve independent
tests: the east-side fixture returned both ±180 aliases, while the west-side
fixture returned neither. The pagination test uses S2's own containment as its
reference and therefore is **not** a Cartesian geometry parity test; the separate
false-negative test explicitly compares against Cartesian bounds.

In `src/component/query.ts`, points outside the rectangle execute `continue`
before the `stats.rowsRead >= 1024` check. That counter also counts index rows,
not all fetched point documents or bytes. The source and local reproduction
support the risk described in [upstream issue 57](https://github.com/convex/geospatial/issues/57),
but we did not reproduce that report's deployed timeout/read-limit failure.
Current [Convex limits](https://docs.convex.dev/production/state/limits) include
16 MiB read, 32,000 documents scanned, 4,096 index ranges/read calls and one
second of query/mutation user-code execution. A successful small result page
does not establish headroom against these limits.

## Existing coverage difference, independently reproduced

A point 305 m east of the straight western edge of a synthetic coverage square,
with a 300 m discovery radius, is covered by the current PostGIS predicates and
uncovered by `createBatchCoverage`. PostGIS reports exactly 305 m clearance.
The local engine requires 308 m spherical clearance (2% + 2 m), while PostGIS
also uses a projected expanded buffer and a 300.1 m geography boundary check.
This difference exists before any Convex migration. A blanket requirement for
identical coverage against both engines is therefore unsatisfiable without
choosing and versioning a single intended rule.

## Proposed migration experiment and acceptance gates

1. Preserve the current batch engine and `local-spherical-corridor-v1` semantics.
   Compare Convex-loaded subsets with the full frozen catalogue through that same
   engine. Separately classify every PostGIS disagreement; do not silently change
   the coverage recipe to make comparisons pass.
2. Split broad rectangles into longitude spans strictly less than 180°, with
   conservative overlap at boundaries, then validate poles and ±180 aliases.
   Split long continuous routes into overlapping segment blocks before deriving
   windows. Preserve discontinuities and curved arc interiors. Smaller boxes
   reduce fanout but do not by themselves fix unbounded post-filter scans.
3. Exhaust each page cursor, deduplicate by stable place ID and pin the catalogue
   snapshot across all calls. Never cap raw rectangle results at the matcher's
   250-candidate budget: irrelevant box hits could hide actual encounters.
   A timeout or unfinished page set must remain incomplete, never completed-empty.
4. Benchmark the actual 80k-scale catalogue in an isolated Convex deployment:
   dense regions, long routes, disjoint tracks, holes/borders, polar/wide bounds,
   and production-sized rematch groups. Record internal index/point reads,
   database bytes, metadata fetches, p50/p95 latency, CPU, memory and failures.
   Output JSON size is not billed database I/O. Do not loop through an entire
   rematch inside one query; measure bounded calls orchestrated by an action.
5. If component behavior remains problematic, compare immutable spatial catalogue
   tiles/files loaded into the existing local engine against retaining PostGIS.
   A hybrid backend preserves proven geometry but also preserves two systems;
   cheaper Postgres remains the simpler cost comparator.

No deployed Convex rematch, full-catalogue component import, cost measurement or
full final-result parity run was completed here. Issue 478's migration gates
remain open. The concrete next experiment is a tiled catalogue loader feeding
the unchanged matcher, with the above reproductions as mandatory regressions.

## Reproduce

From this repository, with its local PostGIS container running:

```sh
node --import tsx scripts/investigations/convex-geo/coverage-boundary.mjs
pnpm exec tsx --conditions=react-server --test src/server/places/query-windows.test.ts src/server/places/batch-coverage.test.ts src/server/places/spatial-index.test.ts src/server/application/batch-activity-places.test.ts
```

For component probes, clone the upstream repository to a temporary directory,
check out the pinned SHA above, and copy `component.test.mjs` to its root as
`activitymap.test.mjs`. Install the following dependencies in a separate temporary
package and symlink that package's `node_modules` into the upstream checkout:

```sh
pnpm add --ignore-scripts vitest@4.1.2 convex@1.46.0 convex-test@0.0.62 @edge-runtime/vm@5.0.0 async-channel@0.2.0 heap-js@2.5.0
```

Run `vitest run activitymap.test.mjs --disableConsoleIntercept` from the upstream
checkout. No Convex account, deployment or private activity data is needed.
