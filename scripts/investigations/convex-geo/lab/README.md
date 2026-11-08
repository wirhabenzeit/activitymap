# Hosted geo lab

Target: [spotted-fennec-603](https://dashboard.convex.dev/t/dominik-schroder/activitymap-geo-lab/spotted-fennec-603),
a development deployment in `dominik-schroder/activitymap-geo-lab`.

This is an independent package. The application TypeScript configuration excludes
it; its own Convex typecheck runs on deployment. All functions are internal and
require administrative CLI/dashboard access. No frontend or public test endpoints
are deployed. Package versions and the lockfile are pinned.

The deployment currently holds 1,403 synthetic points and the 80,366-point public
CH/AT/IT catalogue. Only the synthetic points are in the geospatial component.
The full catalogue is in the ordinary `places` table indexed by dataset and a
0.25-degree tile. The initial catalogue replay kept recordings local and sent padded
query bounds to Convex. Results contain no account or activity identifiers.

From this folder:

```sh
pnpm install --frozen-lockfile
pnpm exec convex deployment select spotted-fennec-603
pnpm exec convex dev --once --typecheck enable
pnpm exec convex run lab:seed --deployment spotted-fennec-603
pnpm exec convex run lab:probe --deployment spotted-fennec-603
```

Seeding is idempotent. `results/` and credentials are ignored. On a new local
checkout, recreate the catalogue export from the repository root:

```sh
node scripts/investigations/convex-geo/lab/export-catalogue.mjs
```

The export uses a read-only, repeatable-read transaction against the local Docker
Postgres instance and verifies the catalogue row count. It exports no accounts,
tokens, or recordings. The catalogue has **already been imported** into this
deployment. Do not repeat the append import: it would create duplicate rows.
For a fresh empty lab only, the initial command used was:

```sh
pnpm exec convex import --deployment spotted-fennec-603 --table places --append results/places.jsonl
```

Run these from the repository root to replay local recordings:

```sh
node --import tsx scripts/investigations/convex-geo/lab/replay.mjs
node --import tsx scripts/investigations/convex-geo/lab/replay.mjs --stress
```

The first run selects one recording from each of 24 GPS sample-count strata.
The stress run selects the union of the eight longest recordings and eight with
the most persisted place matches. Each checks exact candidate-ID equality against
Cartesian rectangle filtering of the full frozen catalogue, then deep-compares
the complete matching response against the same existing batch matcher using the
full catalogue. Local coverage and scoring are unchanged. This tests extraction
and matching parity, not the freshness of persisted production results.

`tiledWindows` pages tiles in separate queries, deduplicates their union and
post-filters by exact rectangle bounds. It fails explicitly above 256 tiles,
1,000 pages, 2,000 windows or 5,000 returned places. Those experimental budgets
are not proven sufficient for a whole library. Failure is never an empty success.
No concurrent catalogue publishing is implemented: the imported snapshot must
stay immutable throughout a comparison.

Use `convex logs --history 1000 --success --jsonl` to obtain actual query read
bytes/documents and cache status. This command keeps streaming; stop it after
capturing the relevant completed executions. `deployment usage --json` supplies
cumulative usage but can lag. Neither CLI wall time nor JSON export size is a
substitute for database read measurements.

See [hosted findings](../hosted-findings.md) and [saved measurements](../hosted-results.json).

## Full-library worker comparison

The [full-library report](../full-library-findings.md) records the subsequent
4,602-activity comparison. Create a temporary deployment key from this folder
before running it (the key from the recorded run has already been revoked):

```sh
pnpm exec convex deployment token create activitymap-full-library-benchmark --deployment spotted-fennec-603 --save-env .env.benchmark
pnpm exec convex logs --deployment spotted-fennec-603 --history 0 --success --jsonl > results/full-library-final-cloud-logs.jsonl
```

Leave log capture running during the benchmark. In another terminal, from the
repository root:

```sh
node --conditions=react-server --import tsx scripts/investigations/convex-geo/lab/full-library.mjs
```

This runs the actual PostGIS worker with read-only lease/commit callbacks, freezes
its groups locally, then runs uncached and cache-enabled Convex passes. The
independent candidate oracle exhaustively filters the checksum-verified catalogue;
complete response hashes still come from the original PostGIS worker.
`--replay-plan` reuses the recorded baseline/groups; input and catalogue identities
must still agree. The ignored `plan-private.json` contains local activity IDs and
query windows, and must not be committed. The saved public summary contains counts
and measurements only.

After the run, stop log capture and run `node
scripts/investigations/convex-geo/lab/summarize-full.mjs` from the repository root.
It requires every expected action and query log and all parity assertions to pass.
Then revoke the temporary key from this folder:

```sh
pnpm exec convex deployment token delete activitymap-full-library-benchmark --deployment spotted-fennec-603
```

Remove the now-revoked `.env.benchmark` file. `diagnose-full.mjs` is a read-only
helper for candidate-list differences; it separately checks final responses and
writes detailed coordinates only to the ignored results folder.

## Recording storage experiment

The [recording storage report](../recording-storage-findings.md) separates local
filesystem measurements and synthetic hosted results. Use Node 22 and install
the root and lab lockfiles first. The lab imports the application's validator,
summary and matching core as source modules.

From this folder, run the local checks and comparison:

```sh
node --import tsx --test recording/codec.test.mjs
node --import tsx benchmark-recordings.mjs
node --import tsx benchmark-recordings.mjs --local-database
```

The optional local database run reads three GPS-bearing recordings from the
local Docker Postgres fixture database in a read-only transaction. It removes
temporary private files and saves aggregate trials in the ignored
`results/recording-storage-local.json`. Import an individual raw keyed JSON
payload into the ignored local folder with:

```sh
node --import tsx import-recording.mjs /path/to/local-payload.json
```

That command validates the complete payload, writes a compressed file, a
manifest and a separate summary, reopens them to verify equality, then
publishes the verified directory under `results/imported-recordings/`. Keep
that directory local.

Deploy and measure the generated fixtures on the existing dev lab:

```sh
pnpm exec convex dev --once --typecheck enable
node --import tsx benchmark-recordings-hosted.mjs
```

Confirm the dev target is `spotted-fennec-603` before deploying. Hosted
functions accept only fixture labels for recording generation. The benchmark
writes measurements to the ignored `results/recording-storage-hosted.json`.
Each hosted probe erases its synthetic recording after verification. The
guard probe also verifies immediate reaping of a superseded upload using
registered attempt metadata without supplying the storage ID. An interrupted
writer's attempt is scheduled for cleanup after its deadline.

To inspect measured database and storage I/O, use
`pnpm exec convex logs --deployment spotted-fennec-603 --history 100 --success --jsonl`
and retain the completed `recordingProbe:run` actions and their
`recordingRows:*` child calls. Stop log capture after the relevant executions.

## Durable fixture ingestion

Deploy to the existing development lab and run one hosted suite at a time
from this folder. The suite audits the lab's recording files created during
its run, so keep other recording probes idle until it finishes.

```sh
pnpm exec convex dev --once --typecheck enable
pnpm exec convex run ingestionProbe:run --deployment spotted-fennec-603
```

The probe creates generated accounts and fixture snapshots, submits internal
receipts, and waits for the deployed scheduler to execute workers, retries
and reconciliation. It revokes and erases the test accounts at the end,
then checks the file and upload-attempt tables. The internal CLI uses the existing lab login and generated provider data.

For a manual run, create an account through `ingestionJobs:createAccount`
with an application name starting with `fixture-`. Pass the returned
account ID to `ingestionJobs:setFixture` to install an authoritative fixture
snapshot. Its `value` takes a canonical decimal activity `key`, positive
integer `version`, `deleted` boolean, and `fixture` label
(`small`, `typical`, or `empty`). Submit the same value to
`ingestionJobs:receive` with a unique receipt key and `generation: 1`.
Read the owner-scoped job and current recording with
`ingestionJobs:current`. Revoke the fixture account with
`ingestionJobs:revoke` to fence in-flight work and erase its recordings.
The scheduled reconciliation also discovers fixtures that received no
receipt.

See the [durable ingestion report](../durable-ingestion-findings.md) for
the failure cases, cleanup timing and remaining integration boundaries.

## Hosted matching

The matching worker loads immutable gzip manifests and files, prepares tracks,
and reads ordinary quarter-degree tiles from the same checksum-verified
catalogue. It uses the application's matcher and coverage recipe. The commit
transaction verifies the run, owner generation, activity source, recording
manifest identity, recipe and catalogue revision before publishing a check and
a monotonically sequenced activity upsert. Only internal lab functions can
initiate or inspect work.

The replay uses an explicitly selected local Docker Postgres dataset. From the
repository root, reproduce the read-only baseline and the private upload
manifest before creating the benchmark key:

```sh
node --conditions=react-server --import tsx scripts/investigations/convex-geo/lab/full-library.mjs --baseline-only
node --import tsx scripts/investigations/convex-geo/lab/prepare-hosted-matching.mjs
```

Use the frozen baseline if reproducing the exact 194 historical groups. Verify
the manifest in the ignored `results/hosted-matching-private/` directory.
It contains the selected owner, recording hashes, eligible count and estimated
storage. Keep the manifest, recordings, group windows and detailed logs private.

From this folder, verify the dev target and deploy. The verifier checks the
existing catalogue against the exported row digest. Keep the existing
`places` import in place.

```sh
pnpm exec convex dev --once --typecheck enable
pnpm exec convex deployment token create activitymap-hosted-matching --deployment spotted-fennec-603 --save-env .env.matching-benchmark
pnpm exec convex logs --deployment spotted-fennec-603 --history 0 --success --jsonl > results/hosted-matching-cloud-logs.jsonl
```

With log capture running, run these commands from the repository root:

```sh
node --import tsx scripts/investigations/convex-geo/lab/upload-hosted-matching.mjs
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs single
MATCHING_STOP_AFTER=5 node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs actual
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs actual
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs frozen
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs parallel
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs bounded
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs isolated
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs synthetic
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs ingestion
node --import tsx scripts/investigations/convex-geo/lab/run-hosted-matching.mjs erase
```

`actual` uses the production candidate pool size, cluster queue, and sample
and section limits. `frozen` repeats the saved groups with one tile reader.
`parallel` checks the 12 frozen groups with the most tiles with up to four tile readers. `bounded` reruns the heaviest
observed sequential groups in smaller subgroups with the same response checks.
`isolated` runs the same groups at their original size with no other pass active.
`synthetic` includes a wide track that exceeds the tile budget and an
interrupted action that restarts from its lease recovery. `ingestion` opts a
generated account into matching, then checks publication, replacement and
deletion through the durable fixture provider. Rerun an interrupted upload or
verification command to resume its run. `reset` clears only a run's derived
results and group checkpoints, keeping its verified input files.

The private replay is pinned to the run's catalogue and administrative key.
A three-hour fallback expiry fences and erases an abandoned replay scope.
`erase` deletes its derived rows, recording manifests, summaries and files in
bounded transactions, then checks each published file ID for absence. After
the run, stop log capture and revoke the temporary key from this folder:

```sh
pnpm exec convex deployment token delete activitymap-hosted-matching --deployment spotted-fennec-603
rm .env.matching-benchmark
```

## Batch size and geographic spread

`batch-region-study.mjs` prepares repeatable, canonical-response-checked trials
against the existing catalogue. Generated controls hold total sample counts
constant while changing route overlap, tile density, or activity count. The
`profile-cold` mode uses a fresh tile-query cache namespace for each group.
Worker telemetry records entry/phase RSS and heap, sample/raw-byte counts,
candidate counts and phase durations. Execution logs provide action duration
and the memory value used for compute accounting; observed RSS is not substituted
for that value.

The fixture snapshot and catalogue exports from the earlier experiments are
required. From the repository root:

```sh
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs prepare --synthetic-only
```

In the lab directory, deploy instrumentation, create a temporary lab-scoped key,
and capture logs in a separate process:

```sh
pnpm exec convex dev --once --typecheck enable
pnpm exec convex deployment token create activitymap-batch-region --deployment spotted-fennec-603 --save-env .env.region-benchmark
pnpm exec convex logs --deployment spotted-fennec-603 --history 0 --success --jsonl > results/batch-region-cloud-logs.jsonl
```

From the repository root, the following path only uploads generated recordings;
an explicit assertion refuses private source records:

```sh
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs upload --synthetic-only
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs run --synthetic-only
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs extend --synthetic-only
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs run --synthetic-only
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs erase --synthetic-only
node scripts/investigations/convex-geo/lab/summarize-batch-region.mjs --synthetic-only
```

This runs three initial mixed-order repetitions, adds two repetitions plus
three uncached geography controls, and verifies erasure of every uploaded file.
The driver resumes at saved checkpoints. Do not rerun `prepare` over an active
session, since it creates new recording identities. Output under `results/` is
ignored; the summarizer publishes only anonymous aggregate measurements.
It excludes driver polling, start/lease checks and file billing from the
compute/descendant-I/O comparison, and distinguishes first publication from
later replay of an already-published result through saved trial order.

To compare the frozen private recordings **locally**, without uploading them:

```sh
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs prepare
node --import tsx scripts/investigations/convex-geo/lab/batch-region-local.mjs
```

The local runner creates a fresh Node process for each group and checks the
canonical PostGIS response. Candidate subsets are precomputed, so its timings
exclude catalogue loading, network, scheduling and hosted billing. Uploading
the private study (omitting `--synthetic-only` from `upload`) requires explicit
authorization for that transfer. The initial study kept private data local;
the subsequently approved hosted comparison completed and erased its private
and generated files. Its `erase` command also audits persisted canonical
responses and owner change sequences. Finalize that report with:

```sh
node scripts/investigations/convex-geo/lab/summarize-batch-region.mjs --complete
```

After hosted tests, stop log capture and revoke the temporary key from the lab:

```sh
pnpm exec convex deployment token delete activitymap-batch-region --deployment spotted-fennec-603
rm .env.region-benchmark
```

## Full-library batch-profile validation

The full-library extension reuses all 4,602 frozen local recordings and their
canonical expectations. It preserves the 194 original group boundaries and
splits within them for the 75k/12 MiB/36-activity and 50k/8 MiB/24-activity
profiles (369 and 554 groups respectively). Two repetitions reverse profile
order. Each repetition has separate local checkpoints and a persisted-result audit.
The second repetition reuses the uploaded recordings after clearing only the
derived test results. Each complete profile is audited and its outputs reset
before the next profile, so every pass measures fresh result publication. The approved scope is retained for seven days via the
internal `matchingReplay:retain` control; other replays keep the default
three-hour expiry.

Prepare locally from the repository root:

```sh
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs prepare --full-library --repetition=0
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs prepare --full-library --repetition=1
```

Each preparation hash-verifies the 238,729,963 compressed source bytes and checks
that every profile includes every recording exactly once. Prepared plans remain
private under ignored results directories. This does not upload data.

The full-library upload requires explicit authorization to transfer all 4,602
private recordings to the existing `spotted-fennec-603` development lab. The
initial attempt was blocked before upload; the user subsequently explicitly
approved the full transfer and requested that recordings remain available.
The approved validation completed successfully: all 2,234 groups passed on their
first attempt, all six persisted-result audits passed, and all 4,602 files were
retained until 2026-11-14 22:18 UTC. The temporary key was revoked. See the
[full-library findings](../full-library-validation-findings.md).

After transfer authorization, create a temporary key and start log capture from
the lab directory:

```sh
pnpm exec convex deployment token create activitymap-full-validation --deployment spotted-fennec-603 --save-env .env.full-validation
pnpm exec convex logs --deployment spotted-fennec-603 --history 0 --success --jsonl > results/full-library-validation-cloud-logs.jsonl
```

From the repository root run repetition 0, audit its results, then reuse its
files for repetition 1 in reverse profile order. Keep log capture running across
both repetitions. Do not prepare over an existing upload session or call `reuse`
after repetition 1 has started.

```sh
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs upload --full-library --repetition=0
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs run --full-library --repetition=0
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs audit --full-library --repetition=0
node scripts/investigations/convex-geo/lab/summarize-batch-region.mjs --full-library --repetition=0 --complete --retained
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs reuse --full-library --repetition=1
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs run --full-library --repetition=1
node --import tsx scripts/investigations/convex-geo/lab/batch-region-study.mjs audit --full-library --repetition=1
node scripts/investigations/convex-geo/lab/summarize-batch-region.mjs --full-library --repetition=1 --complete --retained
```

The summarizer writes separate anonymous per-repetition reports and keeps the
earlier selected-cohort reports intact. It retains the same accounting caveats:
fixed-allocation action compute and descendant I/O are measured, while driver
polling, start/lease checks and file billing are not a complete system invoice.
Every profile publishes fresh results; benchmark reset/audit traffic is excluded.
Compare full-pass totals and report
both repetitions, not just a pooled median of individual groups.

After both result/file-retention audits, stop log capture and revoke the temporary
key from the lab directory. Recordings remain until the reported retention
deadline; `erase --full-library --repetition=1` can remove them earlier using a
new temporary key.

```sh
pnpm exec convex deployment token delete activitymap-full-validation --deployment spotted-fennec-603
rm .env.full-validation
```

Combine the two completed reports with `node scripts/investigations/convex-geo/lab/summarize-full-validation.mjs` from the repository root.

## Existing-client fixture preview

See [client preview findings](../client-preview-findings.md) for the scoped
bridge, verification commands, setup and rollback.
