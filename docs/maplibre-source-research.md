# MapLibre source choices and web migration plan

Research for [#561](https://github.com/wirhabenzeit/activitymap/issues/561), preparing [#562](https://github.com/wirhabenzeit/activitymap/issues/562). Reviewed 15 November 2026. The web now renders these choices with MapLibre (see [shared/map-styles](../shared/map-styles/README.md#web-use)); the shared catalogue and iOS still use Mapbox.

Use OpenFreeMap for general vector maps, MapTiler for outdoor cartography and global satellite imagery, and Mapterhorn for web terrain. Keep the existing Swiss and Norwegian sources. Defer self-hosting on R2: it is inexpensive, but introduces operations without replacing either satellite imagery or outdoor contours. Native terrain needs a separate compatibility decision before replacing its Mapbox DEM.

## Catalogue replacements

Keep the existing IDs initially, change their labels and URLs, and regenerate Swift with `pnpm map-catalog:generate`. IDs are persisted by `src/store/index.ts`, accepted in shared map URLs as `mbase` by `src/lib/map-share.ts`, and used for native icons by `BaseStyle.swift`. Renaming them requires aliases/migration on both clients.

| Existing ID | Proposed replacement | Cost category |
| --- | --- | --- |
| `mapboxStreet` | OpenFreeMap Liberty, `https://tiles.openfreemap.org/styles/liberty`; keep as default | Free public service |
| `mapboxLight` | OpenFreeMap Positron, `https://tiles.openfreemap.org/styles/positron` | Free public service |
| `mapboxDark` | OpenFreeMap Dark, `https://tiles.openfreemap.org/styles/dark` | Free public service |
| `mapboxOutdoors` | MapTiler Outdoor style over HTTPS, including its contour source and hillshade | Shared MapTiler request allowance |
| `mapboxSatellite` | MapTiler Satellite over HTTPS, provisional pending production imagery quality checks; retain swisstopo imagery as a separate Swiss choice | Shared MapTiler request allowance |
| `mapboxStreet3d` | Replace the Studio design with Liberty plus a standard `fill-extrusion` building layer where building heights exist; use the app's existing terrain switch independently | Free public service |
| `mapboxTopolight` | Positron with grayscale cartography and Mapterhorn hillshade, matching the inspected current Studio style | Free public services |
| Web terrain | Mapterhorn HTTPS XYZ DEM, independently of selected basemap | Public service; native compatibility gate below |
| Native terrain | Retain current Mapbox DEM until a real third-party DEM rendering test passes | Existing native SDK billing remains |

The custom styles should be **replaced**, rather than copied from Studio: their source schemas and sprite names cannot simply be pointed at new tiles. The 3D replacement must use the chosen tileset's actual building height fields. If it adds no useful distinction from Street plus the 3D control, consolidate it later with an ID alias. Direct inspection found that current Topolight is grayscale mapping plus hillshade, without contour layers. Its prototype uses OpenFreeMap and Mapterhorn; see the [seven versioned style prototypes](../shared/map-styles/README.md).

[OpenFreeMap's quick start](https://openfreemap.org/quick_start/) supplies the public styles. [MapTiler's Maps API](https://docs.maptiler.com/cloud/api/maps/) returns style JSON, sprites and TileJSON. Choose and pin the actual Outdoor and Satellite style versions during implementation, with separate restricted web/native public keys resolved by each client. Do not commit an account key to the shared catalogue or assume a placeholder is a loadable URL: the generator currently emits URL strings unchanged.

The seven non-Mapbox basemaps and five raster overlays in `shared/map-catalog.json` retain their endpoints. The Friflyt GeoJSON overlay also retains its data, but its renderer imports and picking control must migrate. The swisstopo Basemap sprite array needs a rendered check with the selected MapLibre version and the existing native SDK.

## Outdoor maps and elevation are separate requirements

Use MapTiler Outdoor as the initial global outdoor replacement. Its [contour tileset](https://docs.maptiler.com/schema/contours/) provides heights, index lines and glacier classification. Keep contour labels and hillshade in Outdoor. Topolight is a separate grayscale hillshade view. A general Protomaps/OpenFreeMap basemap plus 3D terrain is not an equivalent outdoor map: it does not supply contour geometry or labels. Client-generated contours would introduce another implementation and a native equivalent; defer that work.

[Mapterhorn](https://mapterhorn.com/) advertises global 30 m inputs with finer regional coverage, including Switzerland and Norway. Its [source manifest](https://download.mapterhorn.com/attribution.json) identifies swissALTI3D at 0.5 m and Kartverket at 1 m. These are **input resolutions**, not a promise that every served zoom preserves that spacing. Verify the delivered TileJSON maxzoom, terrain seams, peaks and slopes around Interlaken, across Alpine borders, Tromsø/Lyngen and Svalbard before accepting terrain quality.

[Mapterhorn data access](https://mapterhorn.com/data-access/) documents:

- TileJSON: `https://tiles.mapterhorn.com/tilejson.json`
- Tiles: `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`
- Terrarium encoding and 512 pixel images.

Configure web `raster-dem` with `encoding: 'terrarium'`, `tileSize: 512` and the verified provider zoom range. Do not carry over Mapbox's maxzoom 14 blindly. Preserve the app's terrain exaggeration of 1.5 and reinstall terrain/sky after style changes.

**Native gate:** `MapTerrain.swift` currently fixes tileSize 514, maxzoom 14, and leaves encoding at its default. [Mapbox's current iOS guide](https://docs.mapbox.com/ios/maps/guides/styles/work-with-layers/#raster-dem) explicitly names its own terrain tileset as the only supported DEM source. Its [public generated API](https://raw.githubusercontent.com/mapbox/mapbox-maps-ios/main/Sources/MapboxMaps/Style/Generated/Sources/RasterDemSource.swift) nevertheless exposes HTTPS tiles and encoding. This discrepancy means third-party Terrarium WebP terrain cannot be certified from style-spec compatibility alone. Test the project's pinned SDK 11.31.0 with known elevation samples, negative elevations, tile boundaries and both terrain/hillshade. If decoding fails, evaluate lossless PNG delivery or terrain-rgb conversion and retest; changing encoding metadata alone cannot convert pixels. Keeping native Mapbox terrain temporarily does not block the web switch.

Elevation alternatives:

| Source | Suitability |
| --- | --- |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Public global bare-earth data, no AWS account required, updates driven by community feedback. [Terrarium PNG](https://github.com/tilezen/joerd/blob/master/docs/formats.md) can serve as a web fallback at `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, tileSize 256. Do not assume Alpine/Norwegian fine-resolution coverage; inspect provenance and samples. Native support still needs testing. |
| MapTiler terrain-rgb | Hosted commercial alternative, uses the Mapbox RGB encoding rather than Terrarium. Adds billable tile traffic. Verify current TileJSON, resolution and native decoding before choosing it as fallback. |
| Self-hosted DEM on R2 | Provides control over encoding and availability, but requires extraction, storage, serving, attribution and updates. Model its archive size separately from vector tiles; the small vector storage estimate below does not cover a terrain planet. |

## Provider comparison

**OpenFreeMap:** no key, commercial use allowed, no advertised view/request limit, weekly planet downloads and unmodified OpenMapTiles schema. Its public instance is donation-funded and explicitly has no SLA. Use it with source error reporting and a selectable fallback such as the existing regional maps; do not describe it as guaranteed infrastructure. Native offline downloads have separate limits: 3,000 tiles or 50 MB per download, at most four parallel requests and an identifying User-Agent. [Service and limits](https://openfreemap.org/).

**MapTiler:** strongest fit here for outdoor plus satellite in one account. Use its standard style-spec JSON with both renderers rather than adopting another web SDK. Free is limited to testing/personal/noncommercial use. Flex is $30/month with 500,000 API requests; overage is $0.15/1,000. Third-party renderers are billed by requests, not the SDK session allowance. Raster 512 px tiles count as four request units; 256 px and vector tiles count as one. Terrain and contour sources add traffic. [Pricing and counting rules](https://www.maptiler.com/cloud/pricing/).

**Stadia:** hosted alternative with $20 Starter and $80 Standard; satellite requires Standard. Free is noncommercial. Standard includes 7.5 million credits and additional credits cost $0.02/1,000. Satellite imagery consumes four credits per tile. This has a higher minimum satellite spend than the proposed MapTiler account at this scale; it remains a fallback if imagery quality is better in the target regions. [Plans](https://stadiamaps.com/pricing/), [satellite tiles and resolution](https://stadiamaps.com/learn/satellite-imagery-resolution/).

**Esri World Imagery:** use an authenticated, licensed ArcGIS basemap service, not an anonymous public tile URL as an assumed free entitlement. Its [basemap service](https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/introduction-basemap-styles-service/) supports third-party style consumers and requires an access token plus Esri/data-provider attribution. Its [MapLibre integration](https://developers.arcgis.com/maplibre-gl-js/maplibre-arcgis-plugin/) handles that attribution. Extra integration and account-specific pricing make it a secondary candidate; no unsupported cost estimate is included here.

**EOX Sentinel-2 cloudless:** useful broad-area imagery, but not a like-for-like high-detail aerial replacement. [Current licensing](https://cloudless.eox.at/documentation/license) allows free noncommercial use and requires a commercial licence for commercial use. Do not infer that free Copernicus inputs make the hosted mosaic unrestricted. Exclude it from the initial global satellite choice.

## Costs at about 200 MAU and ten times that usage

The user reports approximately **200 monthly active users** in Mapbox. If this is the mobile SDK metric, it counts monthly SDK users by application/device; it does not measure web map loads or tile requests. Repeated use does not create another MAU on that installation. Web GL JS loads are a separate metric. [Mapbox metric definitions](https://docs.mapbox.com/help/glossary/monthly-active-users/), [web pricing units](https://docs.mapbox.com/accounts/guides/pricing/sections/web-maps/).

No actual map-load count, tile count or bill is available. The following are planning scenarios using 200 and 2,000 active users across the modeled workload, not a measured forecast of combined web and native traffic. Add web visitors if the reported MAU number covers only iOS.

Assumptions: 20 map opens/user/month, 40 billable MapTiler request units/open when using paid maps, and 40% of opens on Outdoor/Satellite combined. Thus `Q = users × opens × requestUnits × paidShare`: 64,000 units/month at 200 users, 640,000 at 2,000. These inputs include paid contours/hillshade/imagery source requests, rather than just initial map draws. Replace them with measured traffic; long panning sessions and 512 px raster imagery can increase them materially.

| Scenario | 200 users | 2,000 users |
| --- | ---: | ---: |
| OpenFreeMap general styles and Street 3D | $0 | $0 |
| Public Mapterhorn web terrain | $0 service fee modeled | $0 service fee modeled |
| MapTiler paid map pool, 40% usage | $30 | $51 |
| MapTiler stress case, all opens paid, 80 units/open | $30 | $435 |
| R2 vector hosting alternative only, assumptions below | about $6.67 | about $6.67 |

MapTiler formula: `$30 + max(0, Q − 500,000) × $0.15 / 1,000`. Outdoors and Satellite **share** this allowance and subscription; do not charge $30 to each row. Free rows have no incremental provider charge at either scale. Public service cost assumptions exclude sponsorship and do not imply an SLA. Paid-source pool cost at 10× is `$30 + 140,000 × 0.00015 = $51`. Existing native Mapbox SDK charges and unchanged regional provider costs are excluded; replacing web data does not eliminate native MAU billing.

At the base scenario's equal split of paid units between outdoor-family maps and satellite, allocate the paid pool equally for budgeting: $15/$15 at 200 users and $25.50/$25.50 at 2,000. Topolight has no MapTiler source fee in the revised prototype; these allocations are not separate invoices.

Before buying a plan, collect one representative week of map opens, provider request units by source (including raster multipliers, contours and terrain), style switches and cache misses on both clients. Confirm the Mapbox dashboard product label for the 200 MAU figure. Avoid sending activity coordinates in usage telemetry.

## Why defer R2 and what choosing it would require

[Protomaps downloads](https://docs.protomaps.com/basemaps/downloads) provide daily builds of an approximately 120 GB planet covering zooms 0–15. [Basemap flavours](https://docs.protomaps.com/basemaps/flavors) cover light/dark general maps and white/grayscale/black data views. They can replace Street/Light/Dark, but have a different tile schema from OpenMapTiles, so moving between them also changes styles. They do not replace satellite or a complete contour map.

For both clients, use the [official Cloudflare PMTiles Worker](https://docs.protomaps.com/deploy/cloudflare) to expose HTTPS TileJSON and XYZ tiles backed by R2. The browser's `pmtiles://` protocol plugin alone does not give the native Mapbox SDK access. A custom domain is required for the documented Worker caching setup. Host versioned style JSON, licensed glyph PBFs and sprite PNG/JSON at 1× and 2×; use absolute HTTPS asset URLs and CORS. Never treat the PMTiles archive as a complete style package.

Vector hosting estimate: 120 GB planet plus 1 GB assets; 10 GB free storage available; `$0.015/GB-month`; $5 Workers Paid minimum; 10 million included Worker requests and 30 million CPU ms; 10 million free R2 Class B reads. [R2 prices](https://developers.cloudflare.com/r2/pricing/), [Worker prices](https://developers.cloudflare.com/workers/platform/pricing/).

At 200 × 20 × 40 = 160,000 tile requests/month, or 1.6 million at 10×, assuming 5 ms CPU per request, 90% cache hits and two R2 reads per cache miss, requests/CPU/reads fit the allowances. Storage is `(121 − 10) × $0.015 = $1.665`, plus $5 = **about $6.67/month**. With no free storage remaining it is about $6.82. Two complete retained releases plus assets bring storage to 241 GB, or about $8.47 total with the free allowance. Egress from R2 is free; other connected services can still charge. Actual range reads, decompression CPU, account-wide allowances and multipart upload operations need measurement.

If adopted, start with weekly copies of a published daily build, pinned archive/style/font/sprite versions and a previous release for rollback. Do not rebuild the planet on an app deploy. Monitor tile errors, cache rate, request/CPU budgets and source freshness. Account for download/upload time and operator time, not just storage. A regional extract lowers storage but cannot be the only global source.

R2 is **not selected for the initial migration**, so no infrastructure has been provisioned and no R2 proof of concept is claimed. If selected later, the acceptance experiment is an Interlaken PMTiles extract served through the official Worker, a complete local style/glyph/sprite bundle, cold/warm cache and CORS checks, and rendered web plus native proof through the same HTTPS URLs.

## Attribution to carry into implementation

| New source | Visible credit and linked detail |
| --- | --- |
| OpenFreeMap | `OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors`, linking to [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles](https://openmaptiles.org/) and [OSM copyright](https://www.openstreetmap.org/copyright). Preserve attribution from source metadata. |
| MapTiler Outdoor | `© MapTiler · © OpenStreetMap contributors`, linking to [MapTiler copyright](https://www.maptiler.com/copyright/) and OSM copyright. |
| MapTiler Satellite | Preserve the imagery source's returned attribution and link to [MapTiler copyright](https://www.maptiler.com/copyright/), including the underlying imagery suppliers; retain OSM credit if labels use OSM. |
| Mapterhorn | `Terrain: Mapterhorn · © swisstopo · © Kartverket` for the principal CH/NO inputs, with an accessible linked [full global source/licence list](https://mapterhorn.com/attribution/). Include other regional producers when their terrain is used; this short CH/NO credit is not a complete global attribution manifest. |
| Protomaps if later adopted | `© OpenStreetMap contributors` with OSM copyright link; preserve any additional selected dataset and font/sprite licence notices. The download is distributed as an ODbL Produced Work. |
| AWS terrain if used as fallback | `Terrain: Mapzen / AWS Terrain Tiles` plus the applicable underlying dataset credits from [the attribution manifest](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). |

[MapTiler attribution rules](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/) require text credits, and its logo on Free accounts. Use the existing map attribution surface, checking that sheets do not obscure required credits. Native Mapbox SDK attribution remains while that SDK is used. Copy exact provider TileJSON credits and review all font/sprite licences before shipping; source labels alone do not certify licence compliance.

## Concrete work for issue 562

1. Replace `mapbox-gl` with a pinned compatible `maplibre-gl`, import React components/types from `react-map-gl/maplibre`, and update the lockfile. Remove legacy `@types/react-map-gl` if unused; the v8 wrapper ships types. Keep `@mapbox/polyline` and `@mapbox/geosimplify-js`.
2. Port renderer types and controls in `src/components/map/*`, `src/components/share/shared-activity-map.tsx`, `src/lib/map-share.ts`, `src/lib/gallery-fixture.ts`, `src/settings/map.tsx` and `src/store/map.ts`. Treat expression/filter/event types as a typecheck task, not a namespace replacement guarantee.
3. Replace the sky layer with MapLibre's [root sky configuration](https://maplibre.org/maplibre-style-spec/sky/), configure the DEM explicitly, and reapply both after base-style changes (`styleDiffing={false}`). [The MapLibre React wrapper](https://visgl.github.io/react-map-gl/docs/api-reference/maplibre/map) supports a projection prop, but check globe against the chosen version, terrain and route fitting; the APIs are not identical just because both wrappers expose `Map`.
4. Remove unsupported Mapbox paint settings: `line-emissive-strength` and place `icon-occlusion-opacity`/`text-occlusion-opacity`. Test pins, labels, routes and picking behind mountains; deleting these properties does not establish visual parity.
5. Change the CSS import and `.mapboxgl-*` popup selectors in `src/styles/globals.css`; change the literal control classes in `overlay.tsx` to `.maplibregl-*`. Check selection, marker placement and popup anchors.
6. Replace the seven catalogue entries as above, remove `webStyleURL`'s Mapbox `optimize=true` handling, and regenerate Swift. Cover the separate recipient map, which hardcodes `baseMaps.mapboxStreet.url`. Add client key resolution before using protected style URLs.
7. Remove the web token prop and `NEXT_PUBLIC_MAPBOX_TOKEN` from `src/env.js`, `.env.example`, local-development docs, quality fixtures and deployment configuration. Retain native tokens and native SDK setup.
8. Update `scripts/quality/browser-harness.mjs` and its env fixture tests, plus the renderer-specific verification fixtures: map photos, photo viewer, place debug, activity places, elevation scrubbing, navigation captures and selection prototype. Audit sharing selection and web gallery references for actual renderer assumptions rather than deleting standalone polyline usage. Replace `.mapboxgl-map` waits/selectors, wrapper imports and token props.
9. Validate each base map and overlay, globe/terrain/sky, repeated style switches, route picking and box selection, photos, places, elevation scrubbing, sharing, resize and retained camera/state. Test desktop and mobile layouts. Render every shared style on native before catalogue rollout. Compare production client bundle output before/after under the same build settings; then run `pnpm check`, relevant browser journeys and screenshot review.

## Evidence and remaining gates

This research inspected the repository catalogue, web renderer, shared recipient map, state/share IDs, CSS, verification scripts, native base-style selection and terrain configuration. Provider pricing and constraints above are linked to primary sources. Direct HTTP probes from this workspace to the candidate tile hosts returned 403; some endpoints were also inaccessible through the research fetcher. Those results do not establish a provider outage, working CORS, asset completeness or native compatibility.

The subsequent [visual comparison](maplibre-comparison/README.md) contains six matched live web renders: Street, Light, Dark, Outdoor, Satellite and terrain. Browser access succeeded for these sources despite the earlier direct-probe failures. The MapTiler public Satellite demo was visibly softer around Interlaken, so the satellite choice remains provisional until production imagery is checked. Mapterhorn decoded and rendered on web; its returned TileJSON specified Terrarium/512 pixel tiles but omitted minzoom/maxzoom.

No simulator rendering, production MapTiler account validation, bundle comparison or app runtime tests have been performed. This checkout has no `node_modules`; no runtime code or generated catalogue was changed. The remaining gates for finalising #561 are measured usage/product identification, production Outdoor/Satellite style selection and imagery quality, appropriate DEM zoom limits/credits, and app/native compatibility. The R2 proof of concept is conditional on selecting R2. Keep both issues open until their respective acceptance checks pass.
