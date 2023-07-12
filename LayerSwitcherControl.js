export class LayerSwitcherControl {
    onStyleChange = () => {
        return;
    }

    constructor(maps) {
        this.backgroundMaps = {};
        this.overlayMaps = {};
        this.currentMap; 
        this._map;
        this.currentRasterMapName;
        this.currentVectorMapName;
        this.currentMapType;
        this.currentOverlayMaps = [];
        this.threeDim = false;

        Object.entries(maps).forEach(([key, value]) => {
            value.name = key;
            if (value.overlay) {
                this.overlayMaps[key] = value;
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
        //this._container.id = 'layer-switcher-container';
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        this._container.id = "layer-switcher";
        
        const button = document.createElement('button');
        button.id = "layer-switcher-button";
        button.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
        
        const button3d = document.createElement('button');
        button3d.innerHTML = "3D";//'<i class="fa-solid fa-mountain-sun"></i>';
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
            if (this.currentMapType === "raster") {
                this._map.removeLayer(this.currentRasterMapName);
                this._map.removeSource(this.currentRasterMapName);
            }
            if (this.currentVectorMapName != mapData.name) {
                this._map.setStyle(mapData.url);
                this._map.once("styledata", () => {
                    this.onStyleChange();
                    if (this.threeDim) {
                        this.threeDim = false;
                        this.toggleTerrain();
                    }
                    this.addOverlayMaps();
                });
                this.previousVectorMap = mapData.name;
                this.currentMapType = "vector";
            }
        }
        else {
            if (this.currentMapType === "raster") {
                this._map.removeLayer(this.currentRasterMapName);
                this._map.removeSource(this.currentRasterMapName);
            }
            const firstOverlay = this.currentOverlayMaps.length > 0 ? this.currentOverlayMaps[0] : "routeLayer";
            this._map.addSource(mapData.name, {
                type: 'raster',
                tiles: [mapData.url],
                tileSize: 256
            });
            this._map.addLayer({
                id: mapData.name,
                type: 'raster',
                source: mapData.name
            },
            firstOverlay);
            this.currentMapType = "raster";
            this.currentRasterMapName = mapData.name;
        }
    }

    async addOverlayMap(mapData) {
        this._map.addSource(mapData.name, {
            type: 'raster',
            tiles: [mapData.url],
            tileSize: 256
        });
        this._map.addLayer({
            id: mapData.name,
            type: 'raster',
            source: mapData.name,
            paint: {
                'raster-opacity': mapData.opacity
            }
        },
        "routeLayer");
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
            };
            content.appendChild(mapButton);
        });
        return content;
    }
}