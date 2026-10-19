# React UI reconciliation

This inventory records shared product owners and intentional variants introduced after the maintainability rescreen. It does not replace feature state, transport ownership, generated semantic definitions, or native navigation.

## Product dialogs

`src/components/app-dialog.tsx` owns the application dialog layer, safe-area-aware viewport padding, maximum available height, bounded scroll body, fixed header/footer slots, contextual close target, and reduced-motion treatment. It composes the existing Radix primitives; generated `ui/*` primitives remain unchanged.

| Consumer                              | Explicit variant                                                                                                      | Feature ownership retained                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Settings                              | Sections; fixed tab strip; each active tab is a slotted scroll body; 480px preferred height; wider in short landscape | Tabs, sync/import status, sign-out/deletion state and dismissal guards            |
| Edit activity                         | Sections; form body scrolls independently of Save footer                                                              | Validation, dirty/pending state, server action and cache refresh                  |
| Share create/created/empty and manage | Sections; fixed actions; share metadata list scrolls within body                                                      | Selection, privacy/expiry options, once-only token display, copy/revoke mutations |
| Legacy share (disabled feature flag)  | Whole-content scrolling                                                                                               | Retired flow remains disabled; no visibility/eligibility changes                  |
| Signed-out connection                 | Glass; whole-content scrolling; no automatic close button                                                             | Required non-dismissible connection policy and official Strava artwork            |
| First summary fetch                   | Glass; whole-content scrolling; no automatic close button                                                             | Pending dismissal guards, retry timing and explicit Close/Continue actions        |

The photo viewer stays a specialized full-screen media surface. Its safe-area navigation, gestures and photo lifecycle remain local; its close action shares the dismissal owner below. Sidebar sheets remain the existing navigation primitive, not a product form dialog.

`showClose` controls the shell's close button only. Open-state changes, Escape/outside guards and mutation cancellation remain the feature's responsibility.

## Preference menus

`src/components/preference-menu.tsx` owns available-height scrolling (including collision-aware submenus) and persistent independent-checkbox selection for pointer and keyboard.

| Consumer                   | Shared policy                                                  | Explicit variant                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar sport-type choices | Independent checkbox items stay open                           | Group/category toggles and mixed-state semantics stay in the sidebar                                                                                     |
| Map layers                 | Photo/overlay checkboxes stay open                             | Base-map radio selection closes normally                                                                                                                 |
| List view options          | Column checkboxes stay open; all submenus cap available height | Scrolling mode, page size, summary scope and density are exclusive radio groups and close normally; bulk-selection commands remain ordinary menu actions |

Account and activity action menus remain ordinary action menus: their commands intentionally dismiss. Generic menu primitives and feature option definitions are not duplicated by this owner.

## Dismissal and activity map actions

`src/components/dismiss-button.tsx` owns a 44px target, focus ring, icon-only visual treatment and required contextual accessible label. Consumers are application dialogs, map feature details, activity detail collapse, and the photo viewer. Collapse keeps its Minus icon and local behavior; close keeps X. Back remains a navigation action. The photo viewer explicitly retains its white media focus ring/background.

`src/components/list/activity-map-action.tsx` owns labels from the existing presentation dictionary, a common 44px target, route eligibility, unavailable explanation and dispatch for full-detail and compact List cards. Compact changes visual prominence; labelled detail changes visible text. The screen still owns `useShowOnMap`, data access, filter-clearing decisions, actual navigation and failure notifications. Eligibility memoizes the linear `canFrameRoute` check by the two encoded geometry strings. It accepts point routes and uses the same coordinate-validity predicate as actual framing. Selected, highlighted and inspected state remain separate.

## Element measurement

`src/hooks/use-element-size.ts` owns callback-ref attachment/replacement, immediate measurement, ResizeObserver cleanup, equal-value suppression and optional retention through zero-size layout. Ref cleanup/reattachment also supports React Activity hide/reveal.

| Consumer                                | Box and zero-size policy                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Activity detail card responsive actions | Content box; zero sizes allowed                                                                                          |
| Elevation plot                          | Content box; retain last nonzero size; 304px initial width retained for initial rendering                                |
| List inspection presentation            | Client box; zero sizes allowed; explicit readiness                                                                       |
| DataTable fit-to-width viewport         | Client box on table wrapper; attached only while fitting; natural cell-content measurement remains local                 |
| Stats `Measure`                         | Migrated by the Stats owner using the same hook; retains its flooring/render gates and feature-supplied retention option |

Remaining observers in DataTable and browsing-context are scroll-overflow/scroll-restoration policies, not competing generic size hooks. Map camera occlusion measurements remain owned by framing and must use current visible element bounds.

## Regression coverage

`node scripts/verify-react-ui-reconciliation.mjs <local-base-url> <evidence-directory>` creates/removes only its own temporary fixture route. The shared browser fixture registry must register the `reconciliation` route pointing to `scripts/fixtures/react-ui-reconciliation.tsx` (integrated by the root task). The local server must run with fixture/dummy environment values. The test blocks unconfigured API/action/remote traffic through the existing browser evidence helper. It verifies actual Edit/Settings/Share consumers at phone portrait, short phone landscape and tablet sizes; fixed Edit actions; Share focus restoration; pointer/keyboard preference checkbox persistence and menu bounds; both map-action dispatch/eligibility variants; element replacement, resize and actual React Activity hide/reveal; feature/photo dismissal targets; and required onboarding dismissal behavior. It saves screenshots, trace, events and a result JSON.

`activity-map-action.test.tsx` and `route-framing.test.ts` cover empty/invalid geometry, point framing, summary/full fallback, common eligibility and explicit filter-clearing labels. Existing List inspection browser proof covers responsive fit, retained scroll and cross-page inspection; Stats tests are coordinated with the Stats owner.
