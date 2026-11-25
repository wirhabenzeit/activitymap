# Hosted Convex place matching

Milestone 3 of [issue #480](https://github.com/wirhabenzeit/activitymap/issues/480)
runs matching inside scheduled Node actions on the `spotted-fennec-603`
development lab. The actions read immutable recording files and the ordinary
quarter-degree tile catalogue. The application matcher, coverage, track
preparation and grouping constants are shared with the PostGIS worker.

The replay scope contained 4,602 eligible recordings for one owner from the
local Docker fixture database. A repeatable-read preflight compared every
source version and recording identity against the frozen PostGIS plan before
creating an ignored manifest and compressing 811,800,673 raw bytes into
238,729,963 file bytes. The deployment verified the digest and index fields of
all 80,366 existing catalogue rows. The existing place dataset was reused.

## Matching and publication

The run pins one catalogue revision and recipe. A leased group reads
owner-scoped recording metadata, downloads and validates whole gzip files,
prepares tracks and exhausts the tile queries. It filters by exact rectangle and
deduplicates by stable place ID. File fetch prefetch is bounded separately from
tile concurrency. A file, page or budget failure leaves an explicit failed or
retryable checkpoint without a completed check.

The commit mutation revalidates account eligibility, generation, desired
activity source and the recording manifest pointer. It writes each check and
monotonic owner change in one transaction. Replaying the same version reuses
the check and change. An opt-in durable fixture account schedules this work from
recording publication and fences previous results immediately after source
replacement, deletion or revocation. The hosted fixture passed a typical
recording, an empty replacement, and deletion, with upserts at sequences 1 and 2. Client reads and tombstones are outside this matching milestone.

Imported records use a `postgres-v1:` source namespace. The comparison checks
the persisted hosted recording revision separately, then substitutes the frozen
PostGIS revision in the hash because the imported files begin at hosted
revision 1. The canonical response comparison includes the remaining response
fields. The first pass exposed a missing-GPS mismatch. The original PostGIS
JSON projection passes a missing GPS channel as `null`, yielding `partial`.
The replay now reproduces that input shape. Durable fixture empty recordings
retain `missing_streams` with the native fixture namespace. The lab cleared
its derived checkpoints before the corrected run and kept the verified files.

## Full-library correctness

Both sequential-tile passes matched all **4,602 of 4,602** original canonical
PostGIS responses. Each returned 3,719 complete, 824 uncovered and 59 partial
results. The actual hosted grouping produced 192 groups and the frozen
comparison replayed all 194 original groups. Their first 88 ordered groups
had identical membership. The actual pass also verified a terminal no-work
checkpoint. The independent catalogue oracle agreed for every group. The
largest observed frozen coordinate drift was 1.14 × 10⁻¹³ degrees, with
identical candidate metadata from the original and hosted bounds. Both
passes shared one versioned check and one sequenced change per activity.

| Measurement                                  | Actual hosted grouping |   Frozen groups |
| -------------------------------------------- | ---------------------: | --------------: |
| Activities verified                          |                  4,602 |           4,602 |
| Groups with activity work                    |                    192 |             194 |
| Caller wall time                             |              1,043.5 s |       1,035.1 s |
| Caller-observed group p95                    |                 8.50 s |          8.60 s |
| File fetch intervals                         |                134.9 s |         159.0 s |
| Whole-file decoding and validation           |                174.1 s |         175.3 s |
| Track preparation and windows                |                114.3 s |         125.7 s |
| Tile reads                                   |                 45.3 s |          45.3 s |
| Scoring, coverage setup and response hashing |                305.2 s |         322.1 s |
| Tile pages / logical rows scanned            |        1,492 / 104,316 | 1,493 / 104,395 |
| Compressed bytes fetched                     |            238,882,944 |     238,729,963 |

The two passes overlapped on the same lab. Wall time includes scheduler
dispatch, polling, action work, writes and caller-side oracle verification.
The actual total excludes the intentional stop between runner processes.
Bounded file prefetch can read a few files again when preparation ends a
group before the prefetched block has been consumed. The extra fetched bytes
appear in the actual pass total.

## Recovery and runtime headroom

The largest six-channel fixture reopened all 172,071 GPS samples from its
1,844,066-byte file. The action completed in 5.23 seconds as observed by the
probe and reported a 218.0 MiB process high-water. The existing 100,000-sample
scoring policy classified that fixture as `partial`. A separate 100,000-point
fixture exercised preparation, catalogue reads and scoring at the policy
boundary. It completed in 7.00 seconds at 243.2 MiB process high-water. The
300-point wide fixture exceeded the tile budget and produced no check or
change. A synthetic interruption after scoring recovered on the second lease
attempt in 7.16 seconds with one change record. The whole-library caller also
exited after five durable checkpoints and resumed.

A later deployment added process RSS sampling during the runs. Across the
instrumented groups, observed resident memory reached 662.1 MiB in the actual
pass and 669.0 MiB in the frozen pass. The process high-water also rose above
512 MiB during 17 of 112 instrumented actual groups and 8 of 110 frozen
groups. A later 915-point action inherited a 601.0 MiB process high-water,
so an end-only high-water number can include earlier work in the same
process. Convex's log memory field is the action allocation. The individual
fixture results establish headroom for those inputs. The original batch
policy did not establish safe headroom for historical rematches. [Convex runtime limits](https://docs.convex.dev/production/state/limits)

## Follow-up probes

The four-reader tile trial ran after both sequential passes. It selected the
12 frozen groups with the most tiles and matched all 206 responses and all
candidate digests. Their tile-read intervals totaled 3.85 seconds with up to
four readers and 6.44 seconds in the sequential pass. Cache state and
overlapping load differed across the passes.

The four original groups with the highest observed RSS were repeated with
sequential tile reads and no other benchmark pass active. At their original
size they still reached 624.2 MiB sampled RSS. Splitting the same 60
activities into 23 subgroups reached 231.6 MiB and preserved every response
and exact-window candidate check. Each subgroup admitted at most 25,000
GPS samples, 4 MiB of raw recordings and 12 activities, allowing an oversized
recording to run by itself. Those one-off probes took 7.31 seconds at original
group size and 42.19 seconds with the split. Full-library memory and
throughput under the smaller caps remain unmeasured.

## Reproduction and measurement scope

The [numeric results](hosted-matching-results.json) include phase measurements
and available database counters. The [lab instructions](lab/README.md#hosted-matching) cover local preflight,
bounded upload, hosted comparisons, log capture, erasure and key revocation.
The independent oracle exhaustively filters the checksum-verified catalogue
export for each group. Frozen group comparisons allow last-bit platform
roundoff in the computed coordinates only if both the original and hosted
window sets select identical candidate metadata. Matching response hashes
are compared separately against the original complete PostGIS response.

The hosted passes include scheduling, cold starts, file fetch and decode,
matching, and writes. The previous local PostGIS timing used a read-only
worker and local database. It is not a deployment-matched baseline. Function
logs report database read and write counters. Compressed file bytes are
verified transfer sizes. They do not establish billed file I/O, and this
experiment does not estimate total monthly cost. Log capture began partway
through the import and includes preliminary trials, corrected passes, probes
and cleanup. Across that window, tile queries reported 34.44 MB of database
reads, with 2,873 cached results across 4,048 calls. Group load and input
queries reported 186.07 MB of reads combined, and group commits reported
47.43 MB of reads and 15.91 MB of writes. The file-read usage field was zero
despite successful downloads.

Before erasure the audit rehashed all 4,602 persisted checks against the
canonical baseline, checked their recording revisions, and verified all
4,602 associated owner sequences. The scoped erasure removed the run and
all 4,602 published files. A follow-up read of every file ID found zero
remaining. The temporary deployment key was revoked and its local key file
was removed. The private source manifest and diagnostics remain in the
ignored local results folder.

The root and lab typechecks passed, along with 72 targeted matcher,
catalogue and codec tests and 82 Strava tests.
