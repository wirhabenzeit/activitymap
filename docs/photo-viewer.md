# Shared photo viewer contract

Implements web [#312](https://github.com/wirhabenzeit/activitymap/issues/312), iOS [#218](https://github.com/wirhabenzeit/activitymap/issues/218), and the web selection/photo fixes in [#198](https://github.com/wirhabenzeit/activitymap/issues/198). Native map markers remain #219. This complements the [map/list contract](map-list-parity-contract.md); it does not add a photo metadata sync path.

## Gallery and opening

Associate photos with canonical activity IDs. Order by creation time ascending (unknown dates last), then unique photo ID in Unicode scalar order. A photo without image URLs or a map location still occupies its gallery position. Empty galleries omit the photo section.

Photos appear as an optional tile within the activity's detailed metric groups, using the same heading, icon and divider styling. On web this tile sits inside **Activity details** and follows the group's responsive one/two-column layout. Native uses the same group styling. Detail thumbnails are larger than table thumbnails, with horizontal scrolling for longer galleries. Omit the tile when no photo records are available.

Activating a thumbnail by tap, click, Enter or Space opens that exact photo, including the first opening and reopening. Track the current photo by identity rather than a retained numeric index. Removing the current photo closes the viewer; other additions/deletions update the count without moving the current identity. Activity deletion and account/deployment changes dismiss and fence pending image results.

Photo inspection leaves activity selection, list expansion, camera, filters and scroll position intact. Closing returns focus to the invoking thumbnail if it still exists. Web map markers keep their explicit activity-selection action; a touch-accessible preview offers a separate **View photos** action opening the tapped marker's photo. Markers consume their own event before map route picking.

## Presentation and navigation

Use a dark fullscreen modal with safe-area-aware controls, an activity title, a visible `n of total` counter and the current caption when nonblank. Native uses a softer near-black background (`#121212`) in both appearance modes; floating controls retain translucent black. Wrap long captions in a bounded scrollable region. Fit the entire full image without cropping, preserving portrait, landscape and panoramic proportions. Thumbnail crops are square and stable while loading.

Previous/next do not wrap; disable boundary controls and omit them for a single photo. Web supports Left/Right arrows, horizontal touch swipes, Escape, an explicit Close button, focus containment and background scroll locking. Web image taps and swipes never dismiss. iOS uses native paged swiping plus accessible previous/next and Close actions, VoiceOver announcements and Dynamic Type. Native controls float over the image instead of reserving viewport space. Apple's `UIScrollView` supplies pinch zoom up to 4× and panning; double-tap zooms to 3× or resets to fit. Zoom resets when leaving a photo or changing viewport size. At fit size, horizontal drags page; while zoomed, they pan the image. The fullscreen presentation uses Apple's interactive zoom transition, matched to the current photo's thumbnail. The system controls interactive dismissal, completion and cancellation; there is no custom dismissal threshold or image-only drag transform. A 16-point dark gap separates pages during movement, while settled photos keep the full viewport width. Controls have at least 44px/44pt targets. Reduced motion disables custom animated page changes and double-tap zoom; the system manages the presentation transition. Web zoom remains outside this implementation.

## Image variants

Resolve URL and dimensions using the **same variant key**, never independent dictionary positions. Only absolute HTTP(S) URLs are eligible. Positive finite width/height metadata determines longest edge; otherwise a positive numeric variant key estimates it. Unknown-size variants sort last, with scalar key order as the deterministic tie-breaker.

Thumbnails choose the smallest known variant with longest edge at least **256px**, otherwise the largest smaller variant, otherwise the first unknown-size URL. Fullscreen chooses the largest known variant at or below **2048px**, otherwise the smallest larger variant, otherwise the first unknown-size URL. Keep intrinsic dimensions when known; unknown dimensions use containment without invented aspect ratios. Web loads full images only for the visible page. Native prepares the current photo and its immediate previous/next neighbors, at most three photos, so the incoming image is available during a swipe. Other pages do not request or retain full images; moving the window cancels obsolete view/prefetch tasks. Existing scoped cache bounds and deletion fences still apply. No eager full-library downloads.

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

## Native paging follow-up — #373, 2026-10-11

Source inspection and a rendered regression reproduced a concrete blank-page problem: the original native viewer replaced every nonselected page with `Color.clear`. Opening photo 3 in a nine-photo gallery requested only photo 3; neither swipe destination was prepared. Selection changes also changed the caption's measured height or removed it, moving the pager viewport.

The viewer keeps stable page views and explicitly warms the adjacent images through the existing scoped cache. Page-style `TabView` starts image tasks as a page appears, so merely giving neighboring pages image views is insufficient to prepare their bytes before a drag. Warming both destinations is bounded and cancellable; unavailable images still use the existing honest failure/retry presentation. Native paging and its gesture thresholds remain in control of movement and settling.

The subsequent floating-controls change places the current caption over the image, capped at 20% of the available height and scrollable when necessary. Short captions use only their required height. Changing the current caption does not move the image viewport. Hidden sizing text is excluded from accessibility.

**Validation:** iPhone 18 Pro simulator, iOS 27.0. The focused `PhotoGalleryTests` run passes **9 tests / 17 parameterized cases**, including first/middle/last preparation without requesting all nine photos, unchanged selection, stable pager geometry when the current caption disappears on phone/landscape/large-text/tablet layouts, actual image and unavailable-state rendering, offline disk reopen, cache bounds, deletion and account-response fences. The preparation regression fails against the original source (`["/3"]` instead of `["/2", "/3", "/4"]`). The rendering checks wait for visible image bytes and tolerate OCR whitespace/letter-zero ambiguity in the counter; they do not accept an empty image area as a loaded photo.

Reproduce with:

```sh
xcodebuild test -project ios/ActivityMap/ActivityMap.xcodeproj \
  -scheme ActivityMap -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -parallel-testing-enabled NO -only-testing:ActivityMapTests/PhotoGalleryTests \
  -collect-test-diagnostics never CODE_SIGNING_ALLOWED=NO
```

**Remaining #373 acceptance:** physical iPhone verification of slow drags, quick swipes, reversals, first/last boundaries and viewer/background gesture isolation, recording device/OS/build and a short video. Simulator preparation/layout tests do not certify swipe feel. After reconnecting the device on 2026-10-11, the Release ActivityMap Dev build with the paging changes was successfully installed and launched on Dominik’s iPhone 18 Pro, iOS 27.0.1 (`page.dominik.activitymap.dev`). The user subsequently reported improved scrolling. Keep #373 and #218's detailed device acceptance open until that review.

## Native floating controls and zoom — 2026-10-11

The activity title, Close, previous/next buttons, caption and counter now overlay the fullscreen pager. The image retains its full fitting area regardless of captions or Dynamic Type. A small SwiftUI wrapper hosts Apple's native `UIScrollView` zoom/pan behavior and keeps the existing bounded image loading, cache and unavailable/retry states. PhotoSlider was evaluated, but its remote-image path starts every gallery download and leaves failures blank, so adopting it would require extra integration work.

**Validation:** focused `PhotoGalleryTests` pass **10 tests / 20 parameterized cases**, zero failures on the iPhone 18 Pro simulator, iOS 27.0. In addition to the paging/cache regressions above, tests verify the full-height pager, native magnification, panning and zoom reset on phone, landscape and tablet layouts. Rendered phone, landscape and large-text layouts were visually reviewed. The optimized ActivityMap Dev build was successfully installed and launched on Dominik’s iPhone. Physical pinch/double-tap behavior and gesture interaction with paging remain to be checked there.

### Dismissal and page spacing follow-up

The initial dismissal implementation moved the image vertically and used a custom distance/velocity threshold to close the cover. The user reported that this felt unnatural, so that gesture and its transform/threshold logic were removed. The gallery now marks each thumbnail with `matchedTransitionSource`; the viewer uses `navigationTransition(.zoom(...))`, targeting the current photo ID. Apple's presentation engine owns the dismissal interaction and return animation. See [Apple's presentation demo](https://developer.apple.com/videos/play/wwdc2024/10145/), which documents support for `fullScreenCover` as well as navigation. Pages retain 8 points of black padding on either side, and the pager expands by 16 points, preserving full viewport width for the settled image while separating adjacent images during movement.

**Validation:** `PhotoGalleryTests` pass **11 tests / 21 parameterized cases**, zero failures. The presentation integration test opens the production viewer from a matched source, confirms that SwiftUI configured UIKit's system transition, dismisses the cover and verifies the dismissal callback and unchanged activity selection. Existing checks cover zoom/pan/reset, bounded image loading and page stride/image width on phone, landscape, accessibility text and tablet layouts. After reconnecting the iPhone, the Release ActivityMap Dev build with the system transition was installed and launched successfully. Actual interactive touch recognition and feel still need physical-device review.

After the user confirmed that the native dismissal felt substantially better, the viewer background was softened from pure black to `#121212`. The four existing rendering scenarios (phone, landscape, large text and missing image) pass, and the updated phone capture was visually reviewed.
