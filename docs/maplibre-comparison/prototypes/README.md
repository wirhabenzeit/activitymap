# ActivityMap style prototype comparisons

These captures compare the actual current Mapbox catalogue styles with the new [ActivityMap definitions](../../../shared/map-styles/README.md). Left: current. Right: prototype. Captured 15 November 2026 UTC. Matching 628×704 CSS-pixel map containers; screenshots at 2× scale, with JPEG copies and map-only crops.

| Style | Camera | Full comparison |
| --- | --- | --- |
| Street | Zürich, 8.5417 / 47.3769, zoom 13 | [Street](mapboxStreet-pair.jpg) |
| Street 3D | Zürich, zoom 15.8, pitch 55°, bearing 25° | [Street 3D](mapboxStreet3d-pair.jpg) |
| Outdoor | Interlaken, 7.86 / 46.68, zoom 11 | [Outdoor](mapboxOutdoors-pair.jpg) |
| Light | Zürich, zoom 13 | [Light](mapboxLight-pair.jpg) |
| Topolight | Interlaken, zoom 11 | [Topolight](mapboxTopolight-pair.jpg) |
| Dark | Zürich, zoom 13 | [Dark](mapboxDark-pair.jpg) |
| Satellite | Interlaken, zoom 12 | [Satellite](mapboxSatellite-pair.jpg) |

Other cameras use pitch/bearing zero. Renderer versions: Mapbox GL JS 3.15.0 and MapLibre GL JS 5.6.2. Public MapTiler documentation demo access was used for candidate Outdoor/Satellite, and the app's existing public Mapbox token for baselines. No credentials are stored in these files. Temporary comparison tabs were closed.

The new definitions rendered with zero map error events; the captures were taken after load/idle readiness checks. Map SDK `loaded()` can fluctuate during label placement/fading; this is not a performance benchmark or a guarantee of pixel-identical labels. The prototype tests and independent style-spec validator also passed. No iOS rendering or production app renderer integration was tested.

The two custom Mapbox styles were inspected directly. Topolight is a monochrome map with DEM hillshade, not a contour map. The new Topolight matches that role using Mapterhorn and OpenFreeMap. Street 3D uses the OpenMapTiles `render_height` and `render_min_height` fields with guarded defaults. Differences in geometry, label density, fonts and feature selection remain visible; these are first-pass replacements rather than exact replicas.

Credits remain in the captures and inline comparison: © Mapbox, © OpenStreetMap contributors, OpenFreeMap, © OpenMapTiles, © MapTiler and imagery suppliers, and © Mapterhorn with its underlying elevation providers. See the source research and provider metadata for full attribution.
