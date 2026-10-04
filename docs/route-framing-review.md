# Route framing — #275

Verified on 2026-10-04 against base `30623d3e`, using the committed 20-activity fixture, Chrome, iOS 27.0 simulators and live Mapbox tiles. Capture metadata, complete matrix results and image hashes are in [captures.json](route-framing/captures.json). Its commit fields identify the base HEAD; after captures include this PR's working changes.

## Production defect and fix

The web List's **Show on map** centered the activity's bounding box at zoom 12 with zero padding. Reproducing through that button clipped Lunch Ride or placed it behind the details panel. It now queues an explicit fit, waits for the destination map and measured panel layout, fits the rendered route geometry, and persists the camera after it is applied. The map also offers **Fit route / Fit selected routes**.

The fit uses the larger usable rectangle above or beside the panel, caps point-route zoom at 16, and uses the shortest longitude arc for date-line routes. Activities without GPS stay in List with an explanation. A user gesture cancels pending navigation. Expanding or resizing a panel after the completed fit does not move the camera; another explicit fit collapses expanded results and fits again.

| Web detail viewport | Visible route points before | After | Before | After |
| --- | ---: | ---: | --- | --- |
| Phone, 402 × 874 | 225 / 324 | 324 / 324 | [Capture](route-framing/before-web-detail--phone.png) | [Capture](route-framing/after-web-detail--phone.jpg) |
| Small, 375 × 667, 150% browser text | 150 / 324 | 324 / 324 | [Capture](route-framing/before-web-detail--small-large-text.png) | [Capture](route-framing/after-web-detail--small-large-text.jpg) |
| Tablet, 820 × 1180 | 324 / 324 | 324 / 324 | Metrics in captures below | Metrics in captures below |
| Wide, 1180 × 820 | 208 / 324 | 324 / 324 | Metrics in captures below | Metrics in captures below |

Before/after use the same fixture, viewport and List action. The new fit button adds to the measured panel height. The wide four-route result is [shown here](route-framing/web-map-results--wide.jpg).

## Harness defects and native findings

The old web gallery bypassed production with a raw SDK fit and guessed bottom padding. It now clicks the production List action or fit button, waits for camera/panel stability, and checks route containment and useful zoom before capturing.

The native gallery previously accepted request consumption plus any viewport state, ignored its idle timeout, and relied on fixed sleeps. It now invokes production `showOnMap` / `fitSelection` intents, requires a successful request and matching idle camera, checks projected route containment, reveals the panel, and verifies the settled panel does not cover routes or change the camera. Failures include camera/layout diagnostics. The tablet renderer regression now reserves the trailing panel footprint.

All eight native detail/results captures pass across phone, small with accessibility text, tablet and wide variants. No native production camera change was justified. Examples: [phone detail](route-framing/native-map-detail--phone.jpg), [wide detail](route-framing/native-map-detail--wide.jpg), and [small large-text results](route-framing/native-map-results--small-large-text.jpg).

Standard's projected wide-detail route extended about 3.5 points into the fitter's reserved padding while remaining clear of the panel. The harness allows an 8-point tolerance within that breathing room, retains a 16-point map-edge margin, and separately checks panel clearance. Native bottom sheets use their measured UIKit frame; wide panels use the production layout's frame.

## Validation and remaining acceptance

- 629 web tests passed, including six geometry/padding regression tests; scoped ESLint and full TypeScript checks passed.
- Native `RenderedRoutePickingTests`, `MapContextTests` and `MapResultsTests` passed all 43 tests (86 executions including parameterized cases), covering camera/panel geometry, picking and navigation. Five gallery-runner tests also passed.
- The final live-basemap galleries passed 8/8 web and 8/8 native cases: single/four routes × phone, small large text, tablet and wide.
- Additional browser checks passed for a point route (zoom 16), a date-line route (short arc), no GPS (List retained with feedback), persisted fitted cameras, and unchanged camera after results expansion.

Native evidence invokes production intents in the screenshot harness; it does not certify manually tapping the native controls or dragging the native sheet on a physical device. That real native UI acceptance remains outstanding, so this PR addresses #275 without automatically closing it. Browser text scaling and iOS Dynamic Type are different stress cases, not equivalent accessibility certification. Full expansion may intentionally cover the map; it must not cause unsolicited repeated fits.
