# Shared client configuration

`map-catalog.json` contains only declarative map sources that both web and native clients can render: stable IDs, labels, URLs, attribution, tile sizes, visibility defaults, and opacity.

Platform implementations compose this catalogue with native additions. For example, the web client adds the React-based Friflyt GeoJSON layer, while iOS adds Mapbox Standard. Component types, bundled asset paths, SDK layer code, icons, and gestures do not belong in the shared file.

After changing the catalogue, run `pnpm map-catalog:generate`. CI runs `pnpm map-catalog:check` to validate the data and ensure the committed Swift representation is current.
