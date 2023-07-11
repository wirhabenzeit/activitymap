import { Point } from 'mapbox-gl';

export class SelectionTableControl {
    constructor(tc) {
        this._map;
        this.selectedFeatureIDs = [];
        this.selectedFeatures = [];
        this.tableColumns = tc;
        this.canvas;
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
        this._container.id = 'selection-table-container';
        
        map.boxZoom.disable();
        
        map.on('click', (e) => {
            this.selectedFeatureIDs.forEach(id => {
                map.setFeatureState({source: 'strava', id: id}, {selected: false});
            });
            this.selectedFeatureIDs = [];
            const bbox = [
                [e.point.x - 5, e.point.y - 5],
                [e.point.x + 5, e.point.y + 5]
            ];
            this.selectedFeatures = map.queryRenderedFeatures(bbox, {layers: ['routeLayer2','routeLayerSelected2']});
            this.selectedFeatures.forEach(feature => {
                this.selectedFeatureIDs.push(feature.properties.id);
                map.setFeatureState({source: 'strava', id: feature.id}, {selected: true});
            });
            this.updateTable(); 
            this.onChange();
        });
        
        this.canvas.addEventListener('mousedown', this.mouseDown, true);
        
        return this._container;
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
                layers: ['routeLayer2','routeLayerSelected2']
            });
            
            if (this.selectedFeatures.length >= 1000) {
                return window.alert('Select a smaller number of features');
            }
            
            this.selectedFeatures.forEach(feature => {
                this.selectedFeatureIDs.push(feature.properties.id);
                this._map.setFeatureState({source: 'strava', id: feature.id}, {selected: true});
            });
            this.updateTable(); 
            this.onChange();
        }
        
        this._map.dragPan.enable();
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    tableRow(feature) {
        const tableRows = Object.entries(this.tableColumns).map(function([id, column]) { 
            if ("sort" in column) {
                return `<td data-sort='${column.sort(feature)}'>${column.body(feature)}</td>`;
            }
            else {
                return `<td>${column.body(feature)}</td>`;
            }
        });
        return `<tr id=${feature.id} class="${feature.properties['type']}">`+ tableRows.join("") + "</tr>";
    }
    
    updateTable() {
        const infoBox = document.getElementById('info');
        
        this.tableRow = this.tableRow.bind(this);
        const tourData = this.selectedFeatures.map(this.tableRow);
        if (tourData.length > 0) { 
            this._container.innerHTML = `<table class="sortable"><thead>
            <tr>${Object.entries(this.tableColumns).map(([id, column]) => { return `<th>${column.title}</th>`; }).join("")}</tr>
            </thead><tbody>`+
            tourData.join('\n') + "</tbody></table>";
        } else {
            this._container.innerHTML = '';
        }
        this.selectedFeatures.forEach((feature) => {
            document.getElementById(feature.id).addEventListener('mouseover', () => {
                this._map.setFeatureState({source: 'strava', id: feature.id}, {hover: true});
            });
            document.getElementById(feature.id).addEventListener('mouseout', () => {
                this._map.setFeatureState({source: 'strava', id: feature.id}, {hover: false});
            });
        });
    }
    
    filter(key="in") {
        return [key, "id", ...this.selectedFeatureIDs];
    }
}

