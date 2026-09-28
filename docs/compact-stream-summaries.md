# Compact stream summaries — first delivery of #230

The chosen first format is `polyline-v1`: a JSON envelope containing independently
encoded scalar series and an interleaved geographic series. It preserves every
value in the existing rounded, version-1 summary; it does not change the
300-bucket sampling algorithm or the independently stored raw payload.

This implements compact storage and demand/batch transport. Activity DTOs,
bootstrap and delta sync still carry metadata only. Production rollout, native
cache/loader integration (#214/#215), library-page delivery measurements and the
backfill enablement goal remain separate work. This change does not close #230.

## Format

```json
{"codec":"polyline-v1","version":1,"basis":"distance","count":2,"distance":"?gE","altitude":"?S"}
```

The example decodes to distance `[0,10]` metres and altitude `[0,1]` metres.
`codec` versions the representation; `version` versions the sampling algorithm.
Source generation/revision/state stay in the existing response metadata. No TTL
is added. A codec conversion does not change source revision or generation.

| Field | Integer scale | Meaning |
| --- | ---: | --- |
| time | 1 | elapsed seconds |
| distance, altitude | 10 | metres, preserving 0.1 m precision |
| watts, heartrate | 1 | watts / beats per minute |
| latlng | 100000 | latitude, longitude in degrees |

For each series, multiply by its fixed scale, encode the first signed integer
relative to zero and subsequent signed differences relative to the previous
value. Map nonnegative differences to `2*d`, negative differences to `-2*d-1`,
then emit little-endian five-bit chunks with continuation bit 32 and ASCII
offset 63. This is Google's encoded-polyline integer technique, applied to
scalar data. GPS uses interleaved latitude/longitude with two independent
previous-value accumulators and matches standard geographic polyline vectors.
Normal JSON escaping applies; there is no extra base64 layer.

Present series have exactly `count` samples (GPS has `count` pairs). Missing
series remain omitted; an empty present series is `""` with count zero.
`basis: null` requires count zero. A non-null basis requires its axis series.
Envelope `summary: null` retains its existing unavailable/not-current meaning.
The codec never infers distance from time or from the route polyline: real bucket
means are irregular and are encoded explicitly.

Decoders reject unknown codec/sampling versions, counts outside 0–300,
truncation, trailing/overlong encodings, invalid characters, mismatched lengths,
out-of-range GPS and numeric overflow. Absolute scaled values are bounded by
2^40−1; a value consumes at most nine characters. TypeScript uses arithmetic
rather than signed 32-bit bitwise operations. Swift uses bounded Int64 arithmetic.
Encoders reject extra precision rather than quietly introducing quantization.

## Storage and APIs

`activity_streams.summary` remains JSONB and accepts either legacy arrays or the
tagged compact envelope. New ingestion and lazy regeneration write compact data
by default. `ACTIVITYMAP_STREAM_SUMMARY_STORAGE_FORMAT=json` selects legacy
writes for a reader-only rollout or rollback; both formats remain readable.
There is no DDL migration and no second copy of every summary. Raw JSONB is
untouched. Legacy summaries can be converted directly without loading raw data
or making Strava requests. Lazy generation for a previously missing/outdated
summary retains its existing behavior of reading stored raw data.

Existing `/activities/{id}/streams/summary` and `/stream-summaries?ids=…`
endpoints retain their exact JSON-array contract. New opt-in endpoints:

- `/api/v1/activities/{id}/streams/summary/compact` accepts the same
  `fetch=auto|none` and `refresh=true|false` controls and pending/retry semantics.
- `/api/v1/stream-summaries/compact?ids=…` serves stored-only batches of at most
  100 unique owned activity IDs.

Both retain ownership, session/rate-limit checks, state/revision fencing and
`private, no-store`. Stale data is withheld in both representations. No response
contains both representations. The web now uses the compact endpoints and keeps
encoded envelopes in its query cache; only mounted charts materialize arrays.
Decoded arrays leave memory when that chart unmounts. This does not add a web
persistent/offline stream cache.

The generated Swift DTOs include both contracts. `CompactStreamCodec` is a
Foundation-only encoder/decoder. Its golden vectors, malformed inputs, and
encoded file reopen are tested without a simulator. The native stream branch
should reuse its current scopes, request fences, retries and independent raw
cache, changing the summary transport/storage DTO to
`ActivityCompactStreamSummary`. Persist that encoded DTO as Data and track
`summary.codec` independently from `summary.version`. Decode off the main actor
only for a visible consumer. The native cache/loader itself is still #214/#215.

## Bounded conversion and rollback

Do not run an older array-only server against a database already containing
compact summaries. Use this deployment sequence:

1. Deploy the dual-reader server with
   `ACTIVITYMAP_STREAM_SUMMARY_STORAGE_FORMAT=json`. Keep old endpoints available.
2. After old server/worker invocations have drained, switch writes to
   `polyline-v1` (the default) and migrate existing summaries in bounded batches.
3. Verify both endpoint formats and continue tracking ingestion/retry errors.

The converter uses the existing guarded migration connection/host/database
variables and verifies the connected identity. It defaults to a read-only
preview. Example using a disposable local test database:

```sh
export MIGRATION_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55439/activitymap_test
export MIGRATION_EXPECTED_HOST=127.0.0.1
export MIGRATION_EXPECTED_DATABASE=activitymap_test
export MIGRATION_REQUIRE_TARGET_GUARDS=true
pnpm db:convert-stream-summaries --format polyline-v1 --limit 100
pnpm db:convert-stream-summaries --format polyline-v1 --limit 100 --apply --confirm 127.0.0.1:55439/activitymap_test
```

Each invocation processes at most 100 rows by default (maximum 1000), in a
transaction with a five-second statement timeout, row locks and SKIP LOCKED.
It is restartable: already converted rows are excluded. Reported byte counts
are serialized JSON, not measured disk savings. The existing stream update
trigger emits ordinary activity upserts for changed rows; conversion can thus
produce one additional delta event per activity. It does not repeatedly rewrite
current-format rows or change source freshness. Sync still contains no arrays.
Zero selected rows can mean another worker holds locks; verify remaining rows
when workers are quiet before declaring conversion complete.

For rollback, first deploy the dual-reader build with legacy writes enabled,
then run the same converter with `--format json` until no compact rows remain.
Verify with `SELECT count(*) FROM activity_streams WHERE summary->>'codec' IS
NOT NULL` before reverting to an array-only server. Coordinate the web rollback
as well: the new web client expects the compact endpoints. Codec-compatible
application rollback needs no conversion. No converter is run automatically
against production by this PR or by deployment builds.

## Measurements and limits

The reproducible [benchmark](compact-stream-summary-benchmark.json) uses ten
synthetic cases: short/long rides, smooth/noisy power, negative/flat altitude,
pauses/irregular axes, time-only/no GPS, sparse sensors and a GPS discontinuity,
plus no usable axis. It measures complete supported summaries, including JSON
envelopes, Node gzip/Brotli and stored PostgreSQL JSONB `pg_column_size`.
The synthetic signals are deliberately structured; they are not representative
p95 real-world compression statistics. #230's earlier real-activity prototype
remains separate evidence.

On the local run, the nine nonempty cases reduced gzip size by 56–88% and stored
JSONB column size by 64–88%. A no-axis summary grows from 26 to 58 JSON bytes
because of the codec header. Warm JavaScript decode p95 was below 25 µs for this
small corpus on the development Mac. This is not an iPhone/UI performance budget
or a peak-memory measurement. Raw storage is unchanged, so these percentages
must not be applied to the entire database.

Reproduce with `pnpm benchmark:compact-streams`. Optionally supply
`BENCHMARK_DATABASE_URL` for a local `*_test` PostgreSQL database; it creates only
a temporary table. The script also writes vectors under `/tmp` for
`bash scripts/verify-compact-stream-codec.sh /tmp/activitymap-compact-benchmark-vectors.json`.
Both language implementations must exactly round-trip the existing summaries.

Do not infer that embedding all summaries in activity sync is affordable from
these numbers. A later delivery must measure real compressed activity pages,
large-library bootstrap/delta traffic, native cache size/latency and peak memory,
and define how newly available/re-encoded summaries reach already-synced clients.
