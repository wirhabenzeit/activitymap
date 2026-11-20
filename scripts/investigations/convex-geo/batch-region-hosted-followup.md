# Approved real-recording hosted batch comparison

The approved hosted comparison completed successfully. **All 288 matching groups
passed on their first attempt**, including canonical response parity and the
independent catalogue-candidate oracle. The final audit also verified all 296
persisted recording results and contiguous change sequences for each owner.
All 296 uploaded files were erased and individually verified absent; the
temporary deployment key was revoked and log capture stopped.

The results do **not** support imposing the smallest batch limit purely because
of the earlier 624 MiB process reading. Original groups were cheapest in this
selected cohort, and none of the profiles reproduced that high memory reading.
The 75k and 50k profiles had modest compute overhead; the 25k profile was
consistently more expensive without a consistent hosted RSS advantage.

[Numeric evidence](batch-region-results.json) includes all trial measurements,
per-profile complete-pass totals, execution-log attribution and the erasure
audit. [Earlier generated/local comparison](batch-region-findings.md) remains
useful for the controlled geographic and fresh-process memory experiments.

## Workload and method

The run used the existing `spotted-fennec-603` development deployment and reused
the immutable 80,366-place catalogue. Explicit approval was obtained before
uploading the selected private recordings. There were no production changes,
live provider requests or production database writes.

- 182 real recordings: 627,914 GPS samples, 27,293,650 raw JSON bytes and
  7,620,697 compressed file bytes. Files were hash-verified before upload and
  again when read by the worker.
- Six original groups: the four previously highest-RSS groups, the group with
  the most activities and the group with the most tiles. They contain **34
  complete and 148 uncovered** results. This is a deliberately selected cohort,
  not a representative sample of the library.
- Five batch profiles, each applied to exactly the same real recordings, with
  three deterministic mixed-order repetitions. This produced 261 real-data
  groups. Nine generated controls per repetition added 27 groups and 114
  generated recordings, for 288 groups and 296 recordings in total.
- Matching actions ran sequentially, with one tile reader. No deployment was
  performed during the comparison. Query-cache reuse was allowed; cache counts
  and actual database read counters are recorded separately from logical scans.
- Each hosted response was checked against its saved baseline, with the
  imported recording-revision mapping used by milestone 3. Every group also
  passed the exhaustive independent rectangle/candidate check.
- All 288 workers had complete execution-log attribution and exactly one
  attempt. Retries do not explain the cost differences.

The table below aggregates the complete 182-recording cohort once per profile
and repetition, then takes the median of those three pass totals. It does not
sum medians of individual groups. It excludes generated controls.

## Compute, batching and memory

| Profile                               | Groups/pass | Median action seconds | Action-time range | Modeled compute/pass | Maximum sampled process RSS |
| ------------------------------------- | ----------: | --------------------: | ----------------: | -------------------: | --------------------------: |
| Original frozen groups                |           6 |                 38.96 |     37.09–43.69 s |            $0.001786 |                   239.5 MiB |
| 100k samples / 16 MiB / 48 activities |          12 |                 41.87 |     41.31–44.64 s |            $0.001919 |                   241.3 MiB |
| 75k samples / 12 MiB / 36 activities  |          13 |                 41.41 |     40.24–41.79 s |            $0.001898 |                   239.7 MiB |
| 50k samples / 8 MiB / 24 activities   |          19 |                 43.58 |     43.38–44.29 s |            $0.001997 |                   241.3 MiB |
| 25k samples / 4 MiB / 12 activities   |          37 |                 58.78 |     52.75–60.96 s |            $0.002694 |                   239.7 MiB |

The profiles change sample, byte and activity guards together. An oversized
recording runs alone. Original groups can exceed the nominal 100k sample
threshold because the existing worker admits a final recording across it.
The explicit profiles also impose activity caps, so the 100k profile is not
equivalent to the original grouping.

Relative to the original median, compute increased about 6% at 75k, 12% at 50k
and 51% at 25k. Comparing each profile with the original within the same
repetition gives a 40–51% increase for 25k (median 42%). These are measured
tradeoffs for this cohort, not universal multipliers. The original and 75k
timing ranges overlap, so the experiment does not establish a precise cost
optimum between those larger profiles.

Every logged Node action used a 512 MiB memory value for compute accounting.
The model is `sum(action seconds × 0.5 GiB) / 3600 × $0.33`, using the published
US Starter marginal action rate before allowances. It excludes database/file
I/O, storage, calls, authentication and other backend work. It is not an invoice
or a monthly cost estimate. Other regions have a published 1.3× price multiplier.
[Convex rates and allocation](https://docs.convex.dev/production/state/limits).

The largest sampled process RSS was 241.3 MiB across the complete experiment;
maximum sampled JavaScript heap was 112.7 MiB. There were no runtime-limit
failures. Neither measure declined consistently with the smaller hosted
profiles. RSS includes retained process memory; heap at entry and after each
phase is recorded in the numeric evidence. These measurements do not contradict
the earlier local fresh-process experiment, where smaller groups reduced peak
memory: they measure different runtime behavior. They also do not prove that
the full library will fit indefinitely under the original hosted policy.

## I/O and geographic effects

Every real-data profile downloaded exactly the same 7,620,697 compressed bytes
per pass. Splitting repeated catalogue work and metadata/commit calls:

| Profile  | Logical tile pages/pass | Worker + descendant executions/pass | Median descendant DB reads | Median descendant DB writes |
| -------- | ----------------------: | ----------------------------------: | -------------------------: | --------------------------: |
| Original |                      85 |                                 109 |                    2.07 MB |                     70.2 KB |
| 100k     |                     103 |                                 151 |                    2.45 MB |                     76.9 KB |
| 75k      |                     103 |                                 155 |                    1.96 MB |                     78.0 KB |
| 50k      |                     121 |                                 197 |                    2.83 MB |                     84.7 KB |
| 25k      |                     159 |                                 307 |                    4.05 MB |                    104.7 KB |

Cache reuse explains why actual reads need not rise monotonically with logical
pages. These counters exclude driver polling, start mutations and later lease
checks. File accesses are not included in the execution-count column. Repeated
checks reuse an existing published result, so these write counts do not price a
new-recipe rematch that replaces every result. File billing counters remain zero
despite verified downloads; transferred bytes must not be presented as measured
billed file I/O.

The original real groups illustrate why map area and activity count are each
insufficient. These are medians across three repetitions:

| Real group                       | Activities | GPS samples | Overall envelope | Tiles | Tile rows / exact candidates | Tile-read time | Whole action |
| -------------------------------- | ---------: | ----------: | ---------------: | ----: | ---------------------------: | -------------: | -----------: |
| Many short, outside catalogue    |         97 |     100,618 |           32 km² |     1 |                        0 / 0 |          20 ms |       6.46 s |
| Widely spread, outside catalogue |         25 |      95,434 |      566,221 km² |    53 |                        0 / 0 |         721 ms |       5.83 s |
| Place-rich routes                |         12 |     118,179 |        3,933 km² |    11 |                  2,517 / 390 |       1,057 ms |       7.98 s |

The 53 empty tiles added lookup round trips, but the eleven populated tiles
were slower to read. Meanwhile the 97-activity group had substantial work beyond
its single empty-tile query. Samples, raw bytes, activity metadata, prepared
track complexity, touched tiles and point density all matter. These real groups
are not otherwise identical, so their timing differences are descriptive rather
than isolated causal estimates. The earlier fixed-shape generated controls
provide that complementary comparison.

## Decision

Do not adopt the 25k profile as a default on the strength of the earlier process
RSS reading. Keep the original groups as the cost baseline. If a conservative
cap is desired for the next full-library trial, 75k or 50k are reasonable
candidates; this selected hosted cohort does not establish that either is
necessary for memory safety. Keep geographic clustering and guard actual
tile/candidate work rather than imposing an overall map-envelope limit.

The remaining validation is a full-library run under the proposed final profile,
with the same process/heap instrumentation, repeated isolated measurements and
complete usage attribution. The present cohort is mostly uncovered, whereas the
full-library comparison was mostly complete; extrapolating its cost per
activity would be misleading. No production batch setting was changed.

## Reproduction and cleanup

The existing private plan in `lab/results/batch-region-private/plan.json` pins
the selected records, file hashes, original expectations and trial order.
After explicitly authorizing that upload, the lab README's temporary-key/log
setup is followed by `batch-region-study.mjs upload`, `run` and `erase` without
the synthetic-only flag. `summarize-batch-region.mjs --complete` verifies that
every planned group has logs and that every persisted result and uploaded file
passed the final audit. Raw records, identifiers, coordinates and logs remain
under ignored local results; published reports contain anonymous measurements.

The erasure audit verified 296 persisted results, owner-scoped contiguous change
sequences, 296 deleted files and zero remaining files. Existing catalogue and
unrelated lab datasets were preserved. The temporary key was deleted from
Convex and its local file removed.
