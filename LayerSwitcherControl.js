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
`

export class LayerSwitcherControl {
    onStyleChange = () => {
        return;
    }
    
    constructor(maps) {
        const styleSheet = document.createElement("style")
        styleSheet.innerText = styles
        document.head.appendChild(styleSheet)

        this.backgroundMaps = {};
        this.overlayMaps = {};
        this.currentMap; 
        this._map;
        this.currentOverlayMaps = [];
        const url = new URL(window.location);
        this.threeDim = url.searchParams.has("3D") ? url.searchParams.get("3D") === "true" : false;
        
        if (url.searchParams.has("maps")) {
            const mapNames = url.searchParams.get("maps").split(",");
            Object.entries(maps).forEach(([key, value]) => {
                value.visible = mapNames.includes(key);
            });
        }
        
        Object.entries(maps).forEach(([key, value]) => {
            value.name = key;
            if (value.overlay) {
                this.overlayMaps[key] = value;
                if (value.visible) this.currentOverlayMaps.push(key);
            } else {
                this.backgroundMaps[key] = value;
                if (value.visible) {
                    this.currentMap = key;
                }
            }
        });
    }
    
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        this._container.id = "layer-switcher";
        
        const button = document.createElement('button');
        button.id = "layer-switcher-button";
        button.innerHTML = '<i class="fa-solid fa-layer-group" title="Open layer selection"></i>';
        
        const button3d = document.createElement('button');
        button3d.innerHTML = "3D";
        if (this.threeDim) {
            button3d.classList.add('layer-switcher-3d-active');
        }
        button3d.onclick = () => {
            button3d.classList.toggle('layer-switcher-3d-active');
            this.toggleTerrain();
        };
        
        
        const content = document.createElement('div');
        content.id = 'layer-switcher-content';
        content.appendChild(this.layerTable(this.backgroundMaps,false));
        content.appendChild(this.layerTable(this.overlayMaps,true));
        
        this.setMap(this.backgroundMaps[this.currentMap]);
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
        if (!this._map.getSource('mapbox-dem')) {
            this._map.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 14
            });
        }
        if (!this.threeDim) {
            this._map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.0 });
            this._map.easeTo({pitch:80,duration:1000});
        } 
        else {
            this._map.easeTo({pitch:0,duration:1000});
            this._map.setTerrain();
        }
        this.threeDim = !this.threeDim;
    }
    
    async setMap(mapData) {
        if (mapData.type === "vector") {
            this._map.setStyle(mapData.url);
            this._map.once("style.load", () => {
                this.onStyleChange();
                if (this.threeDim) {
                    this._map.addSource('mapbox-dem', {
                        'type': 'raster-dem',
                        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                        'tileSize': 512,
                        'maxzoom': 14
                    });
                    this._map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.0 });
                }
                this.addOverlayMaps();
            });
        }
        else {
            this._map.setStyle(undefined);
            if (this.threeDim) {
                this._map.addSource('mapbox-dem', {
                    'type': 'raster-dem',
                    'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                    'tileSize': 512,
                    'maxzoom': 14
                });
                this._map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.0 });
            }
            this._map.addSource(mapData.name, {
                type: 'raster',
                tiles: [mapData.url],
                tileSize: 256
            });
            const layerData = {
                id: mapData.name,
                type: 'raster',
                source: mapData.name
            };
            this._map.addLayer(layerData);
            this.onStyleChange();
            this.addOverlayMaps();
        }
        this.currentMap = mapData.name;
    }
    
    async addOverlayMap(mapData) {
        this._map.addSource(mapData.name, {
            type: 'raster',
            tiles: [mapData.url],
            tileSize: 256
        });
        const overlayData = {
            id: mapData.name,
            type: 'raster',
            source: mapData.name,
            paint: {
                'raster-opacity': mapData.opacity
            }
        };
        if (this._map.getLayer("routeLayer")) this._map.addLayer(overlayData,"routeLayer");
        else this._map.addLayer(overlayData);
    }
    
    updateUrl() {
        const url = new URL(window.location);
        url.searchParams.set("maps", this.currentOverlayMaps.concat([this.currentMap]).join(","));
        url.searchParams.set("3D", this.threeDim);
        window.history.replaceState({}, "", url);
    }
    
    async addOverlayMaps() {
        Object.entries(this.overlayMaps).forEach(([key, value]) => {
            if (value.visible) {
                this.addOverlayMap(value);
            }
        });
    }
    
    layerTable(maps, overlay = false) {
        const content = document.createElement('div');
        content.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        Object.entries(maps).forEach(([key, value]) => {
            const mapButton = document.createElement('button');
            mapButton.id = key;
            mapButton.className = 'mapboxgl-ctrl-layer';
            if (value.visible) {
                mapButton.classList.toggle('mapboxgl-ctrl-layer-active');
            }
            mapButton.innerHTML = key;
            mapButton.onclick = () => { 
                if (!overlay && !value.visible) {
                    Object.entries(maps).forEach(([key, value]) => {
                        value.visible = false;
                        document.getElementById(key).classList.remove('mapboxgl-ctrl-layer-active');
                    });
                    value.visible = true;
                    mapButton.classList.toggle('mapboxgl-ctrl-layer-active');
                    this.setMap(value);
                }
                if (overlay) {
                    value.visible = !value.visible;
                    mapButton.classList.toggle('mapboxgl-ctrl-layer-active');
                    if (!value.visible) {
                        this._map.removeLayer(key);
                        this._map.removeSource(key);
                        this.currentOverlayMaps.pop(key);
                    }
                    else {
                        this.addOverlayMap(value);
                        this.currentOverlayMaps.push(key);
                    }
                }
                this.updateUrl();
            };
            content.appendChild(mapButton);
        });
        return content;
    }
}