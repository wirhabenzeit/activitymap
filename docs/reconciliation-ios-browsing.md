# Native browsing ownership and deliberate variants

This reconciliation keeps data, selection, camera and feature inspection state with their existing owners. Shared presentation owns the decisions that must agree across screens.

## Inspection

`AdaptiveActivityInspection` replaces the parallel List and Stats implementations. It owns the 760-point / regular-size-class / non-accessibility-text adjacent-detail rule, 340–420-point detail width, native destination registration, persistent push during resize, and the adjacent close control. Its caller supplies the inspected-ID binding, content and destination. `ActivityInspectionState` describes only presentation; it cannot mutate activities or selection.

| Migrated caller                              | Preserved responsibility / deliberate difference                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListScreen`                                 | `ActivityStore.inspectedActivityID`, retained List shell pushed state, List options/footer, full-split shell chrome and bottom divider extension. When inspection collapses the filter panel, it waits for the wider pane before deciding to push. A hidden List narrowing does not create a push; existing adjacent panels and pushed destinations remain mounted across tab switches. |
| `StatsActivityInspection`                    | `StatsDashboardState.inspectedActivityID`, active dashboard/focus navigation level, Stats back label and environment. Showing an activity on the map clears only Stats inspection. Only the active navigation level registers the destination.                                                                                                                                          |
| `ActivityDetailPanel` / `ActivityDetailView` | Shared activity content and native detail navigation remain feature-supplied; no second inspector model is introduced.                                                                                                                                                                                                                                                                  |

Map results retain their sheet/detent/pager behavior. Chart focus navigation is not an activity-inspection presentation and is unchanged.

## Action metadata and migrated callers

`NativeActionID` and `ActionPresentation` are generated from `shared/presentation/catalog.v1.json`. `BrowseActionIcon` / `BrowseActionLabel` render metadata; callers retain actions, placement, tint, accessibility context and eligibility. Contextual labels remain useful: “Back to Records” and “Close activity details” identify the destination rather than announcing only “Back” or “Close”.

| Semantic action | Migrated callers                                                                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Back            | `AppToolbarBackButton` (all existing toolbar consumers); `RoutePickerSheet` return-to-results control. Both use the directional `chevron.backward` glyph.                                                                                                                                                                   |
| Close           | Shared adjacent inspection close; `PhotoViewer` close. The photo viewer retains its contrasting circular background.                                                                                                                                                                                                        |
| Show on map     | `ActivityRowView` swipe, `ActivityRowContextMenu`, `ActivityDetailHeading`, `ActivityDetailView` toolbar. `BrowseContent` uses the separate clear-filters-and-show-on-map descriptor for explicit recovery.                                                                                                                 |
| GPX export      | `ActivityRowContextMenu` and `ActivityDetailActions`: canonical native “Export GPX”, common preparation copy and export glyph. Detail keeps its short route/elevation subtitle and trailing system-share affordance. Web deliberately keeps “Download GPX”.                                                                 |
| Active route    | `ActivityRowView` and `BrowseActivityHeading` passive badges; `RoutePickerSheet` interactive toggle and row state. The catalog defines `location` for inactive, `location.fill` for active/badge. Badge size and 44-point toggle target remain distinct. Active-route wording is localized independently of selected state. |

Clear-selection X controls remain selection commands, not dismissals. Photo Previous/Next remain physical paging directions, not Back. Fit-route / Fit-selection controls retain their map framing intent. No action ordering or contextual membership was flattened into a universal menu.

All Show-on-map callers consult `ActivityStore.canShowOnMap`, backed by the existing cached drawable-route IDs. The store command uses the same guard. Zero/one valid vertex cannot select, navigate, frame or clear filters; hidden drawable routes still offer explicit filter recovery.

## Empty results and filter drafts

`BrowsingPresentation.resultEmpty` owns completed-library result emptiness: empty library, no matching activities, or map-only no routes. Stats applies it after session and completed-cache guards, using its own non-date predicate count. Completed offline/paused/backoff/failed caches with no matches now display the same filter recovery as other browsing screens. Stats recovery resets only Stats predicates. Sync/account progress and errors stay in Settings; unfinished history is not advertised as a completed empty library.

`FilterResetButton` is shared by the full filter panel and collapsed rail. Reset remains available even when the committed predicate count is zero: custom-date and invalid numeric drafts are local UI state. Existing store reset revisions discard those drafts without recomputing unchanged filter results. Stats reset retains browsing dates, selection-only scope and selection.

## Verification

- Generator/catalog tests check native/web export terminology, metadata variants, localization placeholders and generated drift.
- Native metadata tests check complete action IDs and directional/active glyph mappings.
- `BrowsingReconciliationTests` checks completed-cache empty results across transport states, unavailable/incomplete history, invalid route capability, and inspector transitions.
- `AdaptiveInspectionTests` mounts the production presenter in a real `NavigationStack`, observing native push/pop, retained hidden-List presentation and independent inspection IDs without relying on app-hosted accessibility traversal.
- Existing filter batching, browsing state, map context and selection suites exercise no-op draft reset and preserved state contracts.

Runtime evidence and exact counts are reported with the implementation handoff. This change does not include physical-device installation or a final visual/VoiceOver acceptance audit.
