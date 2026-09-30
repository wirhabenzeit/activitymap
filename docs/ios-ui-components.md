# Shared native UI components

Implementation handoff for [#253](https://github.com/wirhabenzeit/activitymap/issues/253), following the [accepted blueprint direction](ios-ui-blueprint.md). The owner requested closer web presentation with sensible native SwiftUI controls, and concrete visual refinement as screens land.

## Ownership and extension points

| Component                               | Responsibility                                                                                        | Caller retains                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `AppTheme`                              | Semantic fonts, spacing, adaptive surfaces/accent/separators, minimum targets and metric-column width | Destination composition and domain state                                         |
| `BrowseSectionHeading`, `BrowseBadge`   | Content hierarchy and compact labelled context                                                        | Heading/badge meaning and wording                                                |
| `BrowseSportSymbol`                     | Catalogue symbol, readable foreground hue, outlined selection and checkmark                           | Selected versus active state; accessible parent label                            |
| `BrowseIconLabel`, `BrowseIconButton`   | Shared compact glyph, 44pt minimum target, selected/disabled treatment                                | Menu/button action, enabled state, hint and side effects                         |
| `BrowseMetricValue`                     | Label/value/context hierarchy; compact, detail or headline emphasis; spoken unavailable values        | Existing formatting, units, nullable-versus-zero values and coverage             |
| `BrowseSurface`, `MapChromeSurface`     | Grouped content surfaces or native regular glass over maps                                            | Layout, camera occlusion geometry and action grouping                            |
| `BrowseStatusLine`                      | Wrapping short status with an optional single recovery action                                         | Recovery owner, precedence, cache validity and retry behaviour                   |
| `StatsTileSurface`                      | Title, period, controls and content hierarchy with optional expansion                                 | Tile identity, metric choices, expansion destination and calculated results      |
| `StatsMetricPicker`, `StatsRangePicker` | Bound selection; full accessible labels; native menu at accessibility sizes                           | Allowed options, range meaning, persistence and value updates                    |
| `StatsComparison`                       | Neutral emphasis plus visible/spoken increase, decrease or unchanged direction                        | Matched-period calculation and exact comparison context                          |
| `StatsChartSurface`                     | Scaled chart height and expandable readable data equivalent                                           | Configured native `Chart`, marks, axes, series, inspection and ordered data rows |
| `StatsChartPalette`, `StatsSportLegend` | Shared chart roles/catalogue fills and labelled sport symbols                                         | Series ordering, mixed-sport data and denominator                                |

These are small presentation views, not a UI framework or another analytics layer. Reuse them from screen owners; add shared styles here only when repetition warrants them. Native button/menu/picker and chart behaviour remains available.

Text uses semantic system fonts. Accessibility layouts stack metrics and tile controls, and use full-label metric/range menus. Decorative glyphs stay compact inside independently labelled targets. System text/surfaces adapt to appearance and increased contrast. Sport chart fills and routes retain the existing catalogue colours; small sport glyphs use darker light-mode and lighter dark-mode tones in the same hue families. Legends pair colour with symbols and readable text. Selection adds an outline/checkmark; active-on-map remains a distinct textual badge.

## Adoption and invariants

The live `ActivityRowView` uses shared sport/selection symbols, icon actions, active badges and metrics. Its adaptive grid admits three default metrics on a 375pt phone; narrower widths and accessibility text reflow. List density, sorting, chosen metrics, horizontal metric scrolling and lazy rendering retain their existing owners.

The shared `ActivityDetailContent` uses the same metric/heading/badge/surface hierarchy, with adaptive highlights and single-column accessibility metrics. The live Map layers, 3D and camera controls share icon labels and glass styling while retaining their 44 × 48pt geometry and existing placement. Selection, inspection and Show on map actions retain their independent meanings.

Stats components are exercised in a synthetic native review fixture. The production dashboard remains [#263](https://github.com/wirhabenzeit/activitymap/issues/263), after the [#262 engine](https://github.com/wirhabenzeit/activitymap/pull/269) and [#254 shell](https://github.com/wirhabenzeit/activitymap/issues/254). The component fixture is not a shipped dashboard. Chart callers must supply equivalent ordered values/units to both chart and data rows, distinguish unavailable future data from recorded zero, label partial periods and disclose incomplete history. This layer performs no filtering, fetching, formatting or calculations.

The shell is next (#254). Then List (#255), Map (#256) and shared Detail (#257) can adopt the same interfaces independently. Integrated status composition remains #258; Stats composition/history remain #263–#265.

## Native render evidence

Captured on 2026-09-30 using Xcode 27.0, iOS 27.0 Simulator, hosted on iPhone 18 Pro. The app-hosted capture harness sizes its windows to 375 × 812pt, 320 × 700pt and 820 × 1180pt. These are configured viewports, not physical-device screenshots. Fixtures are synthetic. Map uses a network-free blank style to review chrome; it does not demonstrate production map tiles.

Twenty renders cover List, the real shared Detail wrapper, live Map controls and the Stats component fixture: default phone light/dark, 320pt accessibility3 light/dark, and tablet light. Selected examples are retained below; the reproducible [capture recipe](ui-components/capture-native.swift.txt) generates the full set in `/private/tmp/activitymap-253-captures`. Copy it temporarily into the test target, run `RenderedRoutePickingTests/captureSharedUIReferences()`, then remove the temporary file. It is deliberately separate from functional assertions.

| Live surface / fixture  | Light                                                    | Dark / adaptation                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List                    | [Phone](ui-components/references/list-phone-light.png)   | [Dark](ui-components/references/list-phone-dark.png), [accessibility](ui-components/references/list-small-large-text.png)                                                        |
| Shared Detail           | [Phone](ui-components/references/detail-phone-light.png) | [Dark](ui-components/references/detail-phone-dark.png)                                                                                                                           |
| Live Map chrome         | [Phone](ui-components/references/map-phone-light.png)    | Full capture recipe includes dark/large text/tablet                                                                                                                              |
| Stats component fixture | [Phone](ui-components/references/stats-phone-light.png)  | [Dark](ui-components/references/stats-phone-dark.png), [accessibility](ui-components/references/stats-small-large-text.png), [tablet](ui-components/references/stats-tablet.png) |

Validation: the full existing native suite passes (177 tests across 24 suites), including rendered List/Detail updates, lazy results, route picking and camera/context retention. The capture recipe compiles and runs separately. Physical-device VoiceOver, focus-return and touch certification remain #228; full-screen composition and production chart inspection remain with their implementation issues.
