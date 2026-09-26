# Shared client configuration

`map-catalog.json` contains only declarative map sources that both web and native clients can render: stable IDs, labels, URLs, attribution, tile sizes, visibility defaults, and opacity.

Platform implementations compose this catalogue with native additions. For example, the web client adds the React-based Friflyt GeoJSON layer, while iOS adds Mapbox Standard. Component types, bundled asset paths, SDK layer code, icons, and gestures do not belong in the shared file.

After changing the catalogue, run `pnpm map-catalog:generate`. CI runs `pnpm map-catalog:check` to validate the data and ensure the committed Swift representation is current.

`parity/` holds synthetic, versioned map/list behavior fixtures shared by web and native tests. See [the fixture guide](parity/README.md) and [the behavior contract](../docs/map-list-parity-contract.md). These are portable data and expected outcomes, not shared UI code or complete API DTOs.
