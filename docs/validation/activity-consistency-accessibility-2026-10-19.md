# Activity consistency and accessibility review — 19 October 2026

Scope: #383/#387 after the #413, #417 and #420/#421 activity-surface changes. This is supporting implementation evidence, not a substitute for the dedicated physical-device/assistive-technology acceptance in #387.

## Baseline and environment

- Base commit: `dfee3fc9bb1e9cbb9da0ae2eaba5024faf1f17aa`; reviewed with the working changes on `codex/activity-boundaries-and-presentation`.
- Host: macOS 27.0.1 (26A434).
- Web fixtures use synthetic gallery activities, an isolated browser profile, a private copied checkout and dummy environment values. Unconfigured API calls, server actions and remote requests are blocked. Saves use mocked v1 responses and the real scoped IndexedDB/library owner.
- Web layout matrix: 390×844 phone portrait; 844×390 phone landscape; 1024×768 tablet; 512×768 Split View approximation; 1440×1000 desktop; 200% text at 390×844; 170% text and RTL direction at 844×390. The tablet/phone labels describe viewport approximations in desktop Chromium, not Safari or physical iOS hardware.
- Native supporting fixtures: iPhone 18 Pro simulator, iOS 27.0, with rendered hosts at phone, short landscape, tablet and accessibility Dynamic Type sizes. Individual run results are recorded below when available.

## Reconciled actions and discoverability

| Meaning             | Web detail/List/Stats                                                             | Native detail/List/Stats                                         | Availability and intentional differences                                                                                |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Edit                | Direct in wide detail, overflow in compact detail; same form receives an activity | Direct heading/navigation action; additional row context action  | Mutation requires the connected account; preview/read-only disables edits. The native direct control is intentional.    |
| Show on map         | Dedicated map control; explicit filtered/unfiltered command variant               | Dedicated native heading/navigation control; List context action | Route eligibility is evaluated from data. Disabled state explains missing GPS. Activity names never determine behavior. |
| Fit route/selection | Framing action distinct from Show on map                                          | `viewfinder`, distinct from Show on map                          | Framing does not mean selecting, activating, navigating back or dismissing.                                             |
| Refresh from Strava | Overflow command                                                                  | Native sync/import mechanisms retain their product placement     | Pending state prevents duplicates; committed activity and partial-photo outcomes are distinct from a remote error.      |
| GPX                 | Download GPX in overflow                                                          | Export GPX row/native share sheet and context action             | Download versus native sharing is intentional. Cached route availability and route/elevation quality remain meaningful. |
| Open in Strava      | Overflow external link                                                            | Bottom action row                                                | Destination remains the actual activity.                                                                                |
| More / Back / Close | Overflow, navigation and contextual dismissal remain separate                     | Context menu, native Back and contextual Close remain separate   | Important native actions also expose accessibility actions; long press is not the sole native editing entry.            |

Context-menu order is intentionally platform-specific: native row menus offer Edit, Export GPX and (in List) Show on map; web overflow offers compact Edit, Refresh, Download GPX and Open in Strava. Wide web detail removes the duplicate menu Edit because a direct Edit is visible. The surface tests check this invariant and disabled read-only/no-route states.

## Defects found and addressed

1. Web sport categories relied on color for the ordinary selected state and offered only hidden text for mixed state. They now include visible Check/Minus indicators, retain `aria-pressed` true/false/mixed, and keep the existing sport artwork and colors.
2. Sport-category keyboard activation entered the pointer double-click timer. Two rapid keyboard activations could isolate a category instead of applying two toggles. Keyboard/assistive clicks now apply immediately; the pointer double-click behavior is retained.
3. Existing dialog regression assertions used the old “Sport type” label and omitted the new changed-draft discard confirmation. Assertions now use “Sport” and deliberately accept that confirmation in the existing dismissal scenario.
4. Applying the web “Save changes” visual label to the native navigation bar crowded the large-text title to “Edit acti…”. The deliberate native visual variant is again “Save”, with the full “Save changes” accessibility label. The final large-text rendering shows the complete Edit activity title, Cancel and Save.
5. Error-toast exit animations ignored Reduce Motion and retained keyboard dismissal ownership after the toast disappeared. Rapid successive Escape presses could fail to reach the editor's discard confirmation. Toasts now release that layer immediately under Reduce Motion; the regression verifies one discard confirmation after layered dismissal. Toast Close also has a localized accessible name and a visible 44px target, and cache Retry has a 44px target. Error text wraps beside those controls.

The #413 regression is verified at the form-to-command boundary and in the browser: a one-character name is valid, and clearing an existing description sends `description: ""`. Pending submission blocks dismissal and duplicate saves. Error fixtures retain the draft and expose the server request ID and retry information.

## Automated evidence

The focused browser suite is `scripts/verify-accessibility.mjs`, registered as `pnpm test:browser accessibility`. It checks real product components, keyboard traversal/containment/restoration, action-menu membership and disabled states, 44px map/menu/close targets, responsive/large-text/RTL dialog bounds, non-color selected/mixed states, and the v1 mutation response returning through the canonical library owner to the visible detail. `review.json`, screenshots, a Playwright trace and browser events are written by the harness.

The existing reconciliation/List/presentation suites provide additional dialog/popover/submenu dismissal, retained inspection/scroll, keyboard stepping, explicit map-command availability, connection failure recovery and expanded-message/RTL evidence. A normal-motion and Reduce Motion menu-to-dialog sequence is retained.

Final repository checks reported by the integration owner: whole-repository ESLint; 1,063 web/server/worker unit tests; 45 React/settings UI tests; 15 quality-harness tests; all four generated-resource gates; TypeScript with a fresh incremental state; formatting and diff checks all pass.

The final native compilation includes `PresentationText`, generated resources and the native Save variant. The rendered Edit suite passes all 12 cases, including large text and pending/error recovery; adaptive detail passes phone, accessibility text, tablet, landscape and no-GPS cases; the preference redraw/reopening test and native presentation/error-fact tests pass.

The former hosted action-row fixture encountered an empty accessibility tree on iOS 27. Its acceptance now uses real XCUITest accessibility queries against the DEBUG offline product fixture. iPhone 18 Pro/iOS 27.0 passes all three UI journeys plus 19 SyncController tests (22 total), and iPad Pro 11-inch (M5)/iOS 27.0 (24A434) passes all three UI journeys, with zero failures/skips. The action matrix checks ordinary, accessibility text, no-GPS, summary-route, dark, landscape and RTL configurations: meaningful names, 44pt targets, availability, order, native sharing cancellation/departure cleanup, cached-elevation GPX XML and zero network requests. iPad sharing additionally verifies the popover is anchored to the export row. Results: `/private/tmp/activitymap-action-ui-initial.xcresult` and `/private/tmp/activitymap-action-ui-ipad.xcresult`.

Old custom-panel tests that require an embedded `UINavigationController` do not describe the iOS 27 retained native-sheet presentation and are not counted as passing native-sheet evidence. UIKit object inspection and XCUITest queries still do not establish actual VoiceOver traversal.

Final browser results:

- Final frozen accessibility/mutation suite: `/private/tmp/activitymap-frozen-accessibility-proof-20261019/summary.json` and `accessibility/review.json`, both passing (15 seconds of browser assertions after isolated compilation). Covers all seven layouts, keyboard focus and layered dismissal, action/state semantics, denied-edit permission with disabled explained direct/overflow Edit and enabled Refresh, deliberate description clearing, pending/single submission, committed-response rendering, an editor baseline surviving background sync, partial photos, repeated local-cache Retry without a second remote write, named 44px toast controls, Retry-After and upstream-success Refresh recovery. Its exact three PATCH bodies are retained in the review JSON.
- Reconciliation suite: `/private/tmp/activitymap-final-ui-consistency-20261019/reconciliation/result.json`, passing. Its containing harness run was superseded for List label assertions; only this successful suite result is cited.
- Final independent List and presentation suites: `/private/tmp/activitymap-list-presentation-proof-20261019/summary.json`, both passing. List includes all four inspection viewports; Fit/Pinned/Free modes; sticky selected/inspected cells; sorted/cross-page stepping; retained history, query/hash, scroll and focus; nested Edit/menu keyboard handling; filter-first dismissal and peer destination restoration. Presentation includes cancelled/pending/failed connection recovery, stable auth callbacks and English/expanded/RTL rendering.

Earlier failed mock-envelope/selector runs are superseded and are not passing evidence. Small passing summaries are retained beside the screenshots; large traces and result bundles stay at the exact external artifact paths above.

Review screenshots are retained in [`accessibility-2026-10-19/`](accessibility-2026-10-19/): [web landscape](accessibility-2026-10-19/web-edit-landscape.png), [web 200% text](accessibility-2026-10-19/web-edit-large-text.png), [web RTL](accessibility-2026-10-19/web-edit-rtl.png), [cache recovery](accessibility-2026-10-19/web-cache-recovery.png), [native accessibility text](accessibility-2026-10-19/native-edit-large-text.png), [native landscape actions](accessibility-2026-10-19/native-actions-landscape.png) and [native iPad actions](accessibility-2026-10-19/native-actions-ipad.png). The integration owner visually inspected the representative web/native edit layouts; the form body was intentionally scrolled to Sport/Save in some images, and Name remains reachable by scrolling. These are layout evidence, not assistive-technology acceptance.

## Stats follow-up from device testing

Testing beta 14 exposed a second iPad Stats title bar, an iPad compact Sport mix card showing expanded measurements, calendar scrolling lag, and horizontal calendar pans sometimes returning to the dashboard.

- Regular-width Stats now retains one fixed workspace header. The tile title and Back action belong to the scrolling detail content. Phone navigation keeps its existing controls.
- Sport mix no longer treats a wide dashboard as an expansion request. Compact cards retain their summary and explicit Expand action on both devices; detailed measurements remain available in the focused page.
- Horizontal calendar scroll regions retain their pans, including at either end of history. The native edge gesture and intentional content Back outside the timeline remain available.
- Intermediate week positions stay inside the calendar scroll leaf. Shared inspection retains an explicit initial anchor, the settled viewport, and the viewport when leaving during deceleration. Initial day selection and metric changes preserve the visible timeline.

The new offline `StatsUITests` fixture exercises the production shell with six years of mixed-sport history and a busy current day. The calendar scroll regression also exercises 800 week columns and checks that intermediate positions do not rebuild prepared history. Simulator evidence does not establish physical-device frame times or VoiceOver acceptance; the reported scrolling responsiveness still needs retesting on the user's hardware.

All three real Stats UI journeys passed on both iPhone 18 Pro and iPad Pro 11-inch (M5), iOS 27.0 (24A434), in `/private/tmp/activitymap-stats-followup-acceptance.xcresult`. These six passing UI runs verify normal/accessibility3 Sport mix, absent compact detail controls, a single focus heading and no extra native iPad navigation bar, reachable iPad Settings, first-day selection without repositioning, more than one year of horizontal panning in both directions, retained anchors, current-day activity rows reached by vertical scrolling, and intentional content/native-edge Back. The containing result had a separate failing scroll-rendering unit assertion; it is not counted as an overall passing bundle.

The final separate unit bundle `/private/tmp/activitymap-stats-calendar-unit-final.xcresult` passes all three focused suites on both simulators: eight logical tests, nine runtime executions per device (18 total), zero failures and zero skips. These cover calendar layout, native gesture ownership/delegate restoration, initial-anchor stability, no history reconstruction during intermediate native layout offsets, metric changes, explicit restoration and timeline recreation. Its [small summary](accessibility-2026-10-19/native-stats-unit-summary.json) is retained. The superseded hosted test assumed direct UIKit/proxy pixel scrolling published SwiftUI's user-scroll identity; this runtime does not do that. The corrected unit test uses the public declared-anchor contract, while the passing real UI tests establish actual pan-and-reopen retention. Leaving during deceleration remains a hardware acceptance case rather than a certified synthetic result.

Retained visual evidence: [compact iPad](accessibility-2026-10-19/native-stats-ipad-compact.png), [expanded iPad](accessibility-2026-10-19/native-stats-ipad-expanded.png), [phone large text](accessibility-2026-10-19/native-stats-phone-large-text.png), and [calendar history](accessibility-2026-10-19/native-stats-calendar-history.png). The iPad XCUIScreen attachments retain portrait raster dimensions while the actual automation viewport is landscape; use the native accessibility frames and assertions for bounds rather than interpreting those raster proportions as exact device geometry.

## Dedicated acceptance still required

- Actual VoiceOver traversal on iPhone and iPad: names, rotor order, selected/mixed/Combine states, disabled reasons, error announcement, chart adjustment, gallery current-photo announcement and focus after completed/cancelled dialogs.
- Physical iPhone landscape and iPad/Split View, with exact device/OS/build recorded; Safari/browser text enlargement as well as desktop Chromium viewport checks.
- Native Reduce Motion, contrast/non-color review over the real map, full Map/List/Stats/Filters/Account recovery journeys and directional glyph behavior in an RTL system preview.
- Screen-reader behavior cannot be certified from DOM roles, UIKit accessibility objects, screenshots or simulated keyboard interaction alone. No live VoiceOver session was performed for this record.

Keep #387 open until its dedicated user/device/assistive-technology pass is recorded. #383 retains any broader decorative-icon and first-use discoverability inventory outside these reviewed surfaces.
