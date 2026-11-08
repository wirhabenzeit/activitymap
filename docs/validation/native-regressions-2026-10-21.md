# Native regression reconciliation — #227

Baseline: merged main `632af405e21688cfcfb60113a4e5107f94a53ade` (21 October 2026).
This record covers the reported Stats/calendar/inspection and three historical
map/detail regressions. It does not certify every native test or finish composed
cross-client lifecycle acceptance.

## Reproduction

The unchanged-main iPhone build reproduced 12 failing methods / 32 Swift Testing
issues across `RenderedStatsDashboardTests` and `StatsInspectionTests`. Another
four opt-in capture/latency methods were disabled by their existing conditions.
The unchanged calendar tests reproduced two failing methods / five issues on an
iPad. These failures came from attempting to traverse or activate SwiftUI's
accessibility tree inside an ordinary app-hosted test process.

The three older map/detail methods were selected with their full Swift Testing
identifiers, including parentheses and argument labels. The old landscape method
was renamed to `landscapePanelShowsLoadedProfileWithPinnedHeading` in `00ca5c5a`.
Results on the baseline build:

- `elevationStatesReserveStableLayout()` passed without a source change.
- The pinned landscape profile test captured an empty presenting view rather
  than the native results sheet introduced for iOS 27.
- `nativeTabRoundTripRestoresCameraAndListOffset(landscape:)` passed its portrait
  case and reached its final portrait-restoration timeout in the landscape case.

The first map and AX diagnostic runs stalled during Xcode log finalization and
were stopped after their tests finished. Their logs/partial bundles are diagnostic
evidence only. Subsequent runs disable optional system-diagnostic collection;
final acceptance requires a finalized result bundle and a nonempty test tree.

## Corrections and retained coverage

| Original hosted check                                                 | Current verification                                                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings/Filters presence, Back and restored Settings position        | Real production-shell UI journeys at standard, landscape and accessibility text sizes; hosted navigation/inset/scroll/controller assertions retained |
| Metric names, selected state, 44pt targets and activation             | Real UI automation of the production metric picker with the original three choices                                                                   |
| Filter-empty and history-empty focused charts                         | Real UI labels and absence of a calculation spinner, plus hosted completed-cache, transport-outcome and dashboard-state assertions                   |
| Zero/missing month values and exact year-month totals                 | Production rhythm views in offline UI fixtures; exact distance/time readouts and retained month selection checked through real AX                    |
| Compact Sport mix secondary totals                                    | Existing production-shell UI journey now requires the compact disclosure to be reachable                                                             |
| Inspection Back/Close, target size and activation                     | Real Records/activity UI journeys on phone and tablet; hosted panel geometry, navigation depth, scope/selection and resize assertions retained       |
| Compact calendar cell geometry and obsolete controls                  | Real AX snapshots in standard, dark and accessibility text; hosted width/viewport checks retained                                                    |
| Calendar taps, metric/selection/scroll retention and activity opening | Real calendar UI journeys; hosted native scroll offsets and inspection-state retention retained                                                      |
| Landscape profile content                                             | Rotate the scene, wait for the native sheet, capture its actual presented view, and retain the heading/axis assertions                               |
| Map/List/Stats round-trip teardown                                    | Restore the original key window before requesting portrait geometry; retain camera, padding, renderer identity, selection/fit and scroll checks      |

`StatsAccessibilityUITests.swift` extends the existing `StatsUITests` class, so
all migrated AX checks run in the full native profile automatically. Its UI
selection now contains 53 methods across the same six UI suites. The PR smoke
selectors are unchanged. Four preexisting opt-in capture/latency probes are now
separated into `StatsNavigationDiagnosticsTests`; none was converted into a skip
or quarantine to make the executable regression suites pass.

A focused chart with a completed cache and no filter matches reports
`noMatches`, independently of whether transport is offline or its last refresh
failed. The old hosted expectation confused that presentation state with the
transport outcome; the revised check verifies both independently.

## Repeatable affected-suite selection

Use the Xcode project/scheme and unsigned simulator configuration described in
[the iOS README](../../ios/ActivityMap/README.md). Select these whole suites:

- `ActivityMapTests/RenderedStatsDashboardTests`
- `ActivityMapTests/StatsInspectionTests`
- `ActivityMapTests/StatsCalendarRenderingTests`
- `ActivityMapTests/StatsDashboardTests`
- `ActivityMapTests/StatsScopeTests`
- `ActivityMapTests/StatsFixtureTests`
- `ActivityMapTests/StatsPresentationPolicyTests`
- `ActivityMapTests/StatsCalendarLayoutTests`
- `ActivityMapTests/StatsCalendarScrollRenderingTests`
- `ActivityMapUITests/StatsUITests`

Add these exact selectors for the historical checks:

```text
ActivityMapTests/RenderedRoutePickingTests/elevationStatesReserveStableLayout()
ActivityMapTests/RenderedRoutePickingTests/landscapePanelShowsLoadedProfileWithPinnedHeading()
ActivityMapTests/RenderedRoutePickingTests/nativeTabRoundTripRestoresCameraAndListOffset(landscape:)
```

Pass each selector as its own quoted `-only-testing:<selector>` argument. A bare
Swift Testing method name can select zero cases; a successful process exit alone
is insufficient. Inspect the finalized summary and test tree for every requested
suite/method, all parameterized cases, failures, skips and expected failures.
Use a fresh result path and `-parallel-testing-enabled NO`. All runs here use
Xcode 27.1 (27A9275), iOS 27.0 (24A434), an isolated iPhone 17 Pro and an isolated
iPad Pro 11-inch (M5).

## Remaining acceptance

The 36-suite full profile passed on merged main before this reconciliation, as
recorded in #409/#439. That result does not imply a full-repository native release
suite pass. This focused run does not certify opt-in diagnostics, live-service
writes, physical-device accessibility/performance or every other rendered suite.

#227 retains composed offline/reconnect/rebootstrap/deletion/account transitions,
late-result fencing across visible Map/List/Stats and media/cache state, linked
browser evidence from #198, and real-service edit/save/relaunch/web/Strava evidence.
Open feature dependencies #216/#221/#223–#226 remain separate. #222 is complete;
#207 is optional. Dedicated accessibility and measured device budgets remain with
#387 and #229/#230 respectively; ordinary device/UI acceptance stays accepted.
