# Quality checks

Use Node 22+ and the repository's pinned pnpm version. Install dependencies with
`pnpm install --frozen-lockfile`. The commands below do not run migrations or need
a database. Database integration checks remain in the separate CI job with its
explicit disposable Postgres service.

| Command                                | Boundary                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                           | TypeScript, ESLint, generated catalogs/DTOs, TypeScript unit suites, stats/settings UI unit suites, harness safety tests |
| `pnpm typecheck` / `pnpm lint`         | Static checks only                                                                                                       |
| `pnpm check:generated`                 | Map catalog, stats tile catalog and Swift DTO drift                                                                      |
| `pnpm test:browser:install`            | Provision the lockfile-matched Playwright Chromium; append `--with-deps` on Linux                                        |
| `pnpm test:browser`                    | Start an owned Next server and run list, stats and account fixture scenarios in Chromium                                 |
| `pnpm test:browser account`            | Run one named browser scenario (`list`, `stats`, `account`)                                                              |
| `pnpm test:ios`                        | Build and run the six selected iOS suites on an owned simulator                                                          |
| `pnpm format:check`                    | Nonmutating Prettier check of changed tracked and untracked files                                                        |
| `pnpm format:check --base origin/main` | Check committed/local changes against their merge base; use the actual base branch for stacked PRs                       |
| `pnpm format:check src/path.ts`        | Check explicit files                                                                                                     |

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
the harness. Prepared routes/types remain until wrapper cleanup, and the three
fixture entries stay warm for the fifteen-minute server budget; removing one
scenario or evicting its dev entry must not Fast Refresh another tab mid-test.
Fixtures and generated Next files live in the owned copy; startup
failure, test failure, timeout and SIGINT/SIGTERM clean that copy. A preexisting
developer fixture remains untouched and causes the scenario to fail safely. The checkout's environment and source
files are never used as scratch storage.

The CI smoke boundary runs the **full existing three scripts**, not all app
features: list inspection at desktop/tablet/phone widths (keyboard, history,
selection and paging), stats focus/drilldown across widths with dark/reduced-motion
cases, and mocked account deletion failure/success with cache and sync fencing.
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

The `xcode-27` CI runner and local Xcode 27+ run `node scripts/quality/native-harness.mjs`
(`pnpm test:ios` is an alias). No web dependency install is needed for this script.
The wrapper creates an iPhone 17 Pro on the newest available iOS 26+ runtime, boots
it, and deletes only that owned device on completion/failure. Set `IOS_DEVICE_NAME`
to another installed device type, or explicitly set `IOS_SIMULATOR_UDID` to reuse
an existing device; supplied devices are never shut down or deleted. Do not run
multiple harnesses against the same simulator or DerivedData directory.

The bounded suite is:

- `ActivityFilterTests`: filtering, date/locale parsing and reset behavior.
- `ActivityStoreSelectionTests`: selection/reconciliation contracts.
- `SelectionFixtureTests`: shared selection fixtures.
- `MapPhotoTests`: photo availability, payloads and shared fixture parity.
- `PhotoGalleryTests`: gallery state and image request/cache behavior.
- `MapPhotoUITests`: three real XCUI map/photo interactions using the offline app fixture.

`xcodebuild build-for-testing` has an eighteen-minute cold-build budget, followed
by `xcodebuild test-without-building` with a separate twelve-minute runtime budget.
The first CI cold build took about eleven and a half minutes and exhausted the
former combined allowance as tests launched; separate phases preserve the test
allowance and identify which phase failed. Parallel execution is disabled, with
90/180-second default/maximum per-test allowances. Boot readiness has a
three-minute budget; the whole CI job has forty minutes, including setup and
artifact upload.
The wrapper records the toolchain, validates a positive passing test count, zero
failures/skips, and a positive number of passing cases in every selected suite.
`ACTIVITYMAP_API_BASE_URL`/Mapbox build settings use inert fixture values.
`MapPhotoUITests` launches the dedicated in-memory, offline app fixture; app-hosted
suites launch the ordinary app with the inert URL and supply isolated stores and
fixtures within their tests. `IOS_DERIVED_DATA` can reuse a
caller-owned build cache; otherwise `.quality/ios-derived` is retained for later runs.

Evidence in `output/quality/ios/<timestamp>/` includes separate
`xcodebuild-build.log` and `xcodebuild-test.log` files, toolchain, boot logs,
summary, per-test tree and `Results.xcresult`. Open the result bundle in
Xcode for attachments and failures. CI uploads browser and native evidence even
when a job fails. The separate `swift-client` job remains compile-only and is
labelled accordingly.

The suite deliberately excludes broad app-hosted SwiftUI accessibility traversal
checks: that host can yield an empty AX tree, so it cannot substitute for XCUI.
The retired rendered map/photo checks were replaced by `MapPhotoUITests` in #425.
The same host limitation was reproduced with unchanged action views in #427:
three `RenderedActivityActionTests` methods (eight parameter cases) failed at
their first AX lookup, while the controller/file suite passed 19 methods and
35 parameter executions. Those rendered checks remain excluded and are not
reported as passed by this harness.
Other rendered suites and device-only touch/VoiceOver acceptance remain outside
this smoke boundary; failures there are not silently treated as passing here.
Pending photo-pipeline/sync-integrity suites from #422/#423 and filter/GPX
regressions from #426/#427 can be added after those changes land; this base does
not contain them.

## Formatting policy

`prettier.config.js` is the only Prettier configuration. Import sorting uses the
actual `~/` alias and preserves side-effect import ordering; the Tailwind plugin
runs last. `eslint.config.mjs` is the active flat ESLint config. Scoped format
checks never rewrite files, and unsupported formats are ignored. To format an
intentional edit, run `pnpm exec prettier --write <explicit-files>`. Existing
repository formatting debt is not swept into a change; CI checks files changed
against the PR's actual base, not the entire repository.
