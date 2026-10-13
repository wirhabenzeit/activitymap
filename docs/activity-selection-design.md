# Activity selection design and implementation plan

Interface and core interaction approved on **13 October 2026** for [issue 384](https://github.com/wirhabenzeit/activitymap/issues/384), after reviewing the interactive web prototype. Production web and iOS code now implements the model in this checkout. These local changes have not been released; the development fixture route remains available for review.

Keep one selected activity group across Map and List. Ordinary map picks replace that group, including all overlapping routes found by one tap. Opening details preserves it. Deliberately collecting a group uses **Combine**, a visible mode shared by both destinations. **Only selected activities** belongs in Filters because it changes what is visible, rather than how input behaves.

The accepted arrangement is the Combine icon **before the selected count** in the Map results header and List footer, with Clear to the right. Sport icons show selection checkmarks **only while Combine is on**. This replaces the earlier proposals for a global bar, a separate Show only row, and permanent List selection circles.

The [Map/List contract](map-list-parity-contract.md#approved-selection-update-for-issue-384) and [navigation contract](navigation-contract.md#approved-selection-update-for-issue-384) record this update separately from their historical implementation baseline. This document is the delivery reference for the selection update.

## Use cases and limits

| User goal | What the group provides |
| --- | --- |
| Find activities passing through a location | A map tap finds overlapping routes; switching to List marks those same activities without a transfer action. |
| Explore a manageable subset | Only selected activities restricts Map and List to the group, intersected with ordinary filters. |
| View particular outings together | Combine collects trips, repeated visits or routes found through separate taps and searches. Fit selection frames their geographic extent. |
| Calculate totals for particular outings | Selected summaries operate on the whole group, with disclosure for members hidden by ordinary filters. |
| Share particular outings | The existing sharing flow can use the group. A separate sharing picker/draft redesign is a follow-up, not a dependency of this delivery. |

Several routes found by one tap are ordinary exploration. Combining several independent choices is the advanced workflow. The group is not a temporary map hit buffer and is not automatically cleared by opening an activity or switching destinations.

## Agreed interface

| Surface | Arrangement |
| --- | --- |
| Map results | **Combine icon → N selected → Fit selection → existing size control → Clear**. Keep the group controls outside the results/detail transition. |
| List | **Combine icon → N selected**, then Clear and existing display/paging controls in the footer. The footer remains reachable during List inspection. |
| Filters | A native switch/checkbox labelled **Only selected activities**, shared by Map and List. Disable it at zero selection. Include it in browsing filter counts and Reset. |
| Active scope | A funnel indicator beside the selected count, and active feedback on the Filters control. The restriction must remain apparent with Filters closed. |
| Combine on | Highlight the icon, expose its On/Off state accessibly, and show **Combine on** beside/below the count. Tapping it again ends the mode without discarding the group. |
| Activity rows | Keep the existing sport-icon footprint. Outside Combine it identifies the sport; inside Combine it toggles membership and overlays a small checkmark on selected icons. Keep selected names/backgrounds identifiable in both modes. |
| Zero selection | Map shows no selection controls until a route pick creates a group; List keeps its existing footer. Hide or disable unavailable Clear/Fit actions. |

Combine is a direct toggle, not a menu of input modes. Clear is directly available and includes hidden members. Camera fitting remains independent of selection, restriction, Back and sheet sizing. One persistent header button uses **Fit selection** in Results and **Fit route** in detail; this work does not introduce another framing vocabulary.

Sport icons do not secretly select during ordinary browsing. There is no separate exclusive-selection button in List: row taps inspect, and Show on map explicitly selects a target. The earlier exclusive List-control alternative is no longer the implementation target.

## Interaction rules

| Action | Default | Combine on |
| --- | --- | --- |
| Tap one map route | Replace group with that activity; activate/open it. | Add it; repeated hits do not toggle it off or activate a new activity through passive addition. |
| Tap overlapping routes / confirm area selection | Replace with the deduplicated hit set; show results for multiple hits. | Union the hit set with the existing group; retain valid focus. |
| Tap empty map | Clear group and map focus; disable Only selected; retain camera. | Preserve group, focus, detail and mode. |
| Tap a sport icon in List/results | No selection action. | Add/remove that activity. |
| Tap a row name / open details | Inspect the activity; preserve group. | Same. |
| Show on map | Validate, replace group with target, activate, switch to Map and frame its route. | Validate, add target, activate, switch to Map and frame its route. |
| Back / close detail | Return to the originating results/List; preserve group, focus and camera. | Same. |
| Clear | Empty the entire group, including hidden IDs; clear map focus and Only selected. | Same, while keeping Combine on. |
| Switch Map/List | Preserve group, mode, scope and retained browsing context. | Same. |
| Fit / expand / collapse | Change only the named camera or presentation property. | Same. |

Low-level add/remove transitions retain the existing focus invariants: passive addition does not activate; an actual removal may activate a sole remaining eligible selected member; filter changes never choose a new focus. A multi-hit replacement presents results rather than choosing an arbitrary detail. Cancelled area selection and failed/loading-style hit queries do not clear selection.

Show on map validates existence and GPS geometry before changing any state. Ordinary-filter exclusion still requires the existing explicit Clear filters and show on map action. The selected-only restriction is a browsing projection, not a reason to reject a valid Show on map target: update membership before resolving that projection.

Bulk select/deselect actions are available only inside Combine. Name the affected scope explicitly: all activities passing ordinary filters, or the current web page. Retain selections outside that scope. Disable additions outside the displayed group while Only selected is on; users turn that filter off first. Do not count instantiated SwiftUI rows as the complete filtered set.

## Viewing only the group

Use three distinct sets:

- **Eligible activities:** loaded activities passing ordinary sport/date/search/value/binary filters.
- **Selected activities:** the complete group, including eligible, filter-hidden and GPS-less members.
- **Displayed browsing activities:** eligible activities, intersected with selected IDs only when Only selected is on.

Map activity layers, picking, full List, browsing counts and filtered/page summaries use the displayed set. Selection reconciliation uses ordinary eligibility and known library membership, never the selected-only projection. Web map photos follow the same displayed activity IDs. Do not hide basemaps or unrelated external overlays.

Turning Only selected off restores the ordinary filters; it does not clear the group, end Combine or move the camera. Changing ordinary filters retains selected IDs and discloses exclusions, for example **3 of 5 selected · 2 hidden by filters**. An empty displayed set retains the group and offers filter recovery. Selected totals still include all known selected members, including hidden members.

Clear, deletion/removal of the last selected member, logout and account/deployment changes disable Only selected. Normalize that state before deciding whether to dismiss independent List inspection; clearing a group must not accidentally close an otherwise eligible List detail. Reset browsing filters removes both ordinary restrictions and Only selected, retaining the group and Combine state.

Stats retains its independent reporting scope. It neither consumes the selected-only projection nor exposes that filter. Resetting Stats activity filters does not reset the saved browsing date range or Only selected.

With Only selected on, a default map pick still replaces the group and can narrow it. This matches the prototype: inspection through results/List preserves the group, while an explicit map pick selects. Beta verification should include this distinction. While combining a restricted group, removals are possible; adding activities outside it requires turning the filter off. Do not introduce a second frozen group or silently disable the filter.

## State lifetime and accessibility

Proposed implementation defaults: Combine and Only selected are session interaction state, initially off, and not saved as account preferences. Map/List switches, details, Filters and display options preserve them. Turning Combine off preserves membership and scope. Closing an editor or a sheet must not silently reset the mode. Account/deployment/logout and a fresh app session clear these flags along with account-specific selection.

Combine ends when switching to Stats, retaining the group and browsing scope. Map/List switches, details and transient Filters/Settings sheets preserve it. This lifetime is implemented on both platforms and covered by native store tests; device acceptance remains open.

Use at least 44-point native hit targets even when the visible sport glyph is small. Outside Combine, VoiceOver encounters a sport indicator and a Details action, not a hidden selection button. In Combine, announce **Select/Deselect [activity]** and Selected/Not selected; the mode button announces **Combine selections, On/Off**. Preserve the separate native Back action, edge swipe, Reduce Motion, Dynamic Type and keyboard/focus behavior. Keep text/shape feedback as well as colour.

## iOS interface

Reuse the existing native browsing shell, List and Map results surface. This is not a new tab or a Pro preference.

**Map on iPhone:** the existing draggable results sheet gets a persistent group row with an SF Symbols `checklist` button before **N selected**, then one contextual Fit button and Clear. Fit frames the selection in Results and the inspected route in detail (including while collapsed); the detail heading has no duplicate Fit button. The grabber/detents continue to resize it; no redundant web expand button is needed. When inspecting a route, keep that group row and put Results/stepping in a separate navigation row where necessary. Collapsed shows only the group controls, with no route name or detail content. Results and detail share one middle height; opening/back, paging and membership changes never resize it. Its hidden results viewport stays stable so collapse/detail transitions preserve the exact list position. Closing/collapsing the sheet must not hide the active mode. At zero selection, show no selection controls or sheet. The next route pick creates a group and reveals Combine in its header.

**List on iPhone:** reuse the existing bottom status bar, with checklist → count/status on the left, Clear and display options on the right. No new checkbox column or upper selection toolbar. The native sport/checkmark overlay already exists in `BrowseSportSymbol`; gate the badge and sport-button interaction on Combine. Retain selected row tint/leading marker outside the mode. Host the footer outside the owning navigation stack (including the outer Stats navigation stack) so pushing an activity does not remove the mode or its exit.

**Filters:** add Only selected activities near the result count/search in the browsing Form. Count it in browsing active filters and Reset. Add the matching part/popover to the iPad filter rail; exclude it from Stats. Closing Filters preserves its value.

**Landscape and iPad:** preserve the existing landscape adaptation that carries List status in the compact shell bar when a bottom bar would consume too much height; checklist still precedes count. A pushed detail must retain a compact mode/exit, without replacing Back. iPad keeps the Map side-panel header and List footer within the browsing pane. Existing retained List scroll, adjacent detail, filter rail/column and Map camera remain owned by their current presenters. Accessibility text may wrap controls into two rows instead of shrinking their hit targets.

| Native presentation | Selection controls |
| --- | --- |
| Phone List root / portrait detail | Persistent footer: checklist, count/status, Clear, display options where applicable. |
| Phone Map results / route detail | Persistent sheet group header; independent Results/Back and stepping below when needed. |
| Empty Map | No selection dock, count or Combine icon. Tap a route first. |
| Short landscape List | Existing compact shell status area; explicit active mode and exit also on pushed detail. |
| Regular iPad | Map panel header and List pane footer; same shared store flags and icon ordering. |

The [native layout proposal](activity-selection/README.md) illustrates the List footer, Map results header and Filters toggle; these are mockups, not a completed SwiftUI implementation. The actual native release requires simulator renders and physical iPhone/iPad/VoiceOver checks.

## Delivery plan

Steps 1–4 are implemented locally. Step 5 has browser/simulator evidence; physical-device, beta and full release-suite acceptance remain open. Keep state, scope and controls together when releasing this behavior change.

| Step | Deliverable | Completion evidence |
| --- | --- | --- |
| 1. Shared transitions | Add versioned selection-interaction fixtures for mode, scope and named actions; port unchanged focus/inspection invariants. Define expected differences from the existing additive Show on map and empty Add-tap rules. | TypeScript and Swift consume the same vectors through production state owners. |
| 2. Production web state and projection | Move mode/scope into the actual selection owner; introduce named input actions and a distinct browsing projection. Keep ordinary filtering available for reconciliation and Stats. Update Show on map, map/area/photo picking, clear/reset and streamed-library handling. | Correct replacement/union, independent inspection, stable hidden IDs and no visibility feedback loop. |
| 3. Production web controls | Port approved header/footer/filter/icon layout into authenticated Map/List. Preserve user column/density settings instead of the fixture's simplified columns. Remove duplicate default bulk menus; keep Combine visible in detail; hide Map selection controls at zero selection. | Browser journeys at narrow phone, landscape and desktop, including keyboard/history and active scope recovery. |
| 4. iOS state and presenters | Add shared store mode/scope; update reducer, caches, picker and visible route IDs; replace local Add mode. Compose reusable native selection controls into sheet, footer, compact shell/detail and Filters. | Equivalent reducer/picker tests; no stale asynchronous pick; retained camera, navigation and scroll. |
| 5. Release validation and cleanup | Simulator/gallery renders, device/VoiceOver review and beta tasks. Remove temporary prototype store/flags and obsolete callers; retain a development fixture route only if useful, backed by production components. Update contracts and implementation evidence. | Both platforms follow the approved rules; #384 status distinguishes delivery, remaining device checks and any sharing follow-up. |

### Web owners

| Area | Files and concrete change |
| --- | --- |
| State and commands | `src/store/selection.ts`, `src/store/index.ts`: session mode/scope, named pick/toggle/clear/scope actions; no persisted stale selected-only state. Stop inferring user intent solely from functional versus array updates. |
| Eligibility and projection | `src/hooks/use-filtered-activities.ts` plus a browsing projection hook: preserve ordinary eligibility; narrow only browsing consumers. |
| Map input and presentation | `src/components/map/selection-control.tsx`, `interactive-map.tsx`, `photo.tsx`: mode-aware input, projected layer/photo/pick IDs, compact persistent header when a group exists. |
| List and detail | `src/components/list/card.tsx`, `activity-list.tsx`, `data-table.tsx`, `data-table-pagination.tsx`, `columns.tsx`, `data-table-view-options.tsx`: sport affordance gating, icon-before-count footer outside detail transition, mode-only bulk actions and accurate totals. |
| Filters and lifecycle | `src/components/layout/app-sidebar.tsx`, `layout/sidebar/filters.tsx`, authenticated browsing layout: Only selected, active count/indicator, browsing Reset and reviewed session lifetime. |
| Show on map | `src/lib/show-on-map.ts` and callers: validate before mutation, replace by default, union in Combine, then activate/frame. Preserve explicit recovery for ordinary filters. |
| Prototype cleanup | The temporary store and bar have been removed. `components/activity-selection-controls.tsx` uses production state; `app/selection-prototype/` retains only local gallery setup and development-only routing. |

### iOS owners

| Area | Files and concrete change |
| --- | --- |
| State and projections | `Models/SelectionState.swift`, `ActivityStore.swift`: shared mode/scope and named actions; keep ordinary `visibleIDs` for reconciliation; derive browsing IDs/activities independently. Normalize last-member removal and inspect eligibility in final state. |
| List caching and summaries | `ActivityStore.listedSnapshot`, `List/ActivitySummaryView.swift`: include selection/scope in cache keys whenever restricted, even when not sorting by selection. Filtered summaries use browsing scope; selected totals include hidden IDs. Do not re-filter geometry on every drag frame. |
| Map picker and query safety | `Map/RoutePicker.swift`, `MapScreen.swift`: remove `isAdding` as an independent state owner; use shared Combine. Guard pending queries with current mode/scope/eligibility as well as geometry revision/generation. Empty taps in Combine return before clearing detail; clear/zero selection do not end the mode. |
| Map surface | `Map/RoutePickerSheet.swift`: persistent group controls before count, direct Fit/Clear, mode-only sport toggles and collapsed/detail mode visibility; no empty Map dock. Keep native detents and camera-fit footprint logic. |
| List and native rows | `List/ListScreen.swift`, `ActivityRowView.swift`, `Support/BrowseComponents.swift`: replace menu-based mode entry; reuse sport badge with mode gating; keep selected row identity. Factor reusable group controls rather than another platform-local mode. |
| Footer/detail/landscape hosts | `App/BrowseContent.swift`, `AppShell.swift`, `List/ActivityDetailView.swift`: keep controls outside pushed List roots, prevent duplicate toolbars, preserve Back/gesture and compact-shell adaptation. |
| Filter Form and rail | `Sidebar/FilterPanel.swift`, `FilterRail.swift`, `FilterPart`, `Models/ActivityFilters.swift`: browsing-only selection filter, active count/reset, displayed count, rail popover, Stats exclusion. |

Do not add sync/API/database fields or server filtering for this feature. Selection and its display scope are local browsing concerns. Preserve the existing auth, sharing/privacy and activity availability rules.

### Shared fixtures and acceptance

`shared/parity/state-fixtures.v2.json` contains 72 transitions and is consumed by both production state owners. The v1 file is retained for unrelated profile/cache consumers and historical selection behavior. Preserve unchanged focus/removal/deletion invariants rather than silently rewriting the old reference. Cover these cases through real implementations:

1. One tap selects five overlapping routes; List marks exactly those five with Combine off and no checkmarks.
2. Only selected gives the same eligible activity membership in Map/List. Turning it off restores ordinary filters and camera.
3. Row inspection/Back keeps the group, List position and mode; Show on map replaces by default and adds in Combine.
4. Combine unions repeated map hits, preserves empty taps, and toggles sport-icon membership. Turning it off retains the group and removes checkmarks.
5. Hidden selected IDs, a GPS-less selected member and an empty displayed set retain truthful counts, recovery and selected summaries.
6. Clear or last-member removal disables Only selected but keeps Combine; independent eligible List detail stays open. Deletion and account changes reconcile correctly.
7. Filter Reset affects browsing scope; Stats calculations/reset remain independent. Selected-only List cache invalidates on membership changes under a non-selection sort.
8. Pending native taps/area queries cannot apply after mode, scope, data, gesture or destination changes. Cancelling an area selection changes nothing.
9. The mode and exit remain reachable in the List footer at zero selection, collapsed nonempty Map, pushed detail, short landscape, regular iPad and large text. Sport symbols keep 44-point targets and meaningful VoiceOver labels.
10. Web history/focus and native completed/cancelled Back gestures retain the navigation contract.

Run relevant web state/Show on map tests and browser checks; native `SelectionStateTests`, `ActivityListTests`, `ActivityFilterTests`, rendered List/detail/filter tests and route hit/picker tests. Record simulator/device settings with gallery captures. Prototype checks and simulator renders supplement, rather than replace, beta and physical-device acceptance.

## Implementation and verification status

The development route `/selection-prototype` (`?device=phone` for a phone viewport) now uses production web state and controls with local gallery data. Temporary mode/scope ownership and prototype flags are removed. Ordinary authenticated routes keep the user's display/column preferences; only the fixture route sets simplified columns.

Delivered locally: shared session flags and named commands, default replacement/Combine union, live browsing projection, sport-icon gating, persistent group controls, Only selected Filters, mode-only bulk actions, clear/reset/account lifetime, Show on map and native query fences. Web picks return the validated hit set so a stale hidden feature cannot close detail as if it were an eligible Combine hit; membership operations use Set lookups for bulk groups. Web route/photo eligibility and filtered summaries use the browsing projection. Native route/list eligibility, filtered summary and list cache keys do the same; selected summaries include hidden members. Stats stays independent. Native has no map-photo layer in this checkout, so no new photo overlay was introduced.

Verification on 13 October 2026:

- 86 web tests pass across shared state, Zustand/account/reset, Show on map, filter, sorting/summary and Stats scope tests. TypeScript and scoped ESLint pass.
- Chrome journeys cover the production components: shared restriction, normal inspection, Replace/Combine Show on map, overlaps, empty/clear/reset, bulk gating, icon checkmarks, narrow 320 px, phone, landscape, desktop and embedded preview. Existing List navigation/history/keyboard/focus and retained-scroll regressions pass.
- Xcode 27 / iOS 27, iPhone 18 Pro simulator: 61 focused native tests pass, including all 72 shared transition cases, reducer/store/list-cache/lifetime tests, route hit/query adapter, List controls across phone/dark/landscape/iPad-sized/large-text layouts, empty Map dock and stable result-panel handle/bottom scrolling. Render tests exposed and fixed the footer being covered by the outer navigation push. Six further native tests pass for filtered/selected summaries, retained navigation, List/Map handoff and stacked browsing sheets. Three isolated filter tests and twelve camera/sheet checks also pass, including exact results scroll retention across collapsed/detail states and unchanged settled camera padding across panel detents.
- [Native simulator captures](activity-selection/README.md#implemented-native-captures) supplement the earlier layout proposals. The map uses an offline synthetic style; captures verify controls/layout, not remote basemap loading.

Physical iPhone/iPad touch and VoiceOver, full release-suite acceptance and beta journeys remain open. An exploratory broad native run encountered photo/cache/render failures and was interrupted. Related filter/navigation/camera failures were investigated and those checks now pass in isolation; a clean repository-wide native run has not been established. Sharing picker/draft redesign remains separately scoped.


### Device follow-up: stable sheet size and controls-only collapse

Physical-device review on 13 October showed two problems: detail content leaked below the collapsed group row, and resizing the sheet while switching Results/detail made both the container and its contents move at once. The phone sheet now has one geometry-based middle height (about half the window) for results and detail, independent of selection count. Opening, Back and paging change the content without resizing or overlapping crossfades; dragging still selects Compact/Middle/Large. Collapsed contains only Combine, count/status, Fit and Clear, with all activity content clipped, hidden from accessibility and noninteractive. The inspected activity and results scroll position are retained for reopening.

The prior dynamic-height UIKit bridge is removed. The native presenter uses ordinary SwiftUI detents whose values stay constant through content changes. Camera fitting uses the same middle-height calculation, with a cap to preserve usable map space on short phones.

`nativeMiddleDetentStaysStillWhenSwitchingResultsAndDetail` samples animation frames through repeated Results/detail and membership changes, asserting unchanged height, selected stop and presenter, plus manual detent restoration. `nativeSheetShowsOnlyControlsWhenCollapsedAndRetainsScroll` verifies the collapsed surface visually and checks exact scroll retention at normal and accessibility text sizes. All 14 targeted tests in the rendered sheet and MapResults suites pass on the iPhone 18 Pro / iOS 27 simulator, including stacked sheets, List-to-Map handoff, large text and retained scroll. Collapsed captures were visually checked and a signed Dev build prepared for Tailscale installation. Physical-device acceptance of this refinement remains open.


### Device follow-up: one contextual Fit button

The persistent Map group header owns the only Fit control on web and iOS. Results fits the selected group; activity detail fits the currently inspected route, including after paging or collapsing. The accessible label/title follows that target (Fit selection / Fit route). Native no-GPS detail disables the action instead of fitting a different selected route. List/Stats Show on map remains a navigation action.

The rendered native regression activates the real control through Results → activity 1 → activity 2 → Results and checks camera commands and retained selection/inspection, plus disabled no-GPS/collapsed behavior. It and the frame-sampled stable-height regression pass. The web browser journey checks a single Fit control, the changing target label, and selection retention after fitting; the complete responsive selection journey, TypeScript and scoped ESLint pass.
