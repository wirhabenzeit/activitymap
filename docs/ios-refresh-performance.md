# iOS refresh performance

Measured on 12 November 2026 against the production revision `b601cab2`,
served by `activitymap.cc` from the deployment created at 08:08 CET. The app
uses Convex for authentication, request counters and library data. iOS still
uses the authenticated v1 HTTP API and polls while active.

## Production measurements

The available production logs cover successful requests at 19:45 and
20:07–20:08 CET. They do not cover the earlier reported 30-second refresh.

| Request                    | Observed server duration |
| -------------------------- | ------------------------ |
| `GET /api/v1/me`           | 766–1,782 ms             |
| `GET /api/v1/sync/changes` | 1,050–1,248 ms           |

iOS verifies the session before requesting changes. One observed pair spent
1,574 ms in `/me` and 1,248 ms in `/sync/changes`. These are handler durations;
they exclude phone networking, local persistence and function startup before
the handler begins. Logs do not identify the client platform.

A separate read-only probe of the production Convex bridge, from the Mac,
measured four empty polls. Each made three sequential requests: retention,
head and changes. Their combined durations were 643, 463, 397 and 403 ms.
The latest 100 events referenced 52 distinct activities. Resolving those
activities needed seven additional bridge calls in two waves, taking 656 ms.
These direct bridge measurements describe a different network path from
Vercel's Frankfurt functions and must not be added to the production durations.
No production records were changed by the probe.

A backlog amplifies the cost: the old iOS client requests 100 events at a time,
each page repeats admission and sync metadata reads, and catch-up finishes
with an empty poll. This is a plausible contributor to intermittent long
refreshes; the reported 30-second case was not reproduced.

## Changes

- The application backend returns the head, validated cursor range, current
  activity/photo DTOs, tombstones and continuation sequence in one query.
  It preserves ordered delivery, owner/epoch/generation fences, retention
  rejection and the 2 MiB item budget. Superseded upserts advance the cursor;
  a deferred item does not. The lab adapter retains its existing read path.
- Session and IP rate counters are checked in one ordered mutation. An
  exhausted bucket still stops before authentication and later buckets;
  the user limit remains after session verification. No auth cache is added.
- iOS requests up to 500 events per page. This reduces HTTP round trips for
  small-event backlogs by up to five times; the byte budget still limits
  pages containing large routes.
- iOS reads the checkpoint without decoding the library. The controller
  reuses its published snapshot when the local store has no committed
  activity/photo changes or matching-version invalidation. Writes, edits,
  replacement and security cleanup invalidate reuse after a successful save.
- Request logs and `Server-Timing` now report authentication, rate-limit and
  sync phases with call counts. Times for concurrent calls are cumulative
  and can overlap. Native `Sync` logs record delta request count, item count,
  network time, persistence time and total time, including failed passes.
  Diagnostics contain no tokens, user IDs or activity contents.

## Native benchmark

`SyncRefreshPerformanceTests.cachedRefresh` runs the real controller and
SwiftData store on an iPhone 17 simulator with iOS 27, in Debug. It seeds
4,602 synthetic activities with route strings and measures three warm,
unchanged refreshes with a network-free source. Library creation and the
first load are outside the timed samples. Background summary work remains
enabled as in the app.

| Local refresh             | Samples                | Median   |
| ------------------------- | ---------------------- | -------- |
| Production implementation | 393.5, 392.5, 399.8 ms | 393.5 ms |
| Optimized implementation  | 78.8, 80.2, 82.3 ms    | 80.2 ms  |

That is an 80% reduction, or about 4.9 times faster, for this isolated local
refresh workload. It is not an end-to-end phone or production improvement.
The updated server has not been deployed or timed in production.

Run the native measurement with the project's existing simulator test setup
and `-only-testing:ActivityMapTests/SyncRefreshPerformanceTests`. Look for
`SYNC_REFRESH_BENCHMARK` in test output.

## Release and verification

Validation passed: 1,049 app tests, 78 backend tests, 87 focused native tests,
app and backend type checks, lint, changed-file formatting and the production
Next build with Webpack. Native regressions include expiry, cancellation,
replacement, editing, place invalidation and failed photo-cache recovery.

1. Deploy the Convex backend first. It adds `changesPage` and `rateLimits`;
   existing app releases continue using the old operations.
2. Deploy the web/API change. It requires those new backend operations.
3. Release the iOS change. Its larger page request also works with the prior
   API because the v1 contract already allows a limit of 500.
4. Compare `/me` and `/sync/changes` duration and phase counts for warm
   refreshes and a backlog. Capture iOS `Sync` logs if a long refresh recurs.

The fixes preserve the existing HTTP sync protocol and do not add native
Convex subscriptions. Session verification, expiry and revocation remain on
every refresh.
