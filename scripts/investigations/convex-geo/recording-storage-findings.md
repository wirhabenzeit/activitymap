# Convex lab recording storage

[Milestone 1 of issue #480](https://github.com/wirhabenzeit/activitymap/issues/480)
implements one gzip-compressed raw JSON file per published recording revision.
Use that layout for the next lab milestone. The largest generated fixture
reopened in both layouts. Chunks used less local peak memory on that fixture
and cost 44 files and 11% more compressed bytes. The next worker will load
whole recordings for matching, so selective chunk reads would bring no
benefit to that path.

A manifest records the raw-byte SHA-256, codec, compressed and uncompressed
bytes, and counts for present channels. A missing count and a zero count
remain distinct. Hosted manifest rows also record owner, fixture key, account
generation, source version, storage generation, and revision. Reads verify
the raw size, digest, and counts. Summaries use the existing sampler and
`polyline-v1` codec in a separate document. If the compact codec refuses a
valid downsampled value, the existing JSON summary format preserves it. If
finite raw samples overflow the sampler's arithmetic, the summary is marked
unavailable and the full recording stays readable.

Each attempt is registered before its one file write. The writer gives the
file an attempt-specific MIME type. Publication verifies that type, file size,
and Convex's base64 SHA-256 before updating the current pointer and summary
in a mutation. Superseded attempts and erased targets cannot publish. A reaper
pages only through the attempt's file creation window after its 15-minute
deadline and removes files tagged with that attempt. It can find a file
whose storage ID never reached the application. Publication deletes the
attempt in the same mutation, so its reaper cannot delete the published file.
Replacement and erasure remove the previous file and summary in the mutation.

## Local filesystem

Three fresh Node 22.22.0 processes per case and layout, on macOS ARM64. Each
trial measures validation, encoding and summary generation together, filesystem
writes, and complete file reads plus decoding and validation. Peak RSS is the
process high-water mark sampled after read/decode and includes Node, the
input fixture, and temporary allocations. It is not isolated codec heap or
physical disk usage. The table reports median times and RSS and compressed raw
file bytes. Manifest and summary bytes are reported separately in the trials.

| Fixture             | GPS samples | Layout | Files | Compressed bytes | Encode ms | Write ms | Read/decode ms | Peak RSS MiB |
| ------------------- | ----------: | ------ | ----: | ---------------: | --------: | -------: | -------------: | -----------: |
| Synthetic small     |          96 | Whole  |     1 |            1,412 |      4.06 |     1.98 |           1.06 |        103.7 |
| Synthetic small     |          96 | Chunks |     2 |            1,434 |      3.85 |     2.41 |           1.35 |        103.8 |
| Synthetic typical   |       4,800 | Whole  |     1 |           57,512 |     20.60 |     0.89 |           7.02 |        114.1 |
| Synthetic typical   |       4,800 | Chunks |     3 |           58,202 |     19.82 |     2.13 |           6.47 |        113.3 |
| Synthetic oversized |      20,000 | Whole  |     1 |          223,265 |     55.20 |     0.91 |          14.93 |        145.1 |
| Synthetic oversized |      20,000 | Chunks |     6 |          238,058 |     50.92 |     1.60 |          20.11 |        142.3 |
| Synthetic largest   |     172,071 | Whole  |     1 |        1,844,066 |    377.67 |     1.52 |         101.98 |        350.8 |
| Synthetic largest   |     172,071 | Chunks |    44 |        2,046,639 |    320.32 |     5.72 |         109.85 |        290.6 |
| Local shortest      |           1 | Whole  |     1 |              144 |      3.02 |     0.74 |           0.57 |        102.9 |
| Local shortest      |           1 | Chunks |     2 |              195 |      2.93 |     1.00 |           0.70 |        103.4 |
| Local median        |       3,049 | Whole  |     1 |           40,449 |     16.28 |     0.85 |           3.71 |        109.5 |
| Local median        |       3,049 | Chunks |     2 |           40,513 |     16.31 |     1.04 |           3.89 |        109.2 |
| Local longest       |      45,262 | Whole  |     1 |          614,184 |    113.30 |     0.94 |          25.86 |        171.7 |
| Local longest       |      45,262 | Chunks |    13 |          636,551 |    109.03 |     2.38 |          29.58 |        160.8 |

The comparison slices each channel independently at the same sample offsets.
Chunks contain at most 4,096 samples per channel, with a 240 KiB decompressed
budget and 256 KiB compressed budget per file. Oversized sample blocks split
further. Metadata occupies independently byte-bounded gzip files. The whole
format has a 64 MiB decompressed ceiling. That ceiling guards decode and
does not establish a safe runtime memory budget for arbitrary shapes.

Nine lab tests cover exact equality, all six channels, missing and empty
channels, different sampling bases, unequal lengths, special metadata keys,
signed zero, byte-bound splits, invalid input and integrity failures. The same
fixtures run the existing compact summary and a small nonempty matching case.
The Node build inspected 107 runtime source inputs and found no application
database, repository, Next.js or `server-only` dependencies. The application's
existing stream, summary, compact codec and matcher tests also passed (51 tests).

## Hosted synthetic whole files

The existing `spotted-fennec-603` dev deployment completed 12 full upload,
publication, read, decode and erasure runs using generated fixtures on Node
22.23.4. Each largest fixture has 172,071 points in **each** of six channels.
The upload and download timings measure Blob storage calls from the action.
The database times measure the publication mutation and manifest/summary
query from the action. The encode interval starts after fixture generation
and validation and includes summary generation. The decode interval includes
digest verification and raw validation. CLI wall time also includes
validation before encoding, setup, erasure, startup and network overhead.
Times are medians of three trials. RSS is the highest observed Node process
value across the three trials and includes runtime overhead.

| Fixture   | Raw bytes | Gzip bytes | Summary JSON bytes | Encode ms | Upload ms | Publish ms | Query ms | Download ms | Decode ms | CLI wall ms | Max RSS MiB |
| --------- | --------: | ---------: | -----------------: | --------: | --------: | ---------: | -------: | ----------: | --------: | ----------: | ----------: |
| Small     |     4,414 |      1,412 |              1,066 |      5.05 |    216.20 |      41.43 |    24.50 |       46.55 |      2.38 |       1,622 |       141.7 |
| Typical   |   209,671 |     57,512 |              3,610 |    116.25 |    227.04 |      39.69 |    23.79 |       47.30 |     42.50 |       1,527 |       137.5 |
| Oversized |   900,121 |    223,265 |              4,078 |    499.08 |    209.12 |      36.58 |    22.87 |       54.62 |    257.27 |       2,577 |       143.0 |
| Largest   | 8,074,983 |  1,844,066 |              4,891 |  3,802.22 |    263.02 |      38.22 |    25.15 |      152.94 |  2,359.79 |      11,011 |       327.8 |

Convex execution logs recorded 1,542 database bytes read across four documents
for publication in every baseline run. Publication wrote 2,211–6,033 bytes
across four documents. The manifest/summary query read 2,178–6,000 bytes
across three documents. File storage usage counters reported zero even on
the successful Blob calls. Gzip byte counts are the verified bytes uploaded
and reopened by the action, so they provide a transfer-size measurement
while billed storage I/O remains unmeasured. The logs' 512 MB memory field
is the action allocation. Process RSS came separately from Node's resource
usage. These trials cover one recording at a time, before full catalogue
discovery and matching. [Convex runtime limits](https://docs.convex.dev/production/state/limits)

A separate hosted guard trial verified owner scoping, account generation
mismatch rejection, preservation of a published file during orphan recovery,
stale publication rejection, atomic replacement, erasure, and rejection after
recreating the same logical target. The reaper recovered a synthetic orphan
without receiving its file ID. That test explicitly closed the writer before
calling the reaper, exercising the same lookup as the deadline path without
waiting 15 minutes. The deployment was checked for residual recording rows
and marked files. Existing catalogue and synthetic place datasets were
outside this run. Private recordings were used only for local trials.

[Saved numeric trials](recording-storage-results.json) include phase timings,
document I/O, and file sizes. [Reproduction commands](lab/README.md#recording-storage-experiment)
cover the importer, local trials, hosted probes, and logs.
