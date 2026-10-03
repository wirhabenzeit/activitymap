# Shared native UI components

## Navigation, identity and panel update — #254 / #272 / #279

- The single top destination control from #278 remains in use. `AppShell(statsContent:)` registers a real `BrowseStatsDestination` for #263; without it, no Stats button appears. `BrowseContent` retains all registered destinations and resets their identity on account/deployment scope changes.
- `FilterPanel(scope:)` reuses the same editors for browsing and Stats. Stats uses the engine’s non-date count, excludes browsing dates from active-filter feedback, and routes Reset through `resetStatsActivityFilters`. Its period explanation discloses saved browsing dates without applying them. Search/count/reset share a compact section. The shell supplies a Done button and a full-height presentation for landscape phones and accessibility text.
- `AccentColor` is the global system tint and explicit selection accent: #1976D2 on light surfaces, #90CAF9 on dark surfaces. The navigation background remains #1976D2. Shared sport badges have 26pt symbols within 34pt softly tinted shapes. Selected List rows add a leading mark and a checkmark; Map results retain a checkmark and separate active-route label. Inspection remains independent.
- The approved wide-screen behavior is a bottom-right, edge-attached panel with a draggable handle, two snap positions and no expand button. Portrait phones retain their system sheet. See Map results and detail below.
- The unused HeaderBar and FilterSidebar view wrapper are removed. The sidebar environment value remains the List detail-host input.

The original component and capture notes below are historical where explicitly marked. Continuous-drag captures and regressions describe the removed implementation; current evidence is recorded in `docs/ios-navigation-identity-review.md`.


Implementation handoff for [#253](https://github.com/wirhabenzeit/activitymap/issues/253), following the [accepted blueprint direction](ios-ui-blueprint.md). The owner requested closer web presentation with sensible native SwiftUI controls, and concrete visual refinement as screens land.

## Ownership and extension points

| Component                                    | Responsibility                                                                                        | Caller retains                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `AppTheme`                                   | Semantic fonts, spacing, adaptive surfaces/accent/separators, minimum targets and metric-column width | Destination composition and domain state                                         |
| `BrowseSectionHeading`, `BrowseBadge`        | Content hierarchy and compact labelled context                                                        | Heading/badge meaning and wording                                                |
| `BrowseSportSymbol`, `BrowseSelectionButton` | Readable sport symbol and a separate explicit checkbox with mixed/selected states                     | Sport, selected versus active state; accessible labels and selection action      |
| `BrowseIconLabel`, `BrowseIconButton`        | Shared compact glyph, 44pt minimum target, selected/disabled treatment                                | Menu/button action, enabled state, hint and side effects                         |
| `BrowseMetricValue`, `BrowseInlineMetric`    | Value/label/context hierarchy or compact inline units/symbols; spoken unavailable values              | Existing formatting, units, nullable-versus-zero values and coverage             |
| `BrowseSurface`, `MapChromeSurface`          | Grouped content surfaces or native regular glass over maps                                            | Layout, camera occlusion geometry and action grouping                            |
| `BrowseStatusLine`                           | Wrapping short status with an optional single recovery action                                         | Recovery owner, precedence, cache validity and retry behaviour                   |
| `StatsTileSurface`                           | Title, period, controls and content hierarchy with optional expansion                                 | Tile identity, metric choices, expansion destination and calculated results      |
| `StatsMetricPicker`, `StatsRangePicker`      | Bound selection; full accessible labels; native menu at accessibility sizes                           | Allowed options, range meaning, persistence and value updates                    |
| `StatsComparison`                            | Neutral emphasis plus visible/spoken increase, decrease or unchanged direction                        | Matched-period calculation and exact comparison context                          |
| `StatsChartSurface`                          | Scaled chart height and expandable readable data equivalent                                           | Configured native `Chart`, marks, axes, series, inspection and ordered data rows |
| `StatsChartPalette`, `StatsSportLegend`      | Shared chart roles/catalogue fills and labelled sport symbols                                         | Series ordering, mixed-sport data and denominator                                |

These are small presentation views, not a UI framework or another analytics layer. Reuse them from screen owners; add shared styles here only when repetition warrants them. Native button/menu/picker and chart behaviour remains available.

Text uses semantic system fonts. Accessibility layouts stack metrics and tile controls, and use full-label metric/range menus. Decorative glyphs stay compact inside independently labelled targets. System text/surfaces adapt to appearance and increased contrast. Sport chart fills and routes retain the existing catalogue colours; small sport glyphs use darker light-mode and lighter dark-mode tones in the same hue families. Legends pair colour with symbols and readable text. List selection uses explicit checkboxes, independent of sport; active-on-map uses a location symbol, stronger title weight and a spoken label.

## Adoption and invariants

This section describes `main` after #270 and #278. Later sections record the #278 drafts in more detail; where an older statement conflicts with them, the draft sections describe current code.

### List

The live `ActivityRowView` uses a selectable sport badge and an independent inspection target. Phones and wider lists retain aligned sortable table columns whenever configured metrics fit. Reduced row padding improves density. Fallback rows place name/local date above primary metric values; additional metrics and accessibility text stack with labels. Show on map is available by swiping right, long-press menu and VoiceOver action. Scrolling-metric mode omits row swipes to preserve horizontal scrolling. Selection/count actions and the View menu retain complete sort, metric, width and density settings. No saved preferences change. The previously removed summary UI stays removed. See `docs/ios-list-density-review.md` for matched #255 evidence.

The selection/Sort/Columns toolbar uses an opaque system background matching the table header (#278 replaced the earlier thin-material glass). Totals and the totals display picker are deferred, including for existing saved preferences. Filter and sort snapshots are keyed by data/filter/sort changes, and immutable date formatters are cached by locale/timezone/template. Inspection, selection and native navigation do not re-filter or re-sort the library.

Phone List pushes a native detail destination with Back and swipe-back. Its wrapping content header uses the actual activity name, without a duplicate generic title or Done toolbar; the accessible escape action pops the destination. The root list remains retained at its exact scroll offset. Native navigation has no neighbouring-activity pager; vertical neighbour browsing is deferred. Wide List behaviour is described under [Adaptive tablet List](#adaptive-tablet-list).

### Shared detail

The shared `ActivityDetailContent` follows the web card's compact grouping: headline numbers with labels and related context beneath, without separate padded cards for each measurement. Moving time carries elapsed time; elevation gain carries independently recorded min/max; weighted power carries average/max; distance carries recorded speed context. HR/energy and power without a recorded weighted value stay independently visible. Full recorded metadata is reachable through a native disclosure. Metric columns adapt to their actual content width (150pt minimum): phone and narrow iPad panels fit two columns, wider hosts can fit more, and accessibility text stacks. The bottom action stays reachable with a quieter treatment and is host-specific (see [Detail and framing follow-up](#detail-and-framing-follow-up)).

### Map results and detail

Map results navigate to the same detail panel and fixed actions in one continuous surface, rather than a second content-only host. Results Back preserves the mounted results scroll and selection/active route; the header drops the repeated selection heading while inspecting detail. Map detail uses a native `UIPageViewController` scroll pager: content moves during the drag, cancellation retains focus, and a completed turn commits the activity. Arrows use matching native forward/reverse paging and stay blue throughout the drag, with competing arrow actions ignored until it settles. Only the current and neighbouring pages stay cached, including circular two-activity navigation. Vertical detail scrolling remains independent. Hosted detail uses explicit semantic secondary-label colours for legibility over material, and clips its scrolling content above fixed actions. Map result rows show sport/date/time and compact distance, elapsed time and elevation; accessibility text stacks those metrics.

Two hosts present this content (`MapResultsContainer`):

- **Phone portrait — native sheet (draft, #278).** `NativeMapResultsSheet` presents `RoutePickerSheet` with system detents (collapsed summary, content-aware opening height, `.large`), a visible drag indicator, background interaction up through large, and interactive dismissal disabled. See [Native phone map sheet draft](#native-phone-map-sheet-draft). The custom handle is not mounted in this host.
- **Wide/landscape — bottom-right panel (#279).** Used when the map is ≥650pt wide or landscape. A 44pt drag handle collapses to a header or expands upward to the full available height. It supports tapping, VoiceOver adjustment and named actions; no separate expand button is shown. Both states extend to the physical bottom edge through the safe area, with square lower corners and inset content. Medium and expanded model detents both mean full height. Dragging follows the current resting height, clamps overshoot and uses predicted movement to snap. Results and detail pages remain mounted. Explicit camera fits reserve the trailing footprint, and changing height never emits a camera request. The owner chose the position and handle-only design after reviewing screenshots on 2026-10-03.

Map controls form a vertical stack at the top-right, 12pt below navigation and 16pt from the edge. Expanded results cover the controls; no control lane is reserved beside the panel. Phone native sheets retain system layering. See `docs/ios-map-controls-review.md` for #282 evidence. Map no longer renders a separate provider-credit badge: all source credits use the SDK info menu, alongside its feedback and privacy/telemetry controls. The native Mapbox wordmark stays at bottom-left and the sole info button at bottom-right, at their normal map positions behind results, including wide side panels. Source attribution remains on raster base/overlay sources and is read from vector source metadata. [Mapbox requires the visible wordmark](https://docs.mapbox.com/help/dive-deeper/attribution/), including on third-party maps; [Swisstopo accepts centrally accessible source references](https://www.swisstopo.admin.ch/en/faq-free-geodata). Fully replacing the native info menu requires Mapbox review.

### Status

Routine sync information no longer occupies a browsing bar: Account → Settings → Activity Data owns status, refresh/pause and a nested Sync Details destination with timestamps, errors, retry deadline and photo metadata explanation. First sync does not put a loading popup over Map. List keeps its contextual loading/recovery states; Map-specific filtering/no-route messages are content-sized.

Stats components retain their established styling.

This density revision follows concrete owner feedback on the first #270 render: the List rows/controls and Detail were too spacious. A rendered regression now requires at least six visible default rows on a 375pt phone, with each default fixture row at most 90pt high, while preserving selection. The review fixture includes nine activities so density is visible. Its List uses an inline native title; the overall navigation shell remains #254.

Stats components are exercised in a synthetic native review fixture. The production dashboard remains [#263](https://github.com/wirhabenzeit/activitymap/issues/263), after the [#262 engine](https://github.com/wirhabenzeit/activitymap/pull/269) and [#254 shell](https://github.com/wirhabenzeit/activitymap/issues/254). The component fixture is not a shipped dashboard. Chart callers must supply equivalent ordered values/units to both chart and data rows, distinguish unavailable future data from recorded zero, label partial periods and disclose incomplete history. This layer performs no filtering, fetching, formatting or calculations.

Issue #253 closed with #270. Shell (#254), List (#255), Map (#256) and shared Detail (#257) are in progress on these interfaces; #278 added drafts for each. Integrated status composition remains #258; Stats composition/history remain #263–#265 after the #262 engine (PR #269).

List navigation evidence: [phone detail](ui-components/references/list-detail-phone.png), [Back at the retained position](ui-components/references/list-back-phone.png) and [adjacent tablet detail](ui-components/references/list-detail-tablet.png). These are synthetic native hosts, with no modal sheet or activity pager in List.

Single-detail evidence: [single detail with an overlay grabber](ui-components/references/map-single-detail.png), using the live Map with a network-free synthetic fixture. Shell evidence: [matching Map/List switch shapes](ui-components/references/shell-phone-light.png).

List evidence: [translucent toolbar without totals](ui-components/references/list-glass-no-summary.png), rendered after native navigation with 4,575 synthetic activities.

Resize evidence (captured before #278, when phones still used the custom panel; it now applies to the wide/landscape side panel only): [partial live drag](ui-components/references/map-sheet-live-resize.png) and [mid-collapse frame](ui-components/references/map-sheet-settling.png), generated in a synthetic 375 × 812pt host. [Initial sync without a Map popup](ui-components/references/map-first-sync-clear.png) uses a gated offline sync fixture; [progress in Settings](ui-components/references/settings-first-sync-progress.png) uses the same fixture. Summary-to-detail evidence: [compact](ui-components/references/map-detail-reveal-0.png), [half expanded](ui-components/references/map-detail-reveal-50.png) and [full detail](ui-components/references/map-detail-reveal-100.png) retain one heading while the values/actions reveal with panel height. These are rendered regressions, not physical touch recordings.

Attribution evidence: [one info button without a provider badge](ui-components/references/map-attribution-raster.png) and [the native credits menu](ui-components/references/map-sources-raster.png), using synthetic raster/vector source metadata without remote tiles. The menu regression checks deduplicated Swisstopo credits, additional overlay credits and retained privacy/telemetry actions.

Paging evidence: [native scroll offset before focus commits](ui-components/references/map-native-page-drag.png), generated by moving the native scroll view 30pt in the regression. This is a synthetic partial-drag render, not a physical touch recording.

Map flow evidence: [shared detail in the results container](ui-components/references/map-flow-detail.png) and [Back to retained results](ui-components/references/map-flow-results-return.png). These are 375 × 500pt synthetic component hosts generated by the scroll/context regression, not screenshots of a production map.

## Native render evidence

Map row evidence: [light](ui-components/references/map-results-readable-light.png) and [dark](ui-components/references/map-results-readable-dark.png) actual-pixel regression captures. [Sync Settings](ui-components/references/sync-settings-phone.png) is a synthetic cached server-wait fixture; its retry deadline is intentionally disabled.

Captured on 2026-10-01 using Xcode 27.0, iOS 27.0 Simulator, hosted on iPhone 18 Pro. The app-hosted capture harness sizes its windows to 375 × 812pt, 320 × 700pt and 820 × 1180pt. These are configured viewports, not physical-device screenshots. Fixtures are synthetic. Map uses a network-free blank style to review chrome; it does not demonstrate production map tiles.

Twenty-five renders cover List, the real shared Detail wrapper, live Map controls, the full shell and the Stats component fixture: default phone light/dark, 320pt accessibility3 light/dark, and tablet light. Selected examples are retained below; the reproducible [capture recipe](ui-components/capture-native.swift.txt) generates the full set in `/private/tmp/activitymap-253-captures`. Copy it temporarily into the test target, run `RenderedRoutePickingTests/captureSharedUIReferences()`, then remove the temporary file. It is deliberately separate from functional assertions.

| Live surface / fixture  | Light                                                    | Dark / adaptation                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List                    | [Phone](ui-components/references/list-phone-light.png)   | [Dark](ui-components/references/list-phone-dark.png), [accessibility](ui-components/references/list-small-large-text.png)                                                        |
| Shared Detail           | [Phone](ui-components/references/detail-phone-light.png) | [Dark](ui-components/references/detail-phone-dark.png)                                                                                                                           |
| Live Map chrome         | [Phone](ui-components/references/map-phone-light.png)    | Full capture recipe includes dark/large text/tablet                                                                                                                              |
| Stats component fixture | [Phone](ui-components/references/stats-phone-light.png)  | [Dark](ui-components/references/stats-phone-dark.png), [accessibility](ui-components/references/stats-small-large-text.png), [tablet](ui-components/references/stats-tablet.png) |

Validation (#270 revision): all 192 native tests across 25 suites pass with the documented `-parallel-testing-enabled NO` command (rendered suites share the key window). The earlier capture test completed all 25 renders. Large-list coverage uses 4,575 activities to verify warm filter/sort snapshots across native push/animated pop, exact List-instance/offset retention, no restored totals row, and correct invalidation on filters, sorting, sync, deletion and account reset. Rendered attribution checks verify credits remain at their original map position across every detent. An actual-pixel text-recognition regression verifies readable Map sport/date/distance/elapsed-time/elevation captions in light and dark modes. The native-pager regression checks movement before focus commits, stable arrow appearance during drag, cancelled/completed turns and a bounded page cache; its additional focused run passes both 2- and 60-activity cases. A rendered List navigation regression covers phone, large-text and tablet layouts: actual native Back returns to the same UICollectionView and exact offset, with settings, selection, active route and camera requests unchanged; filter invalidation closes detail. Tablet detail opens adjacent without pushing. A second regression verifies an already-pushed detail survives wider/narrower window changes until native Back. Coverage also includes phone/tablet density, Map results → detail → Back scroll/context retention, anchored-control geometry, rendered List/Detail updates, long detail scrolling above fixed actions, lazy results, route picking and camera/context retention. A large-library regression uses 4,574 activities and 24,000-point GPS recordings to verify the native grab area accepts touches beyond the indicator, live resize retains hosted pages without root replacement, release/programmatic settling and cancellation preserve focus, and identity lookup invalidates after sync/deletion. New regressions verify visible viewport growth before drag release, a single detail heading during an intermediate collapse frame and at 0/15/50/100% reveal with its sheet-relative position stable within 3pt, height clamps/snapping/interruption geometry, retained selection/active route and no resize-triggered camera request. A first-sync render verifies the Map stays clear while Settings exposes progress/pause. The Settings Form grouping also passes cached-browsing checks on phone, accessibility and tablet hosts. Physical-device VoiceOver, focus-return and touch certification remain #228; full-screen composition and production chart inspection remain with their implementation issues.

## Detail and framing follow-up

The shared detail keeps distance, moving time, elevation and weighted power as primary values. Other recorded metrics use a compact secondary grid; missing and zero values retain their existing semantics. Profile and photo closures remain after metrics and before description/recorded details, ready for #217/#218 without placeholder content.

The fixed bottom action is “Show on map” from List and “Fit route” from Map. Map fitting collapses detail but reserves the medium panel footprint so reopening normal detail does not cover the fitted route. Arbitrary panel drags do not initiate camera fits. Fully expanded detail can cover the route; collapse or use Fit route to restore the map. Future working edit/refresh/share actions belong beside this action; inert menu entries are omitted.

Camera padding is retained across navigation and applied once (automatic SDK safe-area padding is disabled). Explicit route fits apply directly because the animated SDK transition can cancel during projection/panel updates; pitch, bearing and reset controls retain their animation. Gallery captures wait for the request and viewport to settle, and List-detail staging explicitly opens detail before capture.

## Adaptive tablet List

List uses the available window width until an activity is inspected. At regular widths of at least 760pt, standard text opens an adjacent 340–420pt detail pane while retaining at least 400pt for browsing. Closing detail restores the full list width. Narrower windows and accessibility text use the existing detail navigation; an already-pushed detail stays open through window changes. The native List instance, selection, sort and inspection owners remain unchanged.

Wide rows share aligned metric columns and a separate sortable local-date column where space permits. Additional configured metrics use columns when the activity name and all values fit; otherwise the existing adaptive grid or user-selected scrolling-metrics layout retains every configured field. Opening detail never changes the saved metric settings.

## Filter sidebar draft

Regular windows at least 760pt wide show a collapsible 320pt leading filter sidebar, shared by Map and List. Its visibility is saved independently of inspection. With insufficient remaining width for adjacent List detail, inspection uses a native modal sheet over the existing layout (it currently keeps an “Activity” title and Done button, unlike the pushed and adjacent hosts; open under #257); a wide landscape window retains all three columns. Compact windows and accessibility text use a native filter sheet.

Measurement editors use a compact title/range summary, dual-thumb slider and labeled scale, with a reset action for active ranges. There are no text fields or Apply button. Thumb drags maintain local drafts and commit on release, avoiding repeated library filtering during movement. VoiceOver adjusts each endpoint. Scales round up from unfiltered library extents with practical minimum ranges, and retain existing bounds. Outer endpoints leave that side unlimited. Existing precise bounds remain visible until adjusted. Active ranges exclude missing measurements. Accessibility text stacks the heading and reduces scale labels to three. Existing one-sided predicates remain supported.

Validation: 61 rendered navigation cases and 20 filter cases passed for this draft, plus three iPad gallery scenes. Captures include portrait detail overlay, landscape filters/list/detail, precise units and accessibility text. Touch feel and physical-device VoiceOver remain review work.

Sport filters appear directly after search, before dates and measurements. Five catalogue groups use the shared web symbols/colours, compact multi-select chips and explicit all/none/mixed states. All/None affects every sport type; Specific sport types exposes individual toggles and an explicit Only action. A mixed group tap selects its remaining members, matching web semantics. Accessibility text stacks the chips.

Web comparison: web places category rows above search and exposes individual types in per-group menus; double-click isolates a group. Native chips act immediately and offer Only via the disclosure or context menu. Web measurement filters remain single-sided inequalities. The native form still uses more vertical space than the web sidebar; further density refinement is separate from the sport controls. This iteration passed the 20 filter tests and two tablet gallery scenarios.

## List options and column fit

List options presentation is owned by the retained List, independently of table-header and stacked-toolbar branches. Changing visible metrics, restoring defaults or switching metrics layout keeps the same Columns sheet open. Fit Width still falls back to stacked rows when the selected columns cannot fit, as explained in the display settings. A rendered phone regression exercises these transitions while retaining the sheet.

Column fit uses the same width budget for default and optional metrics: compact windows reserve 104pt for activity identity plus the selection/actions/insets, while wide windows reserve 180pt for identity. Speed columns use compact unit headings and numeric values, so distance plus average speed fits on 375–402pt phones. Truly overfull selections, explicit scrolling metrics and accessibility text retain their alternative layouts.

## Navigation colour draft

The browsing shell uses the web brand blue (#1976d2) across the navigation/status-bar background, with white account, mode and filter controls. The mode picker uses a flat selected capsule instead of glass. Both table headings and the alternative list toolbar use opaque system backgrounds, retaining light/dark content surfaces and sport colours.

Filters occupy the leading navigation position, aligned with the iPad sidebar, and Account occupies the trailing position. The account menu displays the current user image as a 32pt circular avatar within a 44pt target; absent, loading and failed images fall back to the white person icon. The menu retains its Account and Settings accessibility label.

## Native phone map sheet draft

Portrait phone results use system presentation detents with background map interaction enabled. The collapsed summary, content-aware opening detent and large detent replace handle-only custom dragging. Opening height uses selected-route count with a half-height cap; detail starts around 300pt (larger for accessibility text). Manual compact/large choices survive content changes. Filters/account presentations temporarily suppress the map sheet, and changing tabs retains selection. Wide/landscape layouts use the bottom-right panel described above. Native gesture feel and map/paging interaction still require device review.

## Shell sheet handoff

Shell sheet handoff waits for native map-sheet dismissal before presenting Filters or Account. Map selection stays suspended through the entire shell-sheet dismissal and returns afterward. A full-shell rendered regression covers both handoffs and selection retention; the native entrance-animation regression remains passing.
