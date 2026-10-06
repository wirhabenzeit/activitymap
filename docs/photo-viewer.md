# Shared photo viewer contract

Implements web [#312](https://github.com/wirhabenzeit/activitymap/issues/312), iOS [#218](https://github.com/wirhabenzeit/activitymap/issues/218), and the web selection/photo fixes in [#198](https://github.com/wirhabenzeit/activitymap/issues/198). Native map markers remain #219. This complements the [map/list contract](map-list-parity-contract.md); it does not add a photo metadata sync path.

## Gallery and opening

Associate photos with canonical activity IDs. Order by creation time ascending (unknown dates last), then unique photo ID in Unicode scalar order. A photo without image URLs or a map location still occupies its gallery position. Empty galleries omit the photo section.

Photos appear as an optional tile within the activity's detailed metric groups, using the same heading, icon and divider styling. On web this tile sits inside **Activity details** and follows the group's responsive one/two-column layout. Native uses the same group styling. Detail thumbnails are larger than table thumbnails, with horizontal scrolling for longer galleries. Omit the tile when no photo records are available.

Activating a thumbnail by tap, click, Enter or Space opens that exact photo, including the first opening and reopening. Track the current photo by identity rather than a retained numeric index. Removing the current photo closes the viewer; other additions/deletions update the count without moving the current identity. Activity deletion and account/deployment changes dismiss and fence pending image results.

Photo inspection leaves activity selection, list expansion, camera, filters and scroll position intact. Closing returns focus to the invoking thumbnail if it still exists. Web map markers keep their explicit activity-selection action; a touch-accessible preview offers a separate **View photos** action opening the tapped marker's photo. Markers consume their own event before map route picking.

## Presentation and navigation

Use a dark fullscreen modal with safe-area-aware controls, an activity title, a visible `n of total` counter and the current caption when nonblank. Wrap long captions in a bounded scrollable region. Fit the entire full image without cropping, preserving portrait, landscape and panoramic proportions. Thumbnail crops are square and stable while loading.

Previous/next do not wrap; disable boundary controls and omit them for a single photo. Web supports Left/Right arrows, horizontal touch swipes, Escape, an explicit Close button, focus containment and background scroll locking. Image taps and swipes never dismiss. iOS uses native paged swiping plus accessible previous/next and Close actions, VoiceOver announcements and Dynamic Type. Controls have at least 44px/44pt targets. Reduced motion disables decorative transitions. Zoom gestures are outside this first implementation.

## Image variants

Resolve URL and dimensions using the **same variant key**, never independent dictionary positions. Only absolute HTTP(S) URLs are eligible. Positive finite width/height metadata determines longest edge; otherwise a positive numeric variant key estimates it. Unknown-size variants sort last, with scalar key order as the deterministic tie-breaker.

Thumbnails choose the smallest known variant with longest edge at least **256px**, otherwise the largest smaller variant, otherwise the first unknown-size URL. Fullscreen chooses the largest known variant at or below **2048px**, otherwise the smallest larger variant, otherwise the first unknown-size URL. Keep intrinsic dimensions when known; unknown dimensions use containment without invented aspect ratios. Load full images only for the visible page (native may instantiate adjacent pages, but they do not request image bytes until selected). No eager full-library downloads.

## Loading, failure and offline

Each thumbnail/full image has independent loading, loaded and unavailable states. Reserve its layout during loading. Missing/invalid URLs show **Photo unavailable** without making a request. A failed image shows **Photo unavailable** and **Reconnect or retry to load this image**, with Retry for eligible URLs. Keep caption/count/navigation available. Never infer an empty library or expired sign-in from image failure. Known metadata alone does not mean image bytes exist offline.

Web uses the browser HTTP image cache and makes no offline guarantee beyond available bytes. Native maintains a private, account/deployment-scoped image-byte cache, bounded to **64 MiB on disk** and **16 MiB in decoded memory**, with a **12 MiB per-file** limit. Eviction uses least-recent access; old sync age alone does not expire photos. Cached bytes reopen offline; uncached failures show the same honest placeholder. Scope transitions purge old bytes and cancel/fence pending results. Every committed metadata snapshot, including rebootstrap, prunes orphan image entries and changed-URL entries. Deletion never displays retained old bytes as a current photo.

## Map eligibility and selection (#198)

A map location is exactly two finite numeric coordinates in latitude `[-90, 90]` and longitude `[-180, 180]`; **zero is valid**. Only photos belonging to existing filter-visible activities get markers. Omit only the marker for invalid/absent locations.

Hidden selections remain selected, but hidden routes, active highlights and result rows disappear. Disclose `N selected · H hidden by filters`, including an all-hidden selection, and retain Clear selection. Fit uses visible selected routes. Filtering never auto-activates a route. Deleted activities leave selection; list inspection remains independent. Select-page operates on the filtered page and preserves selections outside it. Show on map explicitly adds/activates the visible activity and frames usable geometry.

## Verification

Use `shared/parity/photo-viewer.v1.json` through production resolvers on both platforms, and the existing coordinate/selection fixtures. Cover non-first initial/reopened photo, shuffled variants, matching dimensions, missing dates/URLs, empty/single/multiple galleries, portrait/panorama, broken/slow/offline bytes, deletion during a request and scope switching. Browser interaction checks cover keyboard, touch, focus return, nested details and marker actions. Native checks cover disk reopen, cache eviction/pruning and fencing, paging, Dynamic Type, VoiceOver and rotation. Record actual validation and remaining device review below before claiming issue acceptance.

## Validation recorded on 2026-10-06

Baseline: `55528efd`. Tests use synthetic photos; no private image library or live metadata endpoint is involved.

- **Web:** TypeScript and ESLint pass for changed files. The complete TypeScript/server regression run passes **785 tests**. `node scripts/verify-photo-viewer.mjs /tmp/activitymap-photo-evidence` exercises the production viewer and photo layer in Chrome with a local image server, real pointer swipes and a local Mapbox style. It verifies non-first opening/reopening, Enter/Space, arrows/Escape, focus containment/return, scroll locking, single/empty galleries, independent row inspection, current-image-only loading, captions/counts, broken/missing/retry states, current-photo deletion, count reconciliation, account changes, nested detail and origin-marker preview/selection. [Recorded checks](photo-viewer/web-verification.json).
- **Selection:** All existing shared selection-transition and photo-coordinate vectors run through the production web reducer/resolver. A partial streamed library retains not-yet-loaded selections; only a completed library snapshot prunes missing IDs. The active route layer intersects the activity filter; the panel uses visible selections, discloses hidden counts and keeps an all-hidden selection clearable. A sole visible result stays collapsed unless it is explicitly active.
- **iOS:** Xcode 27, iPhone 18 Pro simulator, iOS 27.0: **31 tests / 39 parameterized runs pass**, with zero failures. Suites: `PhotoGalleryTests`, `StoredModelMapperTests`, `SyncControllerTests`. Shared variant/order fixtures, offline disk reopen, uncached offline failure, disk/file bounds, changed-URL and orphan pruning, late deletion/account-response fencing, invalid image bytes and cache-directory failure are covered. Cache I/O failure preserves synced metadata. Render tests check the non-first initial page, caption and unchanged selection at phone, landscape and accessibility text sizes. [Xcode summary](photo-viewer/ios-verification.json).
- **Detail placement:** The optional Photos tile was reviewed in the running List detail, including opening the viewer and returning focus to its thumbnail. The final placement and native group styling pass TypeScript, ESLint and an iOS simulator build.

The previous web lightbox is captured from the baseline source after activating photo 2; it opens on photo 1 and shows no caption/counter. The replacement displays the tapped photo with explicit controls. These isolated production-component captures establish the interaction changes; they do not establish physical-device or live-account release acceptance.

| Capture | Reference |
| --- | --- |
| Previous web lightbox | [Before, desktop](photo-viewer/web-before-desktop.png) |
| New web viewer | [Portrait, phone](photo-viewer/web-portrait-phone.png), [panorama, desktop](photo-viewer/web-panorama-desktop.png), [broken image](photo-viewer/web-broken-image.png) |
| Native viewer | [Phone](photo-viewer/ios-phone.png), [landscape layout](photo-viewer/ios-landscape.png), [large text](photo-viewer/ios-large-text.png), [missing image](photo-viewer/ios-missing.png) |

Remaining release review: actual Safari/iPhone touch and focus behavior; native VoiceOver focus/announcements, real rotation and iPad; live-account long-offline reconciliation; and full map route picking/count screenshots against the composed app. Native map photo markers are still owned by #219. No issues are closed by this validation record.
