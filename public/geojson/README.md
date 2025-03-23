# GeoJSON Files for Map Overlays

This directory contains GeoJSON files that can be used as map overlays in the application.

## Available Files

- `tracks.geojson` - Ski tracks from Senja, Norway

## How to Use

These files are automatically loaded by the GeoJSONOverlay component when selected from the map overlay options.

## Adding New Files

To add a new GeoJSON file:

1. Place the file in this directory
2. Update the map-components.tsx file to include a new entry in the overlayMaps object
3. Use the GeoJSONOverlay component with the path to your new file

Example:

```tsx
'My Custom Tracks': {
  type: 'raster',
  render: () => <GeoJSONOverlay url="/geojson/my-custom-tracks.geojson" />,
},
```
