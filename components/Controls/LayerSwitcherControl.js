import { MapContext } from "@/MapContext";
import { mapSettings } from "@/settings";
import { useContext, Component } from "react";

const styles = `
#layer-switcher-content {
    visibility:hidden;
    opacity:0;
    transition: visibility 0s linear 0.5s,opacity 0.5s linear;
}

#layer-switcher-button:hover + #layer-switcher-content, #layer-switcher-content:hover {
    visibility:visible;
    opacity:1;
    transition-delay:0s;
}

.layer-switcher-3d-active {
    color: var(--highlight-color) !important;
}

#layer-switcher-content {
    position: absolute;
    left: 3em;
    top: 0em;
    z-index: 99999;
}

.mapboxgl-ctrl {
    transform: none !important;
  }
  .mapboxgl-ctrl button {
    font-size: large;
  }
  .mapboxgl-ctrl-layer {
    width: 140px !important;
    font-size: small !important;
  }
  .mapboxgl-ctrl-layer-active {
    color: var(--highlight-color) !important;
  }
`;

class LayerSwitcherControl {
  constructor(context) {
    //console.log("LayerSwitcherControl constructor");
    this.context = context;

    this.backgroundMaps = {};
    this.overlayMaps = {};

    Object.entries(mapSettings).forEach(([key, value]) => {
      value.name = key;
      if (value.overlay) {
        this.overlayMaps[key] = value;
      } else {
        this.backgroundMaps[key] = value;
      }
    });
  }

  onAdd(map) {
    //console.log("LayerSwitcherControl onAdd");
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.body.style.setProperty("--highlight-color", "#3298FD");
    document.head.appendChild(styleSheet);

    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    this._container.id = "layer-switcher";

    const button = document.createElement("button");
    button.id = "layer-switcher-button";
    button.innerHTML =
      '<i class="fa-solid fa-layer-group" title="Open layer selection"></i>';

    const button3d = document.createElement("button");
    button3d.innerHTML = "3D";
    if (this.context.position.threeDim) {
      button3d.classList.add("layer-switcher-3d-active");
    }
    button3d.onclick = () => {
      button3d.classList.toggle("layer-switcher-3d-active");
      this.toggleTerrain();
    };

    const content = document.createElement("div");
    content.id = "layer-switcher-content";
    content.appendChild(this.layerTable(this.backgroundMaps, false));
    content.appendChild(this.layerTable(this.overlayMaps, true));

    this._container.appendChild(button);
    this._container.appendChild(content);
    this._container.appendChild(button3d);

    return this._container;
  }

  onRemove() {
    this._container.parentNode.removeChild(this._container);
    this._map = undefined;
  }

  toggleTerrain = () => {
    if (!this._map.getSource("mapbox-dem")) {
      this._map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      this._map.setTerrain({ source: "mapbox-dem", exaggeration: 1.0 });
      this._map.easeTo({ pitch: 80, duration: 1000 });
    } else {
      this._map.easeTo({ pitch: 0, duration: 1000 });
      this._map.setTerrain();
      this._map.removeSource("mapbox-dem");
    }
  };

  layerTable = (maps, overlay = false) => {
    const content = document.createElement("div");
    content.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    Object.entries(maps).forEach(([key, value]) => {
      const mapButton = document.createElement("button");
      mapButton.id = key;
      mapButton.className = "mapboxgl-ctrl-layer";
      if (
        (overlay && this.context.overlayMaps.includes(key)) ||
        (!overlay && key === this.context.baseMap)
      ) {
        mapButton.classList.toggle("mapboxgl-ctrl-layer-active");
      }
      mapButton.innerHTML = key;
      mapButton.onclick = () => {
        if (overlay) {
          this.context.toggleOverlayMap(key);
        } else {
          Object.entries(this.backgroundMaps).forEach(([key, value]) => {
            document
              .getElementById(key)
              .classList.remove("mapboxgl-ctrl-layer-active");
          });
          this.context.setBaseMap(key);
        }
        mapButton.classList.toggle("mapboxgl-ctrl-layer-active");
      };
      content.appendChild(mapButton);
    });
    return content;
  };
}

export { LayerSwitcherControl };
