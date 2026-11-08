# Full-library Convex tile comparison — 2026-11-07

The tile approach passed the full local library: **4,602 / 4,602 complete response
comparisons** in both uncached and cache-enabled runs. Local PostGIS was faster
in this setup. Hosted Convex catalogue lookup usage was inexpensive, but this
does not establish the cost of migrating the whole backend.

Machine-readable evidence: [full-library-results.json](full-library-results.json).
The isolated deployment remains
[spotted-fennec-603](https://dashboard.convex.dev/t/dominik-schroder/activitymap-geo-lab/spotted-fennec-603).

## Workload and comparison

All 4,602 local activities were eligible under the actual worker's current-stream
and connected-account predicates. The catalogue contained 80,366 places.
`processPlaceMatching` formed the PostGIS baseline using its real limits:
500 activities per pass, 40-second deadline, spatial clustering, 100,000-sample
input/preparation budget, 1,000-section preparation threshold, and five-second
preparation limit. The input sample threshold can be exceeded by the final
recording admitted, as in production. Activity-ID order supplied the initial
candidate priority for this deliberate full rematch.

That produced ten worker passes and 194 groups: median 22 activities, p95 52,
maximum 97. Input reads were batched 192 times. The exact windows and activity
identities were then frozen locally and replayed against Convex. Each tile was
loaded only once per group, regardless of how many activities overlapped it.
The same TypeScript scoring and coverage engine ran locally in all cases.

Leases and result writes were replaced by read-only verification callbacks.
There were no changes to stored checks, sync feeds, production data or Strava.
Recordings stayed local; Convex received the catalogue query bounds. Snapshot
identity and input versions were checked. The temporary deployment key used for
direct HTTP calls was revoked after testing, and its local file removed.

## Correctness

Both Convex modes preserved all 3,719 complete, 824 uncovered and 59 partial
responses, including their places, visit positions and stream/version fields.
Comparison hashes use canonical JSON of the entire response, not just counts.

The initial raw-candidate comparison exposed four PostGIS bounding-box extras:
one point in each of four groups lay outside their exact Cartesian rectangles.
Convex correctly omitted those points. There were no metadata changes or omitted
points inside the exact rectangles. All 95 activities in those groups retained
identical final responses in a separate diagnosis.

The final clean rerun independently filtered **every point in the frozen,
checksum-verified catalogue** against every group's exact rectangles. Convex
candidate IDs and metadata agreed with that oracle for all groups. Final matching
responses still had to agree with the original unfiltered PostGIS baseline.
This separates exact rectangle parity from the existing PostGIS `&&`
[bounding-box predicate](https://postgis.net/docs/geometry_overlaps.html).
No matcher or production query behavior was changed to obtain parity.

## Performance

| Measurement                              | Local PostGIS | Hosted Convex, uncached | Hosted Convex, cache enabled |
| ---------------------------------------- | ------------: | ----------------------: | ---------------------------: |
| Read-only full run                       |        56.3 s |                  99.3 s |                       86.5 s |
| Catalogue loading, caller-observed total |        5.70 s |                 53.39 s |                      40.87 s |
| Catalogue load median per group          |         29 ms |                  226 ms |                       168 ms |
| Catalogue load p95 per group             |         33 ms |                  625 ms |                       443 ms |
| Convex server-side load total            |             — |                 24.13 s |                      11.63 s |
| Convex server-side median per group      |             — |                   97 ms |                        16 ms |
| Candidate rows returned across groups    |        17,266 |                  17,262 |                       17,262 |
| Actual Convex database bytes read        |             — |                58.00 MB |                     17.02 MB |
| Actual Convex documents read             |             — |                 104,395 |                       30,527 |
| Tile query calls / cache hits            |             — |               1,493 / 0 |                  1,493 / 807 |

Both Convex modes made 194 action calls. Cache-enabled execution began with a
new cache-key namespace, then reused pages across groups: it was not a wholly
prewarmed run. Uncached execution used a separate namespace for each group.
No cross-group application cache was used. The caller used the HTTP client
directly, avoiding CLI startup/authentication overhead per group.

The baseline includes worker planning, stream reads, preparation and scoring.
Convex replays include stream rereads and preparation/scoring for the frozen
groups, but do not rerun worker scheduling or write results. Local input reads
took about 26 seconds per Convex pass and matching about 19 seconds. These are
single full-pass measurements, not repeated throughput trials.

The local-versus-hosted topology matters: roughly 29 seconds of each Convex pass
was outside its reported action processing time. That is caller-observed remote
overhead, not a direct network-only measurement. The PostGIS loader also performs
catalogue metadata/count/revision validation, while Convex uses the already pinned
immutable exported snapshot. These results do not predict a co-located production
worker's latency. PostGIS matching-field JSON totalled 3.27 MB; that is payload
size, **not** a comparable measurement of Postgres internal database I/O.

All 2,986 tile-query executions across the final two passes were accounted for
in Convex logs. The largest query read 145,162 bytes / 256 documents, and maximum
user-code query time was 14.7 ms (rounded upward). No tile, page, result or
execution budget was exhausted. This provides headroom for these fixtures,
not a guarantee for larger catalogues or arbitrary future routes.

## Cost

Using published Starter marginal rates of $0.22 per GB of database I/O,
$2.20 per million function calls, and $0.33 per GB-hour of action compute:

| Catalogue lookup work for one full rematch |                  US rates | Other regions, 1.3× |
| ------------------------------------------ | ------------------------: | ------------------: |
| Uncached                                   | approximately **$0.0157** |         **$0.0205** |
| Cache enabled                              | approximately **$0.0073** |         **$0.0095** |

These are modeled marginal usage charges **before included allowances**, not an
invoice or total rematch price. Database bytes come from actual execution logs;
the conversion to GB follows the usage counter's 2^30-byte scale. The calculation
counts all query/action calls and conservatively estimates action compute from
elapsed time × 64 MiB; CPU-based billing may be lower. It excludes the initial
import, persistent storage, streams, result writes, sync/auth and matcher hosting.
See [Convex limits and pricing](https://docs.convex.dev/production/state/limits).

A per-rematch Neon price was **not measured**: the PostGIS baseline ran on local
Docker, and local elapsed time cannot be converted reliably into hosted compute
usage. Neon Launch's published $0.106/CU-hour is time-based, so allocated compute,
other work and idle/wake behavior matter. The earlier issue's $8.32/week compute
audit covered the whole backend; it must not be compared directly with this
catalogue-only Convex estimate. [Neon pricing](https://neon.com/pricing)

## Decision

The full-library correctness gate passes for the existing local corpus. Continue
with the tile approach if exploring Convex: the beta S2 component is unnecessary
for this catalogue-loading path. The measured lookup cost is small; a cost saving
over the entire existing backend remains unproven.

Before choosing a migration, measure a worker near the Convex deployment, test
bounded parallel tile reads and leaner catalogue documents, and include stream
reads plus checkpoint writes in an end-to-end hosted run. The uncached loader
examined about six documents per returned candidate, so tile size is another
useful optimization variable. Keep the existing matching recipe unchanged.
The production audit's 172,071-point maximum is outside this local corpus; larger
production recordings and concurrent catalogue publication remain separate tests.
