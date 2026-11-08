# Batch size, geography, memory and compute cost

**Approved follow-up completed:** [Hosted comparison using the 182 real recordings](batch-region-hosted-followup.md).
All 288 follow-up groups passed, and the uploaded data was erased. The initial
generated/local-stage evidence below is retained separately.

The controlled follow-up supports a sample/byte budget plus geographic locality,
rather than an activity-count limit alone. Smaller batches reduce live working
memory but repeat catalogue loading and matching setup. Geographic spread affects
the number of tiles touched; place density affects their payload and scoring.
The overall map envelope is a poor predictor because gaps between routes are not
queried.

This is a bounded experiment, not a replacement for a full-library hosted run
under the final batch limits. No production behavior was changed.

## Evidence and scope

- 102 hosted generated-data groups passed canonical response comparisons and
  independent full-catalogue rectangle/candidate checks. Every worker execution
  had a corresponding duration/memory log record.
- Five mixed-order repetitions covered sample budgets, activity counts and
  geographic spread. Three additional repetitions used unique tile-query cache
  namespaces to measure uncached geographic reads.
- 182 frozen local recordings, selected from six historical groups, stayed on
  disk. Five batch profiles and three repetitions produced 261 successful
  fresh-process local group comparisons against the canonical PostGIS baseline.
- The selected real recordings include the four previously highest-RSS groups,
  the group with most activities, and the group with most tiles. They are a
  deliberately stressful subset, not a random library sample.
- Automatic approval review initially blocked the private hosted upload pending
  explicit permission. This first stage therefore used generated recordings in
  Convex and private recordings locally. The later approved upload and its
  completed comparison are documented in the follow-up linked above.
- All 114 generated hosted files were erased and individually verified absent;
  the scoped run was erased, the temporary key revoked, and log capture stopped.

Measurements: [hosted results](batch-region-synthetic-results.json),
[local results](batch-region-local-results.json).
Reproduction: [lab instructions](lab/README.md#batch-size-and-geographic-spread).

## Batch size and hosted compute

This generated workload contains the same twelve recordings, 96,000 GPS samples,
6.83 MiB of raw JSON and 2.55 MiB of gzip data in every profile. All routes overlap
within one tile. Smaller profiles divide the same work into multiple actions.

| Sample budget     | Actions | Median summed action time | Relative compute | Modeled compute per 1,000 repetitions |
| ----------------- | ------: | ------------------------: | ---------------: | ------------------------------------: |
| Original, unsplit |       1 |                    7.80 s |            1.00× |                                $0.357 |
| 100,000           |       1 |                    8.06 s |            1.03× |                                $0.369 |
| 75,000            |       2 |                    8.37 s |            1.07× |                                $0.384 |
| 50,000            |       2 |                    8.41 s |            1.08× |                                $0.385 |
| 25,000            |       4 |                    9.48 s |            1.22× |                                $0.434 |

The original and 100,000 profiles admit exactly the same records in this case;
their difference illustrates measurement variability. The 75,000 profile splits
9+3 activities, while 50,000 splits 6+6 and 25,000 splits 3+3+3+3.

Compute uses the logged action duration and logged 512 MiB memory value, not
peak process RSS or caller wall time. The dollar column models the current US
Starter marginal rate of $0.33 per GB-hour, before allowances; other regions
have a published 1.3× price multiplier. It excludes database/file I/O, storage,
calls and all other backend work. These are estimates from measured resource
usage, not invoice totals. [Accounting fields](https://docs.convex.dev/production/integrations/log-streams/),
[rates and limits](https://docs.convex.dev/production/state/limits).

Smaller groups also repeat reads. For this workload, the original action logically
scanned 375 tile rows, while the four smaller actions scanned 1,500 across their
combined calls. Median descendant database reads rose from 146 KB to 408 KB;
descendant calls rose from six to 24. File bytes stayed equal. Shared query-cache
hits reduce actual database I/O, so logical scans must not be billed as physical
reads. Driver polling, start mutations and later lease-check calls are excluded
from these descendant counters. Replays reuse already-published checks, so this
does not price first-time ingestion or a changed matching recipe.

Runtime varied substantially. The unsplit case ranged from 2.41 to 10.00 seconds
across five repetitions; the 25,000 profile ranged from 2.84 to 11.32 seconds.
A deployment between the initial three and additional two repetitions added
the uncached control mode; the matching algorithm remained unchanged. These
medians indicate direction and scale, not a precise universal surcharge. The
earlier isolated 7.31-versus-42.19-second observation is not evidence of a
general 5.8× batch-splitting penalty.

## How much geography matters

The geography controls hold twelve activities, 24,000 samples, channel shapes
and individual route shapes fixed. Routes either overlap in one cell or occupy
twelve distinct cells. Centers are chosen within the published coverage; every
response is complete. Dense controls use catalogue-rich cells, sparse controls
use cells with zero places. Density and route location are deliberate variables;
coverage-check cost can also vary by location.

These are medians of the three **uncached** trials:

| Geography           | Tiles | Tile rows scanned | Exact candidates | Tile-read time | Whole action | Descendant database reads |
| ------------------- | ----: | ----------------: | ---------------: | -------------: | -----------: | ------------------------: |
| Sparse, overlapping |     1 |                 0 |                0 |          16 ms |       1.77 s |                    137 KB |
| Sparse, spread out  |    12 |                 0 |                0 |         388 ms |       2.00 s |                    137 KB |
| Dense, overlapping  |     1 |               375 |               47 |         257 ms |       3.08 s |                    357 KB |
| Dense, spread out   |    12 |             3,562 |              251 |       1,091 ms |       3.34 s |                  2,135 KB |

The dense envelope grows from about 13 to 76,573 km², but only twelve route tiles
are loaded. Tile reads grow about 4.2× and total descendant database bytes about
6×. Whole-action duration grows about 9% in these medians because recording
processing and matching also contribute, and runtime conditions vary. Empty
cells add round trips but almost no database payload. The shared-cache geography
medians differ (2.64 s overlapping dense versus 4.01 s spread dense); they are
not a clean cache-speedup comparison because runtime conditions differ.

The generated density ranges did not show a matching increase in live heap:
median peak heap was about 44 MiB for overlapping dense routes and 46 MiB for
spread dense routes. This only covers up to 251 exact candidates and twelve
tiles; it does not establish safety at the 5,000-candidate/256-tile limits.
Likewise, the entire catalogue and its coverage polygon remain fixed at the
existing CH/AT/IT snapshot. Expansion to a world catalogue or a more complex
coverage boundary was not tested.

## Memory: real recordings in fresh local processes

Each group runs in a new Node 22.22.0 process on macOS ARM64. Candidate subsets
are computed beforehand, outside the timed interval. The table totals only
read/decode/preparation/scoring time over the same 182 recordings, excluding
process startup, catalogue reads, scheduler, network and result writes. Times
are medians of three passes; RSS is the maximum observed across their groups.
These are local memory/runtime comparisons, not hosted cost predictions.

| Profile         |             Sample cap | Raw-byte cap | Activity cap | Groups/pass | Processing time | Maximum RSS |
| --------------- | ---------------------: | -----------: | -----------: | ----------: | --------------: | ----------: |
| Original groups | Existing frozen groups |            — |            — |           6 |          1.26 s |   290.5 MiB |
| 100k            |                100,000 |       16 MiB |           48 |          12 |          1.52 s |   261.3 MiB |
| 75k             |                 75,000 |       12 MiB |           36 |          13 |          1.62 s |   240.8 MiB |
| 50k             |                 50,000 |        8 MiB |           24 |          19 |          1.87 s |   197.2 MiB |
| 25k             |                 25,000 |        4 MiB |           12 |          37 |          2.51 s |   182.3 MiB |

Oversized single recordings are admitted alone. The original policy admits a
final recording beyond its nominal sample threshold. Profile comparisons change
sample, byte and activity caps together; they do not identify the independent
effect of each cap. At 50k, peak RSS falls about 32% while measured processing
time rises about 49%. At 25k, peak RSS falls about 37% but processing time doubles.

Activity count alone is a poor predictor. One original group of twelve
activities had 118,179 samples, 5.06 MiB raw JSON and a median peak RSS of 289 MiB.
A group of 97 shorter activities had 100,618 samples, 3.76 MiB raw JSON and a
median peak RSS of 230 MiB. A 26-activity group with zero place candidates still
used about 253 MiB. These are counterexamples to a count-only or region-only
memory rule, not isolated causal comparisons. The hosted constant-48,000-sample
controls with six, twelve and 24 activities likewise showed no monotonic memory
growth with activity count.

## Interpreting the earlier 624 MiB observation

Convex reuses Node processes. The new instrumentation records RSS and heap at
entry, after preparation, after catalogue load and after scoring. One action
began with about 494 MiB resident and ended below 500 MiB despite using a smaller
batch. Earlier actions in that same sequence had grown the process. Other
instances processed identical data near 200 MiB, with different execution times.
The compute log still reported 512 MiB in every one of the 102 executions.

Process RSS and historical high-water marks are therefore not independent
per-action allocations. The previous 624 MiB measurement cannot be read as
"this batch needs 624 MiB." Fresh-process local originals stayed below 291 MiB.
This does not prove that the original hosted policy has safe long-running
headroom: retained heaps, allocator behavior and garbage collection still affect
the real process. Smaller batches alone did not keep hosted RSS at 232 MiB.

## Recommendation and remaining work

Use approximately **50,000 samples per batch as the next candidate to validate**,
with the tested byte/activity guards. It gave a better local memory/time tradeoff
than 25k, and generated hosted compute remained close to the unsplit median.
Keep geographic clustering, and consider estimated unique tiles and candidate
volume when admitting work. A maximum map-envelope area is not an appropriate
substitute for those measurements.

Before adopting a limit, run the real hosted full-library comparison with
consistent instrumentation, repeated isolated passes and explicit private-data
upload authorization. Include long-running process/heap behavior, runtime memory
accounting, and full usage attribution. The generated controls and local private
tests answer the direction of the tradeoff; they do not establish a final
production batch cap or total backend bill.
