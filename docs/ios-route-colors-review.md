# iOS dark-mode route colors — #286

Verified on 2026-10-04 using an iPhone 18 Pro simulator, iOS 27.0, Mapbox SDK 11.31.0, and the live Mapbox Standard basemap. The base commit is `89f16497`; capture provenance and hashes are in [captures.json](ios-route-colors/captures.json).

## Cause and fix

Standard's night lighting darkens custom line layers when emissive strength is left at its default of zero. Before/after simulator captures reproduce this: both the sport strokes and white selection outlines become nearly black without emission. The fixed sport assets themselves have no appearance variants.

`RouteLayers` now sets `.lineEmissiveStrength(1)` on ordinary, selected and active routes, the selected casing, and the active casing and halo. This follows [Mapbox's custom-layer lighting guidance](https://docs.mapbox.com/ios/maps/guides/styles/style-layers/#light-driven-styling-in-standard-and-standard-satellite). Palette, stroke widths, layer order and filters are unchanged.

## Rendered evidence

The existing screenshot gallery uses production screens and its committed activity fixture. Captures used a public Mapbox token and real remote tiles, rather than the gallery's offline fallback. The before run temporarily omitted only the six emissive modifiers; the fixed source was restored afterward.

| State | Before, night | Fixed, night | Fixed, day |
| --- | --- | --- | --- |
| Ordinary routes | [Before](ios-route-colors/before-map--phone-dark.jpg) | [After](ios-route-colors/after-map--phone-dark.jpg) | [Day](ios-route-colors/after-map--phone.jpg) |
| Four selected routes | [Before](ios-route-colors/before-map-results--phone-dark.jpg) | [After](ios-route-colors/after-map-results--phone-dark.jpg) | [Day](ios-route-colors/after-map-results--phone.jpg) |
| Active route | [Before](ios-route-colors/before-map-detail--phone-dark.jpg) | [After](ios-route-colors/after-map-detail--phone-dark.jpg) | [Day](ios-route-colors/after-map-detail--phone.jpg) |

The fixed night captures show the sport colors and white outlines clearly. The day captures retain the intended palette. The white casing is prominent but still distinguishes selected routes in these simulator captures; no palette or casing adjustment was needed for this fix.

## Validation scope

The app and test target build successfully. The `RenderedRoutePickingTests` suite passed all 31 tests (70 executions including parameterized cases), covering renderer picking/filtering as well as map navigation and presentation. After restoring the fix from the baseline capture, a final rebuild and the `RouteHitTestingTests` / `RoutePickerTests` suites passed another 15 tests (16 executions). The real-basemap gallery passed for ordinary, selected and active scenes in day/night, and the original night rendering was reproduced separately.

These captures do not certify physical-device appearance, switching system appearance while a map stays open, or every custom basemap/raster overlay. The fixture includes all five sport categories; selected and active captures focus on the gallery's ride/run scenarios, rather than every category in every selection state.
