# Shared client configuration

`map-catalog.json` contains only declarative map sources that both web and native clients can render: stable IDs, labels, URLs, attribution, tile sizes, visibility defaults, and opacity.

Platform implementations compose this catalogue with native additions. For example, the web client adds the React-based Friflyt GeoJSON layer, while iOS adds Mapbox Standard. Component types, bundled asset paths, SDK layer code, icons, and gestures do not belong in the shared file.

After changing the catalogue, run `pnpm map-catalog:generate`. CI runs `pnpm map-catalog:check` to validate the data and ensure the committed Swift representation is current.

`stats-tiles.json` lists the stats tiles, their bento spans, time windows and the one toggle each detail view offers. `stats-rules.md` pins how each tile's numbers are computed, and `stats-fixtures/` holds activities with the numbers both clients must produce from them. Rendering, charts and interaction stay native. After changing the tiles, run `pnpm stats-tiles:generate`; CI runs `pnpm stats-tiles:check`.
