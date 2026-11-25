# Full-library batch-profile validation

The approved validation completed on **2026-11-08**. All **27,612 canonical
response comparisons** passed across **2,234 hosted matching groups**, with
complete execution logs and every matching action succeeding on its first
attempt. The independent exhaustive catalogue-candidate oracle passed for every
group. All 4,602 saved results and their owner change sequences were audited
after each of the six passes.

**Original groups remained cheapest in both repetitions.** The median compute
premium was 5.4% for the 75k profile and 13.8% for 50k. Smaller groups reduced
recorded JavaScript heap peaks but did not produce a meaningful process-RSS
reduction or a smaller billed allocation. The earlier 624 MiB reading did not
recur in this sequential full-library test.

[Complete aggregate measurements](full-library-validation-results.json),
[first repetition](full-library-validation-0-results.json), and
[reverse-order repetition](full-library-validation-1-results.json) contain the
numeric evidence. This extends the [selected-cohort comparison](batch-region-hosted-followup.md).

## Workload and method

- All **4,602 recordings** from the existing frozen local fixture snapshot:
  18,743,660 GPS samples, 811,800,673 raw JSON bytes and 238,729,963 compressed
  bytes. The existing immutable 80,366-place catalogue was reused.
- Expected matching statuses per pass: **3,719 complete, 824 uncovered and 59
  partial**. These are preserved application outcomes, not test failures.
- Two sequential repetitions: original → 75k → 50k, then 50k → 75k → original.
  One tile reader was used throughout. Query-cache reuse was allowed and actual
  database counters were recorded separately from logical scan counts.
- Original groups reproduce all 194 frozen groups. The capped profiles split
  within those original geographic boundaries: **75,000 samples / 12 MiB raw
  bytes / 36 activities** and **50,000 samples / 8 MiB / 24 activities**.
  An oversized individual recording is allowed to run alone. This measures
  splitting the existing grouping, not a newly optimized clustering algorithm.
- The original soft sample threshold can admit a final recording across its
  nominal limit. Observed maximum group sizes were 120,181 / 74,992 / 49,970
  samples and 97 / 36 / 24 activities. Maximum raw group sizes were 5.49 / 3.54 /
  2.35 MB, so byte caps did not bind this snapshot. Its largest single recording
  contained 45,262 GPS samples; larger policy-boundary fixtures were tested in
  the earlier [hosted matching investigation](hosted-matching-findings.md).
- Every profile published fresh checks. Its results were audited before clearing
  only derived benchmark outputs. The second repetition reused the same
  uploaded files, avoiding another transfer. Both repetitions ended with a
  successful audit of all 4,602 retained files.
- The hosted matching implementation stayed unchanged during measurement. A
  local runner checkpoint-numbering error at the first profile boundary was
  corrected before any 75k action started. The completed original pass remained
  intact. That rejected control request is excluded from matching-action costs;
  there were no matching-action retries.

## Runtime, compute and memory

Times and modeled cost below are medians of **two complete library passes**,
not sums of individual-group medians. Peak memory is the maximum across both
passes. The action-time range reports both observations.

| Profile  | Groups/pass | Action minutes | Range (minutes) | Compute vs original median | Modeled compute/pass | Max sampled RSS (MiB) | Max sampled heap (MiB) |
| -------- | ----------: | -------------: | --------------: | -------------------------: | -------------------: | --------------------: | ---------------------: |
| original |         194 |          20.25 |     19.93–20.56 |                   baseline |              $0.0557 |                 244.5 |                  118.5 |
| 75k      |         369 |          21.35 |     21.34–21.36 |                      +5.4% |              $0.0587 |                 242.5 |                  110.3 |
| 50k      |         554 |          23.05 |     22.62–23.47 |                     +13.8% |              $0.0634 |                 243.9 |                   97.4 |

Paired within each repetition, 75k increased compute by **7.2% and 3.8%**;
50k increased it by **13.5% and 14.2%**. The ordering was consistent, but two
repetitions do not establish a universal multiplier or a precise optimum.

Every logged Node action used **512 MiB** for compute accounting. The model is
`sum(action seconds × 0.5 GiB) / 3600 × $0.33`, using the published US Starter
marginal action rate before included allowances. Other regions have a published
1.3× multiplier. This is action compute, **not an invoice or total backend
cost**. [Convex rates and allocation](https://docs.convex.dev/production/state/limits).

Maximum sampled process RSS was **244.5 MiB** across the complete experiment.
The process-lifetime high-water counter reached **245.9 MiB**; it can include
previous actions in a reused process. No runtime-limit failures occurred.
Smaller profiles had lower recorded heap peaks (118.5 → 110.3 → 97.4 MiB), and
maximum sampled heap growth within an action was 77.8 / 51.4 / 47.9 MiB. Those
are useful working-memory observations, but they neither reduce the fixed
512 MiB compute allocation nor establish a need to shrink these original groups.

The median sum of caller-observed group durations was **21.34 / 23.69 / 26.19
minutes**. This includes dispatch, polling and the local candidate oracle, and
excludes upload, audits, resets and pauses. It is a benchmark-driver measurement,
not production UI latency. Group-duration p95 is likewise not single-new-activity
p95 because group sizes differ.

## Why smaller groups cost more

Each profile read exactly the same 238,729,963 compressed recording bytes per
pass. Splitting repeated catalogue scans, matching setup and metadata/commit
calls. The logical work was identical between repetitions of each profile:

| Profile  | Tile pages/pass | Logical rows scanned | Exact candidates (sum) | Worker + descendant executions | Median DB reads (MB) | Median DB writes (MB) |
| -------- | --------------: | -------------------: | ---------------------: | -----------------------------: | -------------------: | --------------------: |
| original |           1,493 |              104,395 |                 17,262 |                          2,269 |                59.29 |                  8.24 |
| 75k      |           2,017 |              153,021 |                 22,032 |                          3,493 |                74.64 |                  8.49 |
| 50k      |           2,467 |              196,054 |                 25,426 |                          4,683 |                91.30 |                  8.77 |

The median measured phase totals (seconds) show where the extra work appeared:

| Profile  | File reads | Decode/validate | Track preparation | Tile reads | Scoring/coverage/hashing |
| -------- | ---------: | --------------: | ----------------: | ---------: | -----------------------: |
| original |      176.5 |           214.0 |             129.5 |       56.5 |                    429.2 |
| 75k      |      171.7 |           200.0 |             124.7 |       73.6 |                    471.6 |
| 50k      |      172.6 |           197.6 |             124.0 |       84.0 |                    515.2 |

These phase totals exclude final commit and some action overhead, so they do not
sum to logged action duration. Cache hits mean logical pages/rows are not billed
reads. The function counters exclude driver polling, start mutations, future
lease checks and file accesses; benchmark audit/reset traffic is also excluded.
Fresh result publication is measured here, unlike the earlier selected-cohort
repeats that reused already-published checks.

File read/write billing counters were zero despite verified file downloads;
the actual log fields were checked. Verified transfer bytes must not be labeled
as measured billed file I/O. Total migration cost still needs file billing,
storage, all calls, authentication, client sync and operational work.

## Assessment and remaining scope

Keep original grouping as the cost baseline for this workload. The **75k / 36
activity profile is a reasonable conservative cap** if tighter bounds are desired,
with a measured compute premium around 5%. There is no demonstrated process-RSS
or billing advantage that requires adopting 50k (or the previously tested 25k)
as the default. No production batch setting was changed.

The full, mostly covered library confirms the selected cohort's cost ordering;
the conclusion no longer depends on extrapolating mostly uncovered activities.
Touched tiles and candidate density remain more useful geographic indicators
than overall map-envelope area. These results do not establish headroom for
arbitrary larger recordings, catalogue growth, different regrouping or concurrent
owners. The exact cause of the historical high RSS remains unresolved.

This completes the repeated full-library correctness, memory and matching-action
cost comparison for these three profiles. It does **not** complete a
production-equivalent PostGIS comparison: the earlier 56.3-second local read-only
PostGIS measurement excluded the hosted recording/persistence workflow. A
matched deployment comparison and whole-system cost remain part of the pilot.

## Retention, authorization and reproduction

The user explicitly approved uploading the full library and retaining it for
follow-up work. All **4,602 files remain in the isolated development lab**, with
automatic expiry scheduled for **2026-11-14 22:18 UTC**. The temporary deployment
key was revoked and its local file removed; log capture was stopped. No live
provider requests or production database mutations occurred. The original
catalogue and unrelated lab data were preserved.

The [lab instructions](lab/README.md#full-library-batch-profile-validation)
describe preparation, the two repetitions, audits, reuse and scoped erasure.
`validate-full-library.mjs` resumes the experiment from checkpoints;
`summarize-full-validation.mjs` checks both completed reports before combining
them. Private plans, source recordings, identifiers and detailed logs remain in
the ignored local results directories. Public reports contain anonymous metrics.
