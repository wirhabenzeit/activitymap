# Navigation contract

Accepted on 11 October 2026 for [#358](https://github.com/wirhabenzeit/activitymap/issues/358) and [#359](https://github.com/wirhabenzeit/activitymap/issues/359), following the [status-quo audit](navigation-audit-2026-10-11.md). This governs web and native navigation. The [Map/List contract](map-list-parity-contract.md) owns selection transitions; the [Stats contract](stats-parity-contract.md) owns calculations and reporting scope.

Acceptance records the product decision in this review. The implementing changes are local and have not yet been merged; physical-device acceptance remains open. This document does not claim that either GitHub issue is closed.

## Decisions reconciled with the issue proposals

| Original proposal | Accepted decision | Reason |
| --- | --- | --- |
| #358 distinguishes panel replacement from pushed inspection | The first List/Stats inspection pushes one entry at every width; stepping replaces it | Browser Back closes an inspection consistently, including after a resize. |
| #359 limits Clear selection to Map results | Offer the global action in Map results, Map detail and List selection menus | Selection is shared across destinations; the action has the same complete scope everywhere. Independently opened List/Stats inspection stays open. |
| #359 says to remove Collapse after chart focus ships | Chart focus returns with Back. Map may retain Expand/Shrink/Collapse results | Map sizing changes footprint, not navigation depth. Fit and fullscreen remain separate actions. |
| #358 requests a proposed document until the container work lands | Mark the contract accepted after the user's 11 October approval; track merge and device verification separately | The decision uses the merged container baseline and records the remaining delivery work explicitly. |

## Containers

List and Stats activity inspection uses an adjacent panel when available content width **after filters** is at least 760 px/pt. Native additionally requires regular size class and ordinary Dynamic Type; accessibility sizes use a native push. Charts open a scrolling, full-content-width focus page. Map results/detail share their own adaptive sheet/panel, with separate sizing controls.

Web follows width in both directions without changing identity/history. A native push remains pushed through rotation until Back; a panel that narrows becomes a push. The next inspection chooses its container from the current layout. Chart focus remains focus across resizing. Resizing never changes selection or requests a camera fit.

## Actions and labels

| Action | Meaning |
| --- | --- |
| Back | Return one level: activity → originating chart/List/results; chart → Stats dashboard. Name the immediate destination in the accessible label. |
| Close | Dismiss an adjacent activity panel or transient overlay. Retain selected IDs, active map activity and camera. An X can represent this action. |
| Clear selection | Clear the complete selection, including hidden IDs, and active map activity. Close Map results/detail; retain independently opened List/Stats inspection and camera. Available in Map results, Map detail and List selection menus. Use visible text or a labelled menu action, never a bare X. |
| Deselect activity / filtered / page | Remove only the named scope. Never label a scoped removal Clear selection. |
| Show on map | Outside Map, add and activate the target, switch to Map, and fit its route. Preserve other selected IDs. Require explicit filter-clearing recovery for hidden targets; disable/reject targets without geometry or access. |
| Fit route / Fit selection | Move only the camera for the named geometry. Keep destination, selection, active identity, inspection and panel size. Use these labels on Map. |
| Expand / Shrink (Collapse) results | Change only the results footprint/detent. Keep identity, selection, camera and history. Never use Collapse for returning from Stats focus. |

Map detail Back keeps the active route as well as the selected IDs. Photo Close, edit dismissal and filter dismissal affect only their own presentation. Filters retain their criteria when dismissed.

Fit uses the available map rectangle. If an expanded sheet leaves no usable map area, explain that the user must shrink results and try Fit again; retain its detent and camera. Show on map waits for destination resizing, and a short native phone's opening sheet reserves usable map space even with accessibility text.

## Control audit: baseline to accepted implementation

The baseline column describes the 11 October status quo at commit [`734c23c4`](https://github.com/wirhabenzeit/activitymap/commit/734c23c4a7c427d61924a0725d4bb23cce1970bf), rather than the older October 8 screenshots. The target column describes the accepted, locally implemented behavior. **Retained** means the baseline already met the contract; **changed** identifies implementation work. Evidence and coverage limits are in [implementation verification](navigation-contract-2026-10-11/README.md).

| Surface | Platform | Control | Baseline effect/name | Accepted target and implementation |
| --- | --- | --- | --- | --- |
| List activity panel | Web | X / Close | Dismissed inspection, kept selection/active/camera; first opening replaced the List entry | **Changed history; retained Close.** `Close activity detail` dismisses only inspection; opening now pushes one entry. |
| List activity panel | iOS | X | `Close activity details` dismissed inspection, kept selection/active | **Retained.** Close restores the List without changing map state. |
| List activity push | Web | Back / row stepping | Back returned to List; stepping replaced identity | **Retained.** `Back to activities` restores the latest inspected row/page/focus; stepping adds no entries. |
| List activity push | iOS | Chevron / edge swipe | `Back to activities` returned to retained List; a pushed detail stayed pushed when widening | **Retained.** Back returns one level; rotation does not change navigation depth. Physical swipe acceptance is pending. |
| Stats chart focus | Web | Back | Handler could close a nested activity while the label still named the dashboard; direct nested links were not handled consistently by this header | **Changed.** Close nested activity first and label `Back to <chart title>`; otherwise `Back to stats dashboard`. Direct links clear the innermost URL identity locally. |
| Stats chart focus | iOS | Chevron | Closed nested inspection first, but the header could still say `Back to Stats` | **Changed label.** `Back to <chart title>` with nested inspection; otherwise `Back to Stats dashboard`. |
| Stats activity panel | Web / iOS | X / Close | Closed activity only, retaining chart/dashboard and map selection | **Retained.** Close dismisses the activity panel; chart focus remains. |
| Stats activity push | Web | Back | Generic `Back to stats` returned to the originating chart/dashboard | **Changed label.** Name the immediate chart, or `Back to stats dashboard`. |
| Stats activity push | iOS | Chevron | Named the chart when nested; dashboard-origin inspection used `Back to Stats` | **Changed dashboard label; retained return.** Name the chart or `Back to Stats dashboard`. |
| Map activity detail | Web | Back to N routes / Escape | Restored results, keeping selection, active route and camera | **Retained.** Back is one level and retains the active route. |
| Map activity detail | iOS | Results / chevron | Back was shown for multiple candidates; a single selected activity lacked that header action | **Changed.** `Back to selected activities` is available for one or many results; accessibility escape returns to results. The compact summary must be expanded to expose detail controls. |
| Map results and detail | Web | X | Bare X cleared global selection/active and closed results/detail | **Changed presentation.** `Selection actions` menu contains visible `Clear selection`; complete scope and camera retention remain. |
| Map results and detail | iOS | Selection actions | Clear was defined in the menu, but the menu rendered in results only | **Changed availability.** The labelled menu is available in results and detail, clearing all selected IDs, including hidden IDs, and active identity. Expand the compact summary to access the menu. |
| List selection menu | Web / iOS | Clear selection | Cleared the global set, including hidden IDs; independent List inspection remained | **Retained scope; reconciled capitalization.** Visible `Clear selection` keeps camera and independent inspection. |
| List/Stats activity | Web / iOS | Map glyph / Show on map | Added/activated the target, changed destination and requested a fit; required explicit hidden-filter recovery | **Retained.** `Show on map` is a destination action; no-GPS/unavailable targets are disabled or rejected. |
| Map detail | Web | Scan glyph | `Fit current route` moved the camera without changing inspection/selection | **Changed label.** `Fit route` moves only the camera. |
| Map detail | iOS | Heading map glyph / Frame route | Reused Show on map, potentially changing active identity, presentation and detent | **Changed command and label.** `Fit route` is camera-only and retains inspection, identity, selection and detent. |
| Map results | Web | Scan glyph | `Fit selected routes` requested a fit; short landscape could leave no usable map area and misleading loading feedback | **Changed label/layout/feedback.** `Fit selection` moves only the camera; a short landscape panel leaves usable space, or the message asks the user to shrink results/collapse filters. |
| Map results | iOS | Fit selection | Fitted selected geometry, reset the results detent to medium; compact fitting reserved an opening-sheet footprint | **Changed.** Fit uses the current footprint and retains detent. An occluding expanded sheet produces guidance rather than an automatic shrink. |
| Map results/detail | Web | Outward/inward arrows | `Expand route panel` / `Shrink route panel` changed height only | **Retained.** Resize keeps selection, active identity, camera and history; the labelled Scan control fits geometry separately. |
| Map results/detail | iOS | Handle / detents | `Expand results` / `Collapse results` changed results footprint only | **Retained.** Sizing remains independent of Back and Fit; the opening sheet reserves usable map space on short accessibility layouts. |
| Map canvas | Web | Fullscreen | Changed fullscreen presentation independently of Fit/results sizing | **Retained.** Fullscreen describes the map viewport, not route fitting or results expansion. |
| Filters | Web | Sidebar trigger / X / Escape | `Toggle Sidebar` changed presentation; the narrow overlay lacked its own Escape handling/focus trap | **Changed.** Trigger is `Filters`; `Close filters` or Escape dismisses the narrow overlay first, restores trigger focus and keeps criteria. Docked filters stay open on Escape. |
| Filters | iOS | Filters / Done / dismissal | Dismissed sheet/floating editor without resetting criteria; regular layouts kept rail/column | **Retained.** Dismiss the filter host, not the underlying inspection. No pin mode is introduced. |
| List and Stats return | Web | Back / peer destination | Mounted inspection retained context, but destination remount lost List page/scroll and some Stats choices/scroll | **Changed.** Session state retains List page/scroll and Stats options/grouping/period/day/focus/dashboard scroll; unavailable pages/positions clamp. Account/scope changes reset this state. |
| List and Stats return | iOS | Back / peer destination | Retained List/dashboard state; leaving Stats cleared focus/inspection | **Retained.** Underlying choices/scroll remain even when leaving a destination dismisses its inspection/focus. |

Other glyphs have explicitly scoped meanings; they do not clear route selection:

| Surface | Platform | Control | Baseline effect | Accepted target |
| --- | --- | --- | --- | --- |
| Photo viewer | Web / iOS | X / previous / next | Dismissed the viewer or changed the displayed photo | **Retained.** Close photo viewer and Previous/Next photo act within the viewer. |
| Edit and other dialogs | Web / iOS | X / Close / cancel | Dismissed the dialog without committing an edit | **Retained.** Dismiss the innermost dialog, returning to its activity/surface. |
| External map feature card | Web | X / Close | Dismissed that feature card | **Retained.** Close the card, keeping activity selection. |
| Sharing surface | Web | Back | Returned to the enclosing sharing surface | **Retained.** Back returns one sharing level; it does not change activity inspection. |
| Search and numeric filters | iOS | X / clear | Cleared search text or the named numeric range | **Retained.** Clear the named filter only, not route selection. |
| Calendar/period and activity stepping | Web / iOS | Previous/next arrows | Changed period, day or inspected identity | **Retained.** Name the scoped Previous/Next action; do not interpret it as Back. |

Source tracing for the main controls: [web List presenter](../src/components/list/activity-list.tsx), [web Stats presenter](../src/components/stats/tiles/activity-inspector.tsx), [web Stats focus header](../src/components/stats/tiles/index.tsx), [web Map header](../src/components/map/interactive-map.tsx), [web Filters](../src/components/ui/sidebar.tsx), [native activity presenter](../ios/ActivityMap/ActivityMap/List/ActivityDetailView.swift), [native Stats header](../ios/ActivityMap/ActivityMap/Stats/StatsScreen.swift), [native shell](../ios/ActivityMap/ActivityMap/App/AppShell.swift), [native Map header/menu](../ios/ActivityMap/ActivityMap/Map/RoutePickerSheet.swift) and [native camera commands](../ios/ActivityMap/ActivityMap/Map/MapScreen.swift). The baseline audit links the auxiliary photo/dialog/filter sources. Unused inline Collapse/card slots and the unused native map-control placeholder are not shipped focus/navigation controls.

## URL and history

Opening the first List or Stats activity pushes **one** browser history entry at every width. Stepping or selecting another activity replaces that entry. Opening chart focus pushes its own entry. Close/Back pop an entry with an in-app origin; a direct/reloaded link without that origin removes activity/focus parameters locally instead of leaving the app. Browser Back retains normal browser semantics; Forward restores the URL identity. Preserve unrelated query parameters/fragments. Resizing and Map inspection/fit/clear do not add history entries.

A Stats activity returns to its focused chart, or the dashboard when opened there. Even the chart header's Back must dismiss a nested activity first and name that immediate destination. A direct nested activity link closes the activity before closing its focus page.

## Dismissal and filters

Escape/accessibility escape dismisses the innermost eligible layer: dialog/menu/photo/filter overlay, then activity inspection, then chart focus. Each handler consumes its own event. A docked filter sidebar stays open; it is part of the workspace. Web's narrow filter overlay restores focus to its trigger. Native narrow/accessibility Filters uses a dismissible sheet; regular iPad keeps the shipped rail/expandable column and floating tight-List editor, without pinning. Criteria survive container changes.

Stats excludes saved browsing dates from calculations and hides the date picker. Resetting Stats activity filters preserves the saved browsing date range. The October 8 reference's [HTML](navigation-reference-2026-10-08/index.html) and [PDF page 24/question 06](navigation-reference-2026-10-08/activitymap-navigation-reference-2026-10-08.pdf#page=24) are corrected: both web and native hide Stats date controls, and the filter image was captured from List. The October 8 screenshots remain dated evidence, not the current specification.

## Retained context

Inspection and switching Map/List/Stats preserve List scroll/page/sort/density/columns/width mode, Stats metric/grouping/period/day choices and scroll, and Map camera/selection. Return from List stepping reveals/focuses the latest inspected row, including its page. When filtering/data changes remove a saved row/page, clamp to an available page/position. Peer destination changes may dismiss inspection/focus; they retain the underlying browsing context.

Reload restores URL identity. Exact scroll and choices across reload or a new app launch are a separate persistence promise; this contract requires retention during the current browsing session. Account/scope changes reset browsing context.

## Acceptance

The web/iOS implementation and automated results are recorded in [implementation verification](navigation-contract-2026-10-11/README.md), with source hashes, transition observations and selected screenshots. Physical-device acceptance remains outstanding.

Exercise four selected routes → inspect one → Back → clear at phone, landscape and regular widths; verify active identity and camera after every transition. Exercise Training volume → change metric/grouping/scroll → activity → Back → dashboard → another destination → Stats; verify retained choices/position. Verify List page/scroll/settings through inspection, stepping, resize and a Map round trip. Check browser Back/Forward, direct nested links, transient-first Escape, no-GPS/hidden targets and accessibility labels. Simulator/browser checks supplement physical iPhone/iPad gesture, animation and VoiceOver acceptance; they do not replace it.

### Human task checks (pending)

Before each tap, predict what the control will change. Record device/browser, OS, viewport/orientation, text size, Reduce Motion and VoiceOver settings with the result; a screenshot alone does not complete this check.

| Journey | Expected result |
| --- | --- |
| On phone and wide screen, select four routes, inspect one, then Back | Four remain selected; the inspected route remains active; Back restores results without moving the camera. |
| While inspecting that route, use Fit route, then expand/shrink results | Fit changes the camera only; resizing changes the footprint only. An occluded fit gives guidance and keeps the detent/camera. |
| Clear selection from results, repeat from detail and the List menu, including a hidden selected ID | Clear removes the entire set and active map identity; camera stays. Independently opened List/Stats inspection stays open. |
| Training volume: choose metric/grouping, scroll, open an activity, Back, dashboard, another destination, Stats | Each Back returns one level and names that destination; choices and underlying focus/dashboard positions survive the session round trip. |
| Native detail: complete and cancel an edge swipe; repeat with accessibility text and VoiceOver | Completed dismissal returns one level with context retained; cancellation keeps the same activity. VoiceOver announces the actual Back/Close/Clear/Fit action and immediate destination. |
| Web: browser Back/Forward, direct nested link, filter/dialog Escape, then activity Escape | History restores identity; direct links close locally; each Escape dismisses the innermost eligible presentation and restores focus. Include Safari in the hands-on run. |

## Implementation references and delivery status

The merged foundations are web List [#361](https://github.com/wirhabenzeit/activitymap/pull/361), web Stats focus [#362](https://github.com/wirhabenzeit/activitymap/pull/362), native navigation [#350](https://github.com/wirhabenzeit/activitymap/pull/350) with iPad filters [#365](https://github.com/wirhabenzeit/activitymap/pull/365), native Stats inspection [#368](https://github.com/wirhabenzeit/activitymap/pull/368), native header adjustment [#371](https://github.com/wirhabenzeit/activitymap/pull/371), and web selection/Show on map [#372](https://github.com/wirhabenzeit/activitymap/pull/372). The [verification manifest](navigation-contract-2026-10-11/manifest.json) identifies source hashes for the additional implementation in this working tree. Its implementing PR link must be added when that PR exists; the foundation PRs do not claim to include these new changes.

| Issue requirement | Local status | Remaining before issue closure |
| --- | --- | --- |
| #358 contract, parity/README links and accepted decision | Documented, accepted by the user on 11 October | Commit and merge the contract with the implementing PR link. |
| #358 reference page 24 correction | HTML and exported PDF corrected; dated captures retained | Merge the corrected reference. |
| #359 surface/platform/control/current-effect/target audit | Included above, with the agreed action table | Include this document in the implementing PR. |
| #359 web/iOS mismatches and labels | Implemented locally; browser/simulator checks passed | Review, CI and merge. |
| #359 phone/wide task check | Automated transitions passed; predict-before-tapping check is pending | Complete the human task journeys, physical gestures and VoiceOver checks. |

Keep both issues open until delivery and the remaining acceptance checks are recorded. Cross-launch scroll/preferences, live-map styling and unrelated Stats/filter parity work are outside this contract's implementation claim.
