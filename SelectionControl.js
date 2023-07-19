import { Point } from 'mapbox-gl';

export class SelectionControl {
    constructor(layers,source,selectionHandler) {
        this._map;
        const url = new URL(window.location);

        this.selectedFeatureIDs = url.searchParams.has("selected") ? url.searchParams.get("selected").split(",").map((id) => parseInt(id))  : [];
        this.selectedFeatures = [];
        this.canvas;
        this.layers = layers;
        this.source = source;
        this.selectionHandler = selectionHandler;
        this.start;
        this.current;
        this.box = null;
    }
    
    onChange() {    
        return;
    }
    
    onAdd(map) {
        this._map = map;
        this.canvas = map.getCanvasContainer();
        this._container = document.createElement('div');
        
        map.boxZoom.disable();
        
        map.on('click', (e) => {
            const bbox = [
                [e.point.x - 5, e.point.y - 5],
                [e.point.x + 5, e.point.y + 5]
            ];
            this.selectedFeatures = map.queryRenderedFeatures(bbox, {layers: this.layers});
            this.postSelection();
        });
        
        this.canvas.addEventListener('mousedown', this.mouseDown, true);
        return this._container;
    }

    postSelection = () => {
        this.selectedFeatureIDs.forEach(id => {
            this._map.setFeatureState({source: this.source, id: id}, {selected: false});
        });
        this.selectedFeatureIDs = [];
        this.selectedFeatures.forEach(feature => {
            if (this.selectedFeatureIDs.includes(feature.properties.id)) {
                this.selectedFeatures.pop(feature);
            }
            else {
                this.selectedFeatureIDs.push(feature.properties.id);
                this._map.setFeatureState({source: this.source, id: feature.id}, {selected: true});
            }
        });
        const url = new URL(window.location);
        url.searchParams.set("selected", this.selectedFeatureIDs.join(","));
        window.history.replaceState({}, '', url);
        this.selectionHandler(this.selectedFeatures); 
        this.onChange();
    }
    
    mousePos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        return new Point(e.clientX - rect.left - this.canvas.clientLeft,e.clientY - rect.top - this.canvas.clientTop);
    }
    
    mouseDown = (e) => {
        if (!(e.shiftKey && e.button === 0)) return;
        
        this._map.dragPan.disable();
        
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('keydown', this.onKeyDown);
        
        this.start = this.mousePos(e);
    }
    
    onMouseMove = (e) => {
        this.current = this.mousePos(e);
        
        if (!this.box) {
            this.box = document.createElement('div');
            this.box.classList.add('boxdraw');
            this.canvas.appendChild(this.box);
        }
        
        const minX = Math.min(this.start.x, this.current.x),
        maxX = Math.max(this.start.x, this.current.x),
        minY = Math.min(this.start.y, this.current.y),
        maxY = Math.max(this.start.y, this.current.y);
        
        // Adjust width and xy position of the box element ongoing
        const pos = `translate(${minX}px, ${minY}px)`;
        this.box.style.transform = pos;
        this.box.style.width = maxX - minX + 'px';
        this.box.style.height = maxY - minY + 'px';
    }
    
    onMouseUp = (e) => {
        this.finish([this.start, this.mousePos(e)]);
    }
    
    onKeyDown= (e) => {
        if (e.keyCode === 27) finish();
    }
    
    finish = (bbox) => {
        // Remove these events now that finish has been called.
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('mouseup', this.onMouseUp);
        
        if (this.box) {
            this.box.parentNode.removeChild(this.box);
            this.box = null;
        }
        
        // If bbox exists. use this value as the argument for `queryRenderedFeatures`
        if (bbox) {
            this.selectedFeatures = this._map.queryRenderedFeatures(bbox, {
                layers: this.layers
            });
            if (this.selectedFeatures.length >= 1000) {
                return window.alert('Select a smaller number of features');
            }
            this.postSelection();
        }
        
        this._map.dragPan.enable();
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    filter() {
        return ["in", "id", ...this.selectedFeatureIDs];
    }
}

