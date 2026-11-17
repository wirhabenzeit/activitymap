import type { Map } from 'maplibre-gl';

/** Raised buildings follow the same 3D control as camera tilt. */
export const syncBuildingExtrusions = (
  map: Pick<Map, 'getStyle' | 'getLayoutProperty' | 'setLayoutProperty'>,
  enabled: boolean,
): void => {
  const visibility = enabled ? 'visible' : 'none';
  for (const layer of map.getStyle()?.layers ?? []) {
    if (
      layer.type === 'fill-extrusion' &&
      map.getLayoutProperty(layer.id, 'visibility') !== visibility
    ) {
      map.setLayoutProperty(layer.id, 'visibility', visibility);
    }
  }
};
