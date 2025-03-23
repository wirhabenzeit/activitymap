import type { IControl } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'mapbox-gl';

/**
 * Generic layer click control that can be used for any map layer
 * Handles detecting clicks on a specific layer and calling a provided callback
 */
class LayerClickControl implements IControl {
  private map?: mapboxgl.Map;
  private _container: HTMLElement;
  private layerId: string;
  private onClick: (event: MapMouseEvent) => void;

  constructor(layerId: string, onClick: (event: MapMouseEvent) => void) {
    this._container = document.createElement('div');
    this._container.style.display = 'none'; // Control doesn't need a UI element
    this.layerId = layerId;
    this.onClick = onClick;
  }

  onAdd(map: mapboxgl.Map) {
    this.map = map;
    map.on('click', this.handleMapClick);
    return this._container;
  }

  onRemove() {
    if (this.map) {
      this.map.off('click', this.handleMapClick);
      console.log(`LayerClickControl for ${this.layerId}: Removed from map`);
    }
    this.map = undefined;
  }

  private handleMapClick = (e: MapMouseEvent) => {
    if (!this.map) {
      console.log(`LayerClickControl for ${this.layerId}: Map not available`);
      return;
    }

    console.log(`LayerClickControl for ${this.layerId}: Click detected at`, e.lngLat);

    // Check if our layer exists in the map style
    const style = this.map.getStyle();
    const layers = style?.layers ?? [];
    const isLayerActive = layers.some((layer) => layer.id === this.layerId);

    console.log(`LayerClickControl for ${this.layerId}: Layer active:`, isLayerActive);
    
    if (!isLayerActive) {
      console.log(`LayerClickControl for ${this.layerId}: Layer not found in map style`);
      return;
    }

    // Check if the layer is visible
    const visibility = this.map.getLayoutProperty(this.layerId, 'visibility');
    const isVisible = visibility === undefined || visibility === 'visible';
    
    console.log(`LayerClickControl for ${this.layerId}: Layer visibility:`, isVisible);

    if (isVisible) {
      console.log(`LayerClickControl for ${this.layerId}: Calling click handler`);
      // Call the provided onClick handler
      this.onClick(e);
    }
  };
}

export default LayerClickControl;
