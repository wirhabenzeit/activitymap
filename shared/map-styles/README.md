# ActivityMap style prototypes

Seven first-pass styles mirror the roles of the seven Mapbox entries in the production catalogue. Both clients render these templates with MapLibre under the same catalogue IDs. The web loads them on demand; iOS bundles them via `pnpm map-catalog:generate`.

| Existing ID       | Prototype             | Source and intended appearance                                                               |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `mapboxStreet`    | ActivityMap Street    | OpenFreeMap Liberty, cyan water, pale roads, restrained buildings and labels; flat buildings |
| `mapboxStreet3d`  | ActivityMap Street 3D | Same palette with height-based building extrusions from zoom 15                              |
| `mapboxOutdoors`  | ActivityMap Outdoor   | MapTiler Outdoor v4 with the dimmed hiking paths previously previewed                        |
| `mapboxLight`     | ActivityMap Light     | OpenFreeMap Positron with a softer neutral palette and reduced building contrast             |
| `mapboxTopolight` | ActivityMap Topolight | Positron with grayscale cartography and Mapterhorn hillshade                                 |
| `mapboxDark`      | ActivityMap Dark      | OpenFreeMap Dark with a charcoal background, legible light labels and subdued roads/rail     |
| `mapboxSatellite` | ActivityMap Satellite | MapTiler Satellite v4, imagery only, matching the role of satellite-v9                       |

Inspection of the actual custom Studio styles changed the earlier research proposal: Street 3D contains building extrusions; Topolight contains grayscale mapping plus hillshade, without contours. Topolight therefore does not need the paid Outdoor contour source. These are independently tuned adaptations of the replacement providers' base styles, not copies of the Mapbox style JSON.

## Files and regeneration

- `build-styles.mjs` owns palettes, layer changes, required layer checks and URL key resolution.
- `outdoor-trail-paint.json` owns the hiking trail treatment. The earlier docs copy records the initial experiment.
- `upstream/*.json` are frozen provider style snapshots, fetched 15 November 2026 UTC. They make palette changes reproducible without a live API call. Original provider metadata and source attribution remain. These are provider assets, not an assertion of ownership or a new licence for their data, fonts or icons.
- `generated/*.json` are style-spec v8 templates. OpenFreeMap-based Street, Street 3D, Light, Dark and Topolight have public URLs. Outdoor and Satellite contain `{MAPTILER_KEY}` placeholders; they need key resolution before rendering.

Run `pnpm map-styles:generate` after editing the builder or snapshots, and `pnpm map-styles:check` to detect stale output. Both run offline. Run `node --test shared/map-styles/build-styles.test.mjs` for the prototype integrity checks.

Use `resolveStyleKey(template, publicKey)` to create an in-memory style for rendering. It returns a copy and resolves source, glyph and sprite URLs, including all entries in sprite arrays. It throws when a paid-source template lacks a key. No account key is committed. Before handing a style to native, resolve the key with native configuration and either pass the JSON to the SDK or publish a complete HTTPS style resource. The web resolves its own copy (`src/lib/map-style.ts`); native uses the same generated templates from its bundle.

Snapshot origins:

- Liberty: `https://tiles.openfreemap.org/styles/liberty`
- Positron: `https://tiles.openfreemap.org/styles/positron`
- Dark: `https://tiles.openfreemap.org/styles/dark`
- Outdoor: `https://api.maptiler.com/maps/outdoor-v4/style.json`
- Satellite: `https://api.maptiler.com/maps/satellite-v4/style.json`

The MapTiler snapshots were fetched using the public documentation demonstration key, which was removed from stored URLs. All MapTiler resource URLs in generated output carry a placeholder, including sprite URLs that originally omitted one. Updating a snapshot requires reviewing layer IDs and comparing the regenerated styles again; required layers fail loudly if renamed.

## Validation and remaining work

All seven templates passed `@maplibre/maplibre-gl-style-spec` 19.3.3 validation. All seven were rendered in a browser against the current Mapbox style at matching camera parameters, using MapLibre GL JS 5.6.2 and Mapbox GL JS 3.15.0. Street 3D was checked at zoom 15.8/pitch 55°. This is visual prototype validation, not a test of the app's pinned renderer versions or native SDK. [Matched captures](../../docs/maplibre-comparison/prototypes/README.md) record scope and limitations.

Topolight uses 512 pixel Terrarium WebP elevation from Mapterhorn. Its maxzoom 12 is a conservative prototype cap for the demonstrated region, not verified global provider metadata. Native DEM compatibility, correct production zoom limits, sprite-array compatibility and font/icon licences remain migration gates. The app should own 3D terrain/globe/sky settings separately; these styles do not force a projection or enable terrain. Topolight's DEM source is used for hillshade only.

Satellite's source is still provisional: the demonstrated imagery around Interlaken was softer than Mapbox. A different palette cannot repair source resolution. Check the intended production account's imagery before adopting it.

Before rollout, also check route contrast with the real activity palette, selected routes and places, high zoom and low zoom, Norway and Alpine border regions, mobile layouts, attribution, and repeated style changes. Native bundle and catalogue freshness are verified by `pnpm map-catalog:check`.

## Web use

`src/settings/map.tsx` maps the seven Mapbox catalogue IDs to these templates on the web, keeping the IDs persisted in local state and in shared `mbase` URLs. `src/lib/map-style.ts` loads each template as its own chunk and substitutes `NEXT_PUBLIC_MAPTILER_KEY`. Without that key the web hides Outdoors and Satellite, and a stored or shared choice of either falls back to Street. Raster catalogue maps become a one-layer style with OpenFreeMap glyphs, so app labels render on every base map.

App labels request the `ActivityMap Sans` fontstack, which `src/lib/map-glyphs.ts` redirects to OpenFreeMap's Noto Sans whatever glyph server the current style names. 3D terrain uses Mapterhorn (Terrarium, 512 px, maxzoom 12) independently of the base map and is removed rather than flattened in 2D.

## Layer picker

`shared/map-catalog.json` owns the ordered picker groups for both clients: Worldwide, Swisstopo and NorgesKart. All six Swiss choices remain selectable, including Aerial using the current `ch.swisstopo.imagerybasemap.vt` endpoint. Street 3D remains a legacy catalogue ID but resolves to Street in the picker; building extrusions follow the 3D/tilt state and are reapplied after a style reload. The separate iOS Standard choice is omitted from the picker, with old saved choices restored to Street.

Outdoor retains its existing MapTiler DEM/hillshade source. Its exaggeration is 0.7 at zoom 6, 0.75 at zoom 12, 0.6 at zoom 16 and 0.45 at zoom 18, preserving trails and contours while making relief more legible in 2D on both clients.

Worldwide contains Outdoor, Street, Light, Dark, Topo Light and Satellite. NorgesKart remains a direct choice. The compact root menu keeps Photos, Places and the Overlays section directly accessible, without extra spacing between base-map groups. The four Swiss overlay toggles are grouped under Swisstopo, using shared `overlayGroups` metadata. Outdoor uses northwest illumination, brighter highlights and stronger neutral shadows for readable 2D relief; this does not add raised terrain geometry on iOS.
