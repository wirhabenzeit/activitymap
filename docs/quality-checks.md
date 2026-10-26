# Quality checks

Use Node 22+ and the repository's pinned pnpm version. Install dependencies with
`pnpm install --frozen-lockfile`. The commands below do not run migrations or need
a database. Database integration checks remain in the separate CI job with its
explicit disposable Postgres service.

| Command                                | Boundary                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                           | TypeScript, ESLint, generated catalogs/DTOs, TypeScript unit suites, browsing/stats/settings UI unit suites, harness safety tests |
| `pnpm typecheck` / `pnpm lint`         | Static checks only                                                                                                                |
| `pnpm check:generated`                 | Map, stats and presentation catalogs, plus Swift DTO drift                                                                        |
| `pnpm test:browser:install`            | Provision the lockfile-matched Playwright Chromium; append `--with-deps` on Linux                                                 |
| `pnpm test:browser`                    | Start an owned Next server and run reconciliation, list, stats, account and presentation fixture scenarios in Chromium            |
| `pnpm test:browser account`            | Run one named browser scenario (`reconciliation`, `list`, `stats`, `account`, `presentation`)                                     |
| `IOS_TEST_PROFILE=pr pnpm test:ios`    | Build the real iOS app; run all selected unit/app-hosted suites and focused real UI smoke methods on iOS 27                       |
| `pnpm test:ios`                        | Build and run the full native selection, including every method in the selected UI suites, on iOS 27                              |
| `pnpm format:check`                    | Nonmutating Prettier check of changed tracked and untracked files                                                                 |
| `pnpm format:check --base origin/main` | Check committed/local changes against their merge base; use the actual base branch for stacked PRs                                |
| `pnpm format:check src/path.ts`        | Check explicit files                                                                                                              |

## Browser runtime

The wrapper copies an allowlist of app sources and shared fixtures into an owned
`.quality/browser-*` directory, links installed dependencies, and invokes the
Next CLI directly with webpack and an explicit workspace root inside that copy.
It never calls migration-bearing `pnpm dev` or `pnpm build`. Local `.env*` files
are excluded, inherited service credentials are removed, database URLs point to
unused loopback port 1, and external effects are disabled. Browser requests to remote hosts, unmocked APIs or non-read methods are
blocked; scenario-specific fixture routes provide needed API responses.

The server binds loopback on a fresh port. Readiness requires a per-run UUID
response from this server, so an occupied port or unrelated server cannot pass.
The wrapper creates all selected routes before starting Next. Their shared source
is also used by standalone scripts, which continue to create routes only if
absent. A per-run ownership token and exact source check permit reuse only inside
the harness. Prepared routes/types remain until wrapper cleanup, and all selected
fixture entries stay warm for the fifteen-minute server budget; removing one
scenario or evicting its dev entry must not Fast Refresh another tab mid-test.
Fixtures and generated Next files live in the owned copy; startup
failure, test failure, timeout and SIGINT/SIGTERM clean that copy. A preexisting
developer fixture remains untouched and causes the scenario to fail safely. The checkout's environment and source
files are never used as scratch storage.

The CI smoke boundary runs the **five complete fixture scripts**, not all app
features: list inspection at desktop/tablet/phone widths (keyboard, history,
selection and paging), stats focus/drilldown across widths with dark/reduced-motion
cases, mocked account deletion failure/success with cache and sync fencing,
presentation/authentication states, and shared dialog/control behavior including
nested popup interaction, keyboard menus and React Activity hide/reveal.
This reuses their assertions and result lists. Each script's assertions are
limited to four minutes, server identity readiness to two minutes, and each
fixture's cold compilation to three minutes before the assertion processes
start. Compilation timings/failures are recorded separately in the summary; 5xx
responses fail immediately. The server has a fifteen-minute overall budget and
the CI job eighteen minutes, including all compilation and scenarios. The first
Linux run compiled the list in 67 seconds; a later cold run exceeded the old
two-minute in-scenario allowance before executing assertions. A local
system Chromium can be selected explicitly with `CHROME_PATH`; CI installs the
pinned browser and does not rely on a machine-specific executable path.

Evidence is in `output/quality/browser/<timestamp>/`: top-level summary and
server log, then each scenario's result JSON, screenshots, console/request events,
Playwright trace and test log. Failures also write their error and available page
screenshots/HTML. A browser-launch failure still has a process log and failure
summary. Open a trace with `pnpm exec playwright-core show-trace <trace.zip>`.
`QUALITY_OUTPUT` chooses an explicit output directory; use a fresh directory.

These are isolated UI regressions, not proof of live OAuth, database erasure,
external service availability, production Next builds, performance budgets or
manual accessibility acceptance. The separate database tests prove persistent
writes. Broader acceptance remains tracked in #198, #227, #229 and #387.

## Native runtime

The `xcode-27` runner and local Xcode 27+ run
`node scripts/quality/native-harness.mjs` (`pnpm test:ios` is an alias). No web
dependency install is needed. `IOS_TEST_PROFILE` selects `pr` or `full`; the
local default is `full`, and any other value fails before a simulator is created.

Pull-request CI and pushes to main explicitly use `IOS_TEST_PROFILE=pr` when
native-related files change. A cheap Ubuntu diff check covers iOS sources, shared
fixtures/catalogs, contracts/OpenAPI, stream codecs, native/testflight tooling and
the relevant workflows. Web-only changes skip the native app job; an unavailable
or invalid comparison conservatively runs it. This builds the real app and runs
all selected unit/app-hosted suites plus the following real UI smoke methods on
iOS 27:

- Keyboard-attached place hints and live activity-name filtering:
  `FilterPanelUITests/testSearchUsesKeyboardPlaceHintsAndRestoresFilterHeight`.
- Place autocomplete, filtering, details and Stats history:
  `PlaceSearchUITests/testPlaceAutocompleteFilteringDetailsAndStatsHistory`.
- Visited-place clustering, filtering and contextual activity picking:
  `ActivityPlacesUITests/testPlacesOverviewClusteringFilteringAndContextualActivityPicking`.
- Offline matched places on the map/profile, repeated encounters, style replacement and selection preservation:
  `ActivityPlacesUITests/testOfflineMapProfileStyleAndSelection`.
- Native GPX sharing, repeated cancellation and departure cleanup:
  `ActivityActionUITests/testGPXSharePresentsNativelyAndCleansUpRepeatedCancellationAndDeparture`.
- List previous-activity pull:
  `ActivityContinuationUITests/testListTopPullOpensPrevious`.
- Map next-activity pull:
  `ActivityContinuationUITests/testMapBottomPullAdvancesOnceAndReturnsToTop`.
- Stats intentional content/native-edge Back:
  `StatsUITests/testCalendarRetainsIntentionalContentAndNativeEdgeBack`.
- Standard Sport mix compact content, explicit expansion and focused controls:
  `StatsUITests/testCompactSportMixRequiresExplicitExpansionAndFocusedSettingsRemainReachable`.

This is a smoke boundary, not the complete UI matrix. The
[Full iOS runtime workflow](../.github/workflows/ios-full.yml) is manually
requested with **Actions → Full iOS runtime → Run workflow**, selecting the
branch or tag to test. It explicitly uses `IOS_TEST_PROFILE=full`, runs the same
unit/app-hosted selection and every method in the selected UI suites, and has no
automatic schedule. Run either profile locally with:

```sh
IOS_TEST_PROFILE=pr pnpm test:ios
IOS_TEST_PROFILE=full pnpm test:ios
```

The shared unit/app-hosted selection covers:

- `AdaptiveInspectionTests`, `BrowsingReconciliationTests`: native push/panel
  retention, cached-empty recovery, route eligibility and browsing actions.
- `StatsPresentationPolicyTests`, `StatsScopeTests`, `StatsDashboardTests`,
  `StatsFixtureTests`, `StatsCalendarLayoutTests`,
  `StatsCalendarScrollRenderingTests`: comparison/formatting parity, scope,
  chart/calendar layout and retained scroll/rendering behavior.
- `DetailBackGestureTests`: horizontal scroll ownership and Back arbitration.
- `APIErrorFactsTests`, `AuthRecoveryTests`, `ActivityEditingTests`,
  `ActivitySharingTests`: structured errors, recovery and activity mutations.
- `SyncControllerTests`, `IngestionStatusTests`, `StravaImportTests`,
  `StreamsAPITests`, `StreamSummaryLoaderTests`, `StreamSummarySyncTests`,
  `SpeedDisplayTests`: sync/import/stream lifecycle and display policies.
  Catch-up batching uses 206 activities to cover three batches, a partial final
  batch, ordering, repeat-start idempotence and offline reads. The redundant
  5,000-activity run repeated these same assertions without a performance bound.
- `PresentationTests`, `DisplayPreferencesTests`, `StravaConnectTests`:
  semantic catalog, preference and connection policies.
- `ActivityFilterTests`, `ActivityStoreSelectionTests`, `SelectionFixtureTests`:
  filtering, selection/reconciliation and shared fixture contracts.
- `MapPhotoTests`, `MapResultsTests`, `ActivityContinuationTests`,
  `PhotoGalleryTests`: photo availability, result navigation, continuation,
  gallery state and image request/cache behavior.

The full UI selection additionally exercises every method in
`ActivityActionUITests`, `StatsUITests`, `MapPhotoUITests`, `MapRotationUITests`,
`ActivityContinuationUITests` and `ListSelectionUITests`. It includes the
seven-state activity action matrix, cached-elevation GPX export, compact/focused
Stats and calendar panning/anchor retention, map/photo interactions, sheet
rotation, all fifteen continuation journeys and List selection/Back behavior.
Those additional journeys are not certified by a passing PR smoke run.

| Limit                                       | PR profile | Full profile |
| ------------------------------------------- | ---------- | ------------ |
| Cold `build-for-testing`                    | 18 minutes | 18 minutes   |
| `test-without-building`                     | 12 minutes | 45 minutes   |
| CI job, including setup and artifact upload | 35 minutes | 75 minutes   |

Both workflows cache Swift packages, compiled products and compiler modules.
Cache compatibility includes the runner architecture, Xcode/SDK/OS fingerprint,
resolved package versions, project/scheme/configuration and harness. Each commit
gets a new cache entry, restoring the newest compatible entry as its starting
point. Xcode still builds and checks changed sources; no test execution is
cached. A completed build is saved even if runtime tests subsequently fail;
failed or cancelled builds cannot populate the cache. Indexes, test results and
logs are excluded. Cache restore/save are optional and each has a two-minute
deadline. The first compatible run still has a cold build.

Builds use only the simulator's active architecture, disable indexing, and use
the committed `Package.resolved` without remote update checks. Superseded runs
for the same pull request are cancelled. `summary.json` records separate boot,
build and test durations, and failures print their test identifiers and messages
in the Actions log.

Both profiles retain three-minute simulator boot readiness, disabled parallel
test execution, and enabled per-test timeouts configured with a 90-second default
and a 180-second maximum. XCTest rounds execution allowances up to whole minutes;
the maximum caps a test's preferred allowance rather than granting extra time to
every test. See [Apple's allowance documentation](https://developer.apple.com/documentation/xctest/xctestcase/executiontimeallowance).
The wrapper requires a positive passing count, zero failures/skips, positive
passing cases in every selected suite and execution of each selected PR method.
An interrupted or failed full run is not counted as passing coverage.

The action accessibility matrix has seven independent UI methods (standard,
large text, no GPS, summary, dark, landscape and RTL), each retaining the same
assertions and its own per-test deadline. The former single method exhausted
XCTest's rounded two-minute allowance during its fifth app launch on the hosted
runner. The 20 October full run also reached its old 35-minute runtime cap during
the last Stats method. The full profile now has 45 minutes for runtime and a
75-minute workflow budget covering the separate cold build, simulator startup
and artifact upload. PR smoke and individual-test deadlines are unchanged.

Before the profile split and Sport mix test-helper correction, the full selection
passed locally on 20 October 2026 with Xcode 27.1 and an iPhone 18 Pro / iOS 27.0 simulator: 261 logical tests,
376 runtime executions across 36 suites, including all 32 UI methods, with zero
failures or skips. Evidence is
`/private/tmp/activitymap-full-native-46d4b3d8/Results.xcresult`. The hosted run
on the same native sources failed the Sport mix scroll-reachability assertion
and then exceeded the former 25-minute whole-test budget; that run is not a full
pass. Its reveal helper compared content against the scroll view’s full frame
and repeatedly scrolled an expansion control farther behind the navigation bar.
The helper now excludes the obstructing navigation bar from its viewport;
standard and large-text Sport mix run independently with the same assertions.
The standard journey is retained in PR smoke coverage. Full coverage remains
available through the manual workflow after merge.

The wrapper creates an iPhone 17 Pro on the newest available iOS 26+ runtime,
boots it, and deletes only that owned device on completion/failure. Counts above
refer to iOS 27; older-runtime eligibility is recorded explicitly, and ineligible
checks are not counted as passing or skipped. Set `IOS_DEVICE_NAME` to another
installed device type, or explicitly set `IOS_SIMULATOR_UDID` to reuse an existing
device; supplied devices are never shut down or deleted. Do not run multiple
harnesses against the same simulator or DerivedData directory.
`IOS_DERIVED_DATA` can reuse a caller-owned build cache; otherwise
`.quality/ios-derived` is retained for later runs.

The photo-viewer rendering test waits for fixture pixels before checking text.
Vision recognition runs off MainActor: cold OCR initialization on a fresh
simulator previously blocked photo publication past the rendering deadline.
Pixel visibility, page number, caption and selection assertions remain required.

Build settings use inert API/Mapbox fixture values. UI journeys launch DEBUG-only
offline app fixtures; app-hosted suites supply isolated stores and fixtures within
their tests. Both workflows retain stream DTO compatibility and compact-codec
prechecks. The DTO check compiles the baseline separately only when its generated
source differs; the current proof already includes all baseline assertions.
Evidence in `output/quality/ios/<timestamp>/` records the profile and
selection, separate `xcodebuild-build.log` and `xcodebuild-test.log`, toolchain,
boot logs, summary, per-test tree and `Results.xcresult`. Open the bundle in Xcode
for attachments and failures. Both workflows upload evidence even when a job
fails. The separate `swift-client` job remains compile-only.

The selection deliberately excludes broad app-hosted SwiftUI accessibility
traversal checks: that host can yield an empty AX tree and cannot substitute for
XCUI. The retired rendered map/photo, List and action-row checks were replaced
with real UI automation. No accessibility assertion is replaced by OCR. Other
rendered suites and physical-device touch/VoiceOver acceptance remain separate;
failures there are not silently treated as passing here. Pending broader
photo-pipeline/sync-integrity and filter/GPX suites remain outside this selected
boundary.

## Formatting policy

`prettier.config.js` is the only Prettier configuration. Import sorting uses the
actual `~/` alias and preserves side-effect import ordering; the Tailwind plugin
runs last. `eslint.config.mjs` is the active flat ESLint config. Scoped format
checks never rewrite files, and unsupported formats are ignored. To format an
intentional edit, run `pnpm exec prettier --write <explicit-files>`. Existing
repository formatting debt is not swept into a change; CI checks files changed
against the PR's actual base, not the entire repository.
