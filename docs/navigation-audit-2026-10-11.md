# Navigation behavior baseline

Current behavior for [#358](https://github.com/wirhabenzeit/activitymap/issues/358) and [#359](https://github.com/wirhabenzeit/activitymap/issues/359), captured on 11 October 2026. This is step one: describe containers, controls and state transitions before deciding the navigation contract. The questions below record the pre-approval state. The subsequent [accepted navigation contract](navigation-contract.md), including its [baseline-to-target control audit](navigation-contract.md#control-audit-baseline-to-accepted-implementation), governs implementation; this audit and its captures remain the historical baseline.

Baseline: [`734c23c4`](https://github.com/wirhabenzeit/activitymap/commit/734c23c4a7c427d61924a0725d4bb23cce1970bf), with no product-source changes for this audit. It includes web List [#361](https://github.com/wirhabenzeit/activitymap/pull/361), web Stats [#362](https://github.com/wirhabenzeit/activitymap/pull/362), native navigation/iPad filters [#350](https://github.com/wirhabenzeit/activitymap/pull/350), subsequent native Stats inspection [#368](https://github.com/wirhabenzeit/activitymap/pull/368), the iPad header adjustment [#371](https://github.com/wirhabenzeit/activitymap/pull/371), and explicit web map navigation/clearing [#372](https://github.com/wirhabenzeit/activitymap/pull/372). The October 8 reference and October 10 issue descriptions precede some of this behavior.

## Evidence and limits

**Observed** means a fresh browser interaction or simulator navigation check. **Rendered** means a fresh simulator screenshot. **Source** means implementation tracing without a corresponding fresh interaction. Static captures do not certify physical touch gestures, animation quality or VoiceOver use.

| Evidence | Current coverage | Record |
| --- | --- | --- |
| Web List observed | 1440×1000, 1024×768, 760×768 and 402×874; history, keyboard, stepping, pagination, resize, filters and retained settings | [8 captures and verification](navigation-audit-2026-10-11/web-list/verification.json) |
| Web Stats observed | Seven focus tiles at 1440×1000, 874×402 and 402×874; nested activity, direct links, history, Escape, focus return and retained choices; wide dark captures | [29 captures and verification](navigation-audit-2026-10-11/web-stats/verification.json) |
| Web map observed | Four selected → inspect one → panel resize → Escape to four → clear; Fit selection and filter-toggle/Escape at 1440×1000, 874×402 and 402×874 | [27 captures and state journal](navigation-audit-2026-10-11/web-map/observations.json) |
| Native rendered | List/detail, map results/detail, Stats overview/focus and filters at 402×874, 874×402, 820×1180 and 1180×820 | [28-capture gallery](navigation-audit-2026-10-11/native/index.html) |
| Native large text rendered | List detail, Stats focus, map results and filters at 375×667 with accessibility text | [4-capture gallery](navigation-audit-2026-10-11/native-large-text/index.html) |
| Native navigation observed | Stats/map: 11 cases, 17 parameter executions. List/map return and List resize: 4 cases, 9 executions. Both runs passed with zero failures | [Stats/map summary](navigation-audit-2026-10-11/native-summary.json), [List/return summary](navigation-audit-2026-10-11/native-list-summary.json) |

The captures use the committed 20-activity [gallery fixture](../ios/ActivityMap/ActivityMapTests/Gallery/gallery-activities.json), SHA-256 `4e111e55d17cc53769e5a38fb08c3d50e9d9109be8c208a60c7c4f0e26d0b396`. List traversal additionally uses 205 synthetic copies; native checks use their existing test data. [The evidence manifest](navigation-audit-2026-10-11/manifest.json) records all 96 captures, metadata and file hashes.

Chrome is version 155.0.8059.39. Web runs use fixture routes containing production components and shell controls, without an account or database. These paths differ from `/list` and `/stats/tiles`: tab highlighting and pathname-dependent filters are not certified by the screenshots. In particular, the Stats fixture sidebar can show a date picker; the production exclusion is established separately by source below. Web Stats fixes its reporting day to 22 September; native Stats uses the current date. Do not compare numerical Stats values across these captures.

Native runs use the iPhone 18 Pro simulator on iOS 27.0. Tablet/wide cases are hosted **regular-size-class layouts**, not physical iPad or independently running iPad simulator captures. Phone landscape rotates the simulator scene. Maps use offline backgrounds, with no live basemap, photos or stream profiles. Web terrain uses a local placeholder PNG at zero exaggeration. These captures do not establish geographic-service, terrain or loaded-elevation acceptance.

## Current containers and resizing

| Surface | Web | Compact native layouts | Regular native layouts |
| --- | --- | --- | --- |
| List activity | Adjacent panel at **760 px of content width after filters**, otherwise full-width detail. Panel width 420–520 px | Native push, including phone landscape. Back/identity/Map replace root navigation chrome | Adjacent panel when regular size class, content width ≥760 pt and text is not an accessibility size; otherwise push. Panel width 340–420 pt |
| Stats chart | Full-width focus within its content column; shell/filters remain outside | Native focus page | Native focus page within the content column, with stationary shell/filters |
| Activity from Stats | Shared activity presenter with the same 760 px threshold, beside the chart/dashboard when wide | Push above chart/dashboard | Adjacent panel at ≥760 pt with regular size class and ordinary text; otherwise push |
| Map results/detail | Same lower-right results footprint; detail replaces results inside it. Expand/Shrink changes height | Portrait uses a native results sheet with compact/opening/large detents; landscape can use the floating panel | Bottom-trailing panel when map width ≥650 pt **or width exceeds height**; otherwise native sheet |

Evidence: fresh captures and checks; source owners are [web List presenter](../src/components/list/list-detail-transition.tsx), [native List](../ios/ActivityMap/ActivityMap/List/ListScreen.swift), [web Stats inspector](../src/components/stats/tiles/activity-inspector.tsx), [native Stats inspector](../ios/ActivityMap/ActivityMap/Stats/StatsActivityInspection.swift), [web map](../src/components/map/interactive-map.tsx) and [native map sizing](../ios/ActivityMap/ActivityMap/Map/MapResultsLayout.swift).

The 760 threshold governs List/Stats **activity inspection**, not every map presentation. Chart focus occupies the available content column; an adjacent activity panel reduces the chart's remaining width.

Web activity presentation follows width both ways: narrowing changes panel to full-width detail; widening restores the panel with the same identity and no new history entry. Its original history entry still owns the return action. Native List/Stats keep a pushed activity pushed through widening until Back. A native panel that narrows becomes a push and stays pushed; accessibility text falls back to push. Fresh web and native resize checks cover these differences.

Chart focus stays focus through resize. Map detent/size changes retain selection and do not request a camera fit. Sources: [web threshold](../src/components/list/inspection.ts), [native threshold](../ios/ActivityMap/ActivityMap/App/BrowseContent.swift), [native map container](../ios/ActivityMap/ActivityMap/Map/MapResultsContainer.swift).

## Current controls and effects

Selection is the selected ID set; active is the highlighted map activity. List inspection is independent of both, and Stats owns a separate inspection. Map detail presentation is independent of the active route. State owners: [web selection](../src/store/selection.ts), [native store](../ios/ActivityMap/ActivityMap/Models/ActivityStore.swift), [native map presenter](../ios/ActivityMap/ActivityMap/Map/RoutePicker.swift).

| Surface and platform | Control and accessible name | Current effect | Evidence |
| --- | --- | --- | --- |
| List activity, web panel | ✕ plus **Close**; `Close activity detail` | Clears inspection; retains selection/active/camera; returns focus to latest inspected row | Observed |
| List activity, native panel | ✕; `Close activity details` | Dismisses List inspection, retaining selection/active | Rendered/source |
| List activity, web full-width | ← plus **Back to activities** | Returns to retained List, keeping selection/active | Observed |
| List activity, native push | Chevron; `Back to activities`; native pop and accessibility escape | Pops activity, clears List inspection and restores retained context | Observed navigation; physical gestures pending |
| Stats chart, web | ← plus **Back**; `Back to stats dashboard` | Returns to dashboard if no activity is open; its handler closes a pushed nested activity first | Observed/source |
| Stats chart, native | Chevron; `Back to Stats` | Clears nested inspection first if present, otherwise returns to dashboard | Observed/source |
| Stats activity, web panel | **Close**; `Close activity detail` | Closes activity and returns to its chart/dashboard, without changing map selection | Observed |
| Stats activity, web full-width | **Back to stats**; `Back to stats` | Returns to originating chart/dashboard; label does not name the focused chart | Observed/source |
| Stats activity, native | Panel: `Close activity details`. Push: `Back to <tile title>` or `Back to Stats` | Closes/pops activity only, retaining originating focus and choices | Observed |
| Map detail, web/native | Web **Back to N routes**; native `Back to selected activities` for multiple candidates only (wide compact header can show **Results**) | Restores results; retains all selected IDs, active route and camera | Observed/source |
| Map results **and detail**, web | Bare ✕; `Clear selection` and tooltip | Empties global selection/active, dismisses detail/results, resets expansion; camera stays | Observed/source |
| Map results, native | Selection actions → **Clear selection**, `xmark.circle`; the menu is defined with detail actions but rendered only in results | Clears global selection including hidden IDs; results reconcile closed; camera stays | Rendered/source; map-state checks |
| List selection menus, web/native | Web **Clear selection**; native **Clear Selection** | Clears global selection, including hidden IDs; independently opened List detail remains | Source |
| Activity outside map, web/native | Map glyph, text depending on width; `Show on map` | Adds/activates target, changes destination and requests fit; retains other selected IDs | Source |
| Map results/detail, web | Scan glyph; `Fit selected routes` / `Fit current route` | Camera-fit request for corresponding geometry; selection/active/presentation stay | Observed selection fit; current-route fit traced |
| Map results/detail, native | Menu **Fit selection**; detail **Frame route**; heading still says `Show on map` | Fit selection moves camera; Frame route/heading reuse Show on map for the already active selected activity | Source |
| Map results/detail, web | Diagonal outward/inward arrows; `Expand route panel` / `Shrink route panel` | Changes height only, preserving selection/active/camera/history | Observed |
| Map results/detail, native wide | Handle; `Results panel`, `Collapsed`/`Expanded`; `Expand results` / `Collapse results` actions | Changes detent only, retaining detail/results and camera | Rendered/source; map-state checks |
| Map canvas, web | Mapbox fullscreen control | Changes map fullscreen presentation independently of fitting and results resizing | Source |
| Filter host, web/native | Web `Toggle Sidebar`; native Filters label with active-count/state feedback | Opens/closes the filter host without resetting criteria; tight native List can switch between column and floating panel | Source/rendered |

Documentation correction on 11 October: the native Map menu's detail commands existed in source but its header exposed the menu only in results; Back also depended on multiple candidates. The rows above reflect the baseline source at `734c23c4`, not the subsequently changed header. The captured images and state journals are unchanged.

Control sources: [web map header](../src/components/map/interactive-map.tsx), [native map menu](../ios/ActivityMap/ActivityMap/Map/RoutePickerSheet.swift), [web List menu](../src/components/list/data-table-view-options.tsx), [native List menu](../ios/ActivityMap/ActivityMap/List/ListScreen.swift), [web chart header](../src/components/stats/tiles/index.tsx), [native chart header](../ios/ActivityMap/ActivityMap/Stats/StatsScreen.swift) and [native shell](../ios/ActivityMap/ActivityMap/App/AppShell.swift).

Show on map rejects unavailable/GPS-less targets. Web offers **Clear filters and show on map** for hidden targets and reconciles visibility before activation. Native records the hidden target and offers explicit filter-clearing recovery. Successful native pushed-detail handoff pops to the retained map; leaving Stats clears its focus/activity. These are source findings here: fixture detail previews do not perform production web map handoff. Sources: [web handoff](../src/lib/show-on-map.ts), [web action](../src/components/list/card.tsx), [native handoff](../ios/ActivityMap/ActivityMap/List/ActivityDetailView.swift).

“Collapse” is absent from production chart-focus return controls. It remains in native map accessibility actions and explicitly inline native Stats hosts. The web activity card retains optional `onCollapse`/`onClearSelection` slots, but a source search found no callers supplying them. The unused native `MapControlCluster` contains an old resize-looking placeholder with no production caller. Neither establishes that old Stats expansion remains shipped.

## Web history and nested dismissal

| Transition | Current history and URL behavior |
| --- | --- |
| First List panel open | Replaces current entry with `activity=<id>` |
| First List full-width open | Pushes an activity entry with a List return marker |
| List stepping/resize | Stepping replaces identity in current entry; resize changes no history/URL |
| List Close/Back | Browser Back when a return marker exists, even after widening; otherwise removes `activity` locally |
| First Stats focus | Pushes `tile=<slug>` with dashboard return marker |
| First Stats activity | Pushes one activity entry **at every width**, including a panel |
| Stats activity switching | Replaces activity entry; direct links do not acquire an invented return marker |
| Stats activity Close/Back | Pops marked activity entry; otherwise removes `activity` locally, keeping chart focus |
| Stats focus Back | Returns through dashboard marker; direct focus clears locally; nested pushed activity closes first |
| Map inspection, Back, fit, resize, clear | No history entries/detail URL changes during observed interactions; appearance URLs are a separate initial hydration path |

These rows are observed or source-traced. Sources: [List history](../src/hooks/use-list-inspection.ts), [Stats focus history](../src/hooks/use-stats-focus.ts), [Stats activity history](../src/components/stats/tiles/activity-inspector.tsx). List/Stats helpers preserve unrelated parameters/fragments. Browser Forward restores pushed inspection/focus at the current width. Reload/direct-link behavior is covered; reload does not automatically erase surviving browser history metadata.

Web List/map detail use the shared Escape handler. List ↑/↓ stepping follows filtered/sorted rows before pagination. Inputs, menus and Edit dialogs retain their own handling. Stats focus ignores Escape while nested activity is open: activity Escape returns to chart, then another Escape returns to dashboard. Photo viewers use `Close photo viewer` and independent dismissal on both platforms; web restores focus to the invoking photo. External map-feature cards have a separate `Close`. Photos/features are source findings, not new task captures: [web photos](../src/components/list/photo.tsx), [native photos](../ios/ActivityMap/ActivityMap/Photos/PhotoGalleryView.swift), [feature card](../src/components/map/feature-info-card.tsx).

The phone web filter overlay is a custom sidebar/backdrop, not the shared dialog. In the fresh 402×874 map run, opening it then pressing Escape leaves it expanded. Source provides no sidebar Escape handler or modal focus trap. Stats focus excludes dialog Escape events, but this overlay is not a dialog: filter-over-focus dismissal order needs an interaction check before claiming “innermost presentation” everywhere.

Other glyph contexts remain separate from navigation: native search's `Clear Search` ✕ clears text, numeric-filter clear controls clear that range, and calendar/period chevrons change a reporting period. Generic web dialog ✕ has the name `Close`; Edit dismissal returns to detail without committing an edit, which the fresh List runner covers. Photo chevrons mean Previous/Next photo. The web sharing dialog's ← is named `Back` and returns to its enclosing sharing surface. These source findings belong to the label reconciliation, not to the selection-clearing action. Sources: [native search](../ios/ActivityMap/ActivityMap/Sidebar/FilterPanel.swift), [numeric filters](../ios/ActivityMap/ActivityMap/Sidebar/NumericFilterRow.swift), [calendar](../ios/ActivityMap/ActivityMap/Stats/StatsCalendarDetail.swift), [generic dialog](../src/components/ui/dialog.tsx), [sharing Back](../src/components/share/manage-shares-dialog.tsx).

## Filters and retained context

| Concern | Web | Native | Evidence |
| --- | --- | --- | --- |
| Filter host | Sidebar or icon rail. At viewport **<480 px**, a 48 px rail remains and expansion overlays content at 18 rem; larger widths use an occupying sidebar | Regular width ≥760 pt and ordinary text use 52 pt rail or 320 pt column; compact/narrow/accessibility layouts use sheet | Source/rendered |
| Tight List layout | Sidebar width contributes to activity threshold | Opening inspection can collapse column to rail; reopening filters while detail is present floats it. Closing detail leaves rail collapsed; no pin control | Source/tablet capture |
| Filter dismissal | Toggle/mobile backdrop; Escape observation above | Sheet **Done** or system dismissal; floating panel backdrop/toggle/accessibility escape | Source/rendered |
| Stats dates/reset | Production `MonthPicker` returns null on `/stats/tiles`. Stats ignores saved browsing dates; its filter reset preserves them | Stats rail/panel omit dates; Stats reset preserves saved browsing range | Source |
| List inspection return | Mounted table retains sort, density, Fit/Pin/Scroll and scroll. Return restores latest inspected row's page/focus, even after paging elsewhere | Retained List restores settings/scroll through detail/Back and map tab round trip; pushed detail survives widening | Observed |
| Stats return | Mounted dashboard retains geometry/scroll, metric/calendar choices; hidden focus keeps grouping/scroll; nested inspection retains chart context | Retained dashboard/state keeps choices and tile inspection state; nested return preserves focus/metric/day/period; leaving Stats clears focus/activity | Observed/source |
| Map return | Back, resize and clear retain camera; Back retains active route | Back retains active route/camera and exact results scroll; detents retain presentation state | Observed/source |

Sources: [web sidebar](../src/components/ui/sidebar.tsx), [web mobile threshold](../src/hooks/use-mobile.tsx), [web filters](../src/components/layout/sidebar/filters.tsx), [native filter editor](../ios/ActivityMap/ActivityMap/Sidebar/FilterPanel.swift), [native rail](../ios/ActivityMap/ActivityMap/Sidebar/FilterRail.swift), [native shell](../ios/ActivityMap/ActivityMap/App/AppShell.swift), [web table](../src/components/list/data-table.tsx), [native Stats state](../ios/ActivityMap/ActivityMap/Stats/StatsDashboard.swift).

Web full-List pagination is local to its mounted table. Store sort/density/column settings survive route changes, but the full table is not a retained cross-route mount. Do not infer `/list` → `/map` → `/list` scroll/page retention from an inspection round trip. Native's fresh tab-round-trip check explicitly establishes retained List behavior on its host.

## Recorded task journeys

| Journey | Observed outcome | Remaining acceptance |
| --- | --- | --- |
| Web four → one → Escape to four → clear | All three widths: Lunch Ride activates without reducing four selections; Escape restores results and keeps active; clear empties selection/active. History unchanged; camera unchanged by inspection, resize, Back or clear | Predict-before-tapping check, Safari and physical phone |
| Web Fit selection | Desktop/phone camera changes without selection/active changes. At 874×402 with expanded filters, camera stays and state records “The map is not ready to frame this route. Try Fit routes once it has loaded.” | Investigate short-viewport feedback/usable area; offline observation does not establish cause |
| Web chart → activity → chart → dashboard | Stats runner passes return paths, nested Escape, history/Forward/direct links, responsive presentation and retained choices | Physical animation/accessibility |
| Native List → detail → Back; detail → widen → Back | Checks pass for phone, regular, split-window and accessibility layouts, retaining selection/List context | Physical phone/iPad, completed/cancelled edge swipe |
| Native map detail → results | Rendered check restores same results scroller/offset, selection, active route and independent List inspection | Four-route task through actual controls on phone/iPad |
| Native focus → activity → focus → dashboard | Production-stack checks pass for narrow/large-text and regular layouts, panel-to-push resize and retained Records/Month choices | Predict-before-tapping and VoiceOver on physical devices |

## Questions for the contract decision

1. **History:** List panels replace; Stats activity panels push. Decide whether every activity panel should be dismissible by browser Back or whether the difference is intentional.
2. **Resize:** Web restores panels on widening; native holds a push until Back. Decide which differences remain platform conventions.
3. **Clear selection scope:** #359 says “Map results only”; both platforms also expose it in map detail and List menus. Reconcile that wording with existing selection actions.
4. **Visible map controls:** Web's bare ✕ clears selection; accessible labels already distinguish Fit and resize. Decide visible wording/glyphs and keep fullscreen separate.
5. **Contextual Back labels:** Web nested activity says “Back to stats” when returning to chart. Both focus headers can name the dashboard while closing activity first. Decide the header/action rule.
6. **Fit wording:** Web Fit selected/current routes; native Fit selection, Frame route and an on-map Show on map heading. Decide vocabulary, including route-less selected activities.
7. **Innermost dismissal:** Specify filters, photo/Edit dialogs, activity and focus precedence; the phone web filter overlay does not close on Escape.
8. **Retention:** Separate inspection return, stepping, peer-destination round trips and reload; their current scroll/page/focus behavior differs.

## Historical reference

Keep [the October 8 reference](navigation-reference-2026-10-08/index.html) as dated evidence. Its iPad chart side inspector/✕, web inline chart Collapse and filter overlay/pin discussion predate merged focus/rail behavior. Question 06's claim that web Stats exposes browsing dates conflicts with production `MonthPicker`. The HTML and exported PDF page 24/question 06 were corrected during the subsequent contract documentation work; historical screenshots have not been relabelled as current. See [correction provenance](navigation-reference-2026-10-08/correction.json).

## Review captures

| State | Native phone | Native regular layout | Web phone | Web wide |
| --- | --- | --- | --- | --- |
| List detail | [Push](navigation-audit-2026-10-11/native/list-detail--phone.jpg) | [Adjacent panel](navigation-audit-2026-10-11/native/list-detail--tablet.jpg) | [Full-width](navigation-audit-2026-10-11/web-list/web-list-detail--402x874.png) | [Panel](navigation-audit-2026-10-11/web-list/web-list-detail--1440x1000.png) |
| Map results | [Sheet](navigation-audit-2026-10-11/native/map-results--phone.jpg) | [Floating panel](navigation-audit-2026-10-11/native/map-results--wide.jpg) | [Four selected](navigation-audit-2026-10-11/web-map/map-four-selected--402x874.png) | [Four selected](navigation-audit-2026-10-11/web-map/map-four-selected--1440x1000.png) |
| Map detail | [Detail](navigation-audit-2026-10-11/native/map-detail--phone.jpg) | [Detail](navigation-audit-2026-10-11/native/map-detail--wide.jpg) | [Back and three controls](navigation-audit-2026-10-11/web-map/map-inspect-one--402x874.png) | [Back and three controls](navigation-audit-2026-10-11/web-map/map-inspect-one--1440x1000.png) |
| Training volume focus | [Focus](navigation-audit-2026-10-11/native/stats-expanded--phone.jpg) | [Full-width focus](navigation-audit-2026-10-11/native/stats-expanded--wide.jpg) | [Focus](navigation-audit-2026-10-11/web-stats/training-volume--402x874.png) | [Focus](navigation-audit-2026-10-11/web-stats/training-volume--1440x1000.png) |
| Filters | [Sheet](navigation-audit-2026-10-11/native/filters--phone.jpg) | [Column](navigation-audit-2026-10-11/native/filters--wide.jpg) | [Overlay after Escape](navigation-audit-2026-10-11/web-map/map-filters-after-escape--402x874.png) | [Collapsed rail](navigation-audit-2026-10-11/web-map/map-filters-toggled--1440x1000.png) |

Accessibility text: [List push](navigation-audit-2026-10-11/native-large-text/list-detail--small-large-text.jpg), [Stats focus](navigation-audit-2026-10-11/native-large-text/stats-expanded--small-large-text.jpg), [map sheet](navigation-audit-2026-10-11/native-large-text/map-results--small-large-text.jpg), [filter sheet](navigation-audit-2026-10-11/native-large-text/filters--small-large-text.jpg).

## Reproduce

Use installed dependencies and a local development server. These fixture runners need no live account/database; the map observer intercepts map-service requests.

```sh
SKIP_ENV_VALIDATION=1 AUTH_SECRET=navigation-audit-local-only NEXT_PUBLIC_MAPBOX_TOKEN=pk.offline-test pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3018
```

In a second terminal:

```sh
node scripts/verify-list-inspection.mjs http://127.0.0.1:3018 /tmp/navigation-baseline/web-list
node scripts/verify-stats-focus.mjs http://127.0.0.1:3018 /tmp/navigation-baseline/web-stats
node scripts/capture-navigation-map.mjs http://127.0.0.1:3018 /tmp/navigation-baseline/web-map
bash scripts/ios-gallery.sh navigation-baseline --scene list,list-detail,map-results,map-detail,stats,stats-expanded,filters --variant phone,phone-landscape,tablet,wide
bash scripts/ios-gallery.sh navigation-baseline-large-text --reuse-build --scene list-detail,stats-expanded,filters,map-results --variant small-large-text
```

Web runners refuse to overwrite their temporary fixture routes and remove them on completion/failure. Exact native cases are saved in [Stats/map test names](navigation-audit-2026-10-11/native-tests.json) and [List/return test names](navigation-audit-2026-10-11/native-list-tests.json). List cases belong to `RenderedRoutePickingTests`, although their source is `RenderedActivityListTests.swift`.

Physical-device, Safari and predict-before-tapping acceptance remains open. This baseline does not accept a new contract or close either issue.
