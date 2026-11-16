# Map style comparison captures

Captured 15 November 2026 UTC for issues [561](https://github.com/wirhabenzeit/activitymap/issues/561) and [562](https://github.com/wirhabenzeit/activitymap/issues/562). These are real provider renders, with equal map container sizes and camera parameters in each pair. No app renderer or production configuration changed.

| Pair                                                         | Camera                                                                              | Full capture                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------- |
| Mapbox Streets v12 / OpenFreeMap Liberty                     | Zürich, 8.5417 / 47.3769, zoom 13                                                   | [Street](streets-zurich.jpg)          |
| Mapbox Light v11 / OpenFreeMap Positron                      | Same Zürich camera                                                                  | [Light](light-zurich.jpg)             |
| Mapbox Dark v11 / OpenFreeMap Dark                           | Same Zürich camera                                                                  | [Dark](dark-zurich.jpg)               |
| Mapbox Outdoors v12 / MapTiler Outdoor v4                    | Interlaken, 7.86 / 46.68, zoom 11                                                   | [Outdoor](outdoor-interlaken.jpg)     |
| Mapbox Satellite v9 / MapTiler Satellite v4                  | Interlaken, zoom 12                                                                 | [Satellite](satellite-interlaken.jpg) |
| Mapbox Outdoors + Mapbox DEM / MapTiler Outdoor + Mapterhorn | Jungfrau region, 7.98 / 46.59, zoom 11.8, pitch 65°, bearing 155°, exaggeration 1.5 | [Terrain](terrain-jungfrau.jpg)       |

2D pairs use pitch/bearing zero; their measured geographic bounds matched. Full screenshots are 2560×1600 from a 1280×800 viewport. Individual map crops retain 1256×1408 pixels and feed the before/after comparison. JPEG copies are compressed from browser screenshots, with no styling or colour alterations.

Renderers: Mapbox GL JS 3.15.0 and MapLibre GL JS 5.6.2, loaded directly in temporary browser tabs. These demonstrate style appearance and are not a validation of the versions in `package.json`, React integration, activity route picking or native compatibility. Both maps reported loaded tiles with no map error events before the final satellite/terrain captures; general map captures were inspected visually. The tabs were closed afterwards.

Mapbox used the app's existing public token. MapTiler used the public demonstration key supplied by its [satellite example](https://docs.maptiler.com/sdk-js/examples/satellite-map/), on the documentation origin; no new account or subscription was created. Credentials are absent from these artifacts. The Satellite v4 style response identified itself as `Satellite Plain` and referenced the `satellite-v2` imagery tileset. The visible softness could reflect that dataset or demo access; it is not proof of all MapTiler production imagery quality. Check production access and regional imagery before finalising this choice.

MapTiler Outdoor loaded sources `contours`, `landform`, `maptiler_planet_v4`, `outdoor` and `terrain-rgb`. The terrain comparison replaced the active terrain with Mapterhorn, but retained MapTiler's hillshade/cartography. Consequently, apparent relief differences cannot be attributed solely to the elevation dataset.

The live Mapterhorn TileJSON returned `encoding: terrarium`, `tileSize: 512`, global Web Mercator bounds, and `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`. It omitted minzoom/maxzoom. This demo confirms web decoding and rendering near zoom 12; it does not resolve the appropriate source maximum zoom or certify elevation accuracy.

The original comparisons above predate the custom style work. The subsequent [seven ActivityMap style prototypes](prototypes/README.md) now include height-based Street 3D and grayscale Topolight with Mapterhorn hillshade. Direct inspection found no contour layers in the current Topolight Studio style.

Credits: © Mapbox; © OpenStreetMap contributors; OpenFreeMap; © OpenMapTiles; © MapTiler and its imagery suppliers; © Mapterhorn and its [underlying elevation providers](https://mapterhorn.com/attribution/). Provider credits are retained in the captures and the comparison footer.

## Dimmed hiking trails

The [trail dimming comparison](outdoor-trails-dimming.jpg) uses the same Interlaken camera and MapTiler Outdoor v4 on both sides. Fourteen hiking trail line, outline and label layers have [paint overrides](outdoor-trail-paint.json): muted colours, 45% of the original line opacity, 70% of the original width, 15% outline opacity, and softer labels/icons. Cycling and via ferrata layers retain their original styling, as do terrain, contours, roads and place labels. This is a rendered style prototype; production configuration remains unchanged.

Both maps reported loaded tiles and zero map error events. Overrides apply by the inspected style's layer IDs and must be reapplied after a style reload; a future style version requires checking those IDs. Keep the same changes in an app-owned style or apply the paint overrides in each client when implementing #562.
