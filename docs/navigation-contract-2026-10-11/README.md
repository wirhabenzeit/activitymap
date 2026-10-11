# Navigation implementation verification — 11 October 2026

Verification of the [accepted contract](../navigation-contract.md) for issues #358 and #359. These captures show the implementation; the [status-quo evidence](../navigation-audit-2026-10-11.md) remains a separate, unchanged baseline.

The implementation and documentation are committed in [PR #380](https://github.com/wirhabenzeit/activitymap/pull/380). After rebasing onto main `2b68d6fb` (photo/sign-in #379), the iOS app rebuilt and all 21 targeted tests / 42 parameterized executions passed with no failures or skips. [Post-rebase summary](native-pr-rebased-summary.json) records this check at implementation commit `81a03e31`; subsequent PR-link changes affect documentation only.

The [control audit](../navigation-contract.md#control-audit-baseline-to-accepted-implementation) records baseline effects and the accepted target. The contract also records [decisions that revise the issue proposals](../navigation-contract.md#decisions-reconciled-with-the-issue-proposals) and [PR references/delivery status](../navigation-contract.md#implementation-references-and-delivery-status). The October 8 reference's HTML and exported PDF page 24/question 06 are corrected; [correction provenance](../navigation-reference-2026-10-08/correction.json) records the PDF update.

## Results

| Check | Result |
| --- | --- |
| Web List | Passed at 1440×1000, 1024×768, 760×768 and 402×874: one initial history entry, stepping/reload/Back/Forward, responsive inspection, retained page/scroll/settings, and filter-first Escape with focus restoration. |
| Web Stats | Passed for all seven tiles at 1440×1000, 874×402 and 402×874: focus/inspection nesting, direct links, Back/Forward, resizing, dark mode, and retained metric/grouping/focus/dashboard scroll after destination remount. |
| Web Map | Passed at 1440×1000, 874×402 and 402×874: four selected → Fit selection → inspect → Fit route → expand/shrink → Back → inspect → Clear selection. Selection, active identity, camera and history assertions accompany each transition. Narrow filter Escape preserves inspection. |
| Web unit/component checks | 44 passed across List inspection, Stats views/loading/focus, selection, Show on map and route framing. |
| Native navigation/rendered tests | 19 tests / 38 parameterized executions passed; separate detail-profile/scroll checks added 2 tests / 4 executions. No failures or skipped tests. |
| Native screenshots | Wide Map detail and small-phone accessibility detail gallery runs passed. The short-phone opening sheet leaves usable map space; content scrolls and can be expanded. |
| Static checks | TypeScript, ESLint for changed web files/scripts, and whitespace checks passed. All 139 baseline evidence files retained their original hashes. |

The native suites cover results/detail transitions, selection/active identity, camera-only Fit, retained detents, compact footprint, resize without refit, List return, Stats nested destination labels, and accessibility opening-sheet sizing. See [navigation summary](native-summary.json), [navigation test cases](native-tests.json), [profile summary](native-profile-summary.json) and [profile test cases](native-profile-tests.json).

The browser runners exercise production components with fixture data on temporary routes, removed after each run. Map uses an offline blank style and placeholder terrain: these checks prove navigation, geometry framing and controls, without proving live map tiles or authenticated API behavior. List and Stats round trips unmount/remount the destination components. Native rendered tests run on an iPhone 18 Pro simulator with parameterized host dimensions and text sizes; they are not separate physical-device runs.

## Evidence and reproduction

- [List browser result](web-list-verification.json): `node scripts/verify-list-inspection.mjs <base-url> <output>`.
- [Stats browser result](web-stats-verification.json): `node scripts/verify-stats-focus.mjs <base-url> <output>`.
- [Map transition observations](web-map-observations.json): `node scripts/capture-navigation-map.mjs <base-url> <output>`.
- Native: run `MapResultsTests`, `StatsInspectionTests` and the rendered Map, List resize/return and detail-profile/scroll cases in `RenderedRoutePickingTests` with the ActivityMap Xcode scheme. The saved test-case reports identify the exact cases and parameters.
- Screenshot gallery: `bash scripts/ios-gallery.sh <run> --scene map-detail --variant wide,small-large-text`.

Selected screenshots are stored here alongside their result metadata. [The manifest](manifest.json) records their hashes and the source hashes from the original working-tree verification, based on HEAD `734c23c4a7c427d61924a0725d4bb23cce1970bf`, plus the subsequent PR/rebase provenance. A HEAD value in a capture runner's metadata identifies its underlying commit; the recorded source hashes identify the implementation tested at that time.

| Presentation | Screenshots |
| --- | --- |
| Web Map selection menu | [Wide](web-map-actions--wide.png), [landscape](web-map-actions--landscape.png), [phone](web-map-actions--phone.png) |
| Web List detail | [Wide panel](web-list-detail--wide.png), [phone push](web-list-detail--phone.png) |
| Web Stats | [Landscape Records](web-stats-records--landscape.png), [phone Training volume](web-stats-volume--phone.png) |
| Native Map detail | [Wide panel](native-map-detail--wide.jpg), [small phone with accessibility text](native-map-detail--small-large-text.jpg) |

Hands-on iPhone/iPad checks of interactive dismissal, animation and VoiceOver remain the final acceptance step. Browser/simulator evidence does not claim those checks are complete.
