import FileSaver from 'file-saver';
import mapboxgl from 'mapbox-gl';

export class DownloadControl {
    
    constructor() {
        this._container = undefined;
        this._map = undefined;
        document.style
    }
    
    onAdd = (map) => {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'donwload-button-container';
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        const button = document.createElement('button');
        button.id = "download-button";
        button.innerHTML = '<i class="fa-solid fa-download" title="Download"></i>';
        
        button.onclick = () => {
            button.style.cursor = 'wait';
            var actualPixelRatio = window.devicePixelRatio;
            Object.defineProperty(window, 'devicePixelRatio', {
                get: function() {return 450 / 96;}
            });
            console.log(`Pixel ratio changed from ${actualPixelRatio} to ${window.devicePixelRatio}`);
            var hidden = document.createElement('div');
            hidden.style.width = 0;
            hidden.style.height = 0;
            hidden.style.overflow = 'hidden';
            hidden.style.position = 'fixed';
            hidden.style.zIndex = -1;
            hidden.style.visibility = 'hidden';
            document.body.appendChild(hidden);
            var container = document.createElement('div');
            container.style.width = `${window.innerWidth}px`;
            container.style.height = `${window.innerHeight}px`;
            console.log(`Container size: ${container.style.width} x ${container.style.height}`);
            hidden.appendChild(container);
            
            var renderMap = new mapboxgl.Map({
                container: container,
                center: map.getCenter(),
                zoom: map.getZoom(),
                style: map.getStyle(),
                bearing: map.getBearing(),
                pitch: map.getPitch(),
                interactive: false,
                preserveDrawingBuffer: true,
                fadeDuration: 0,
                attributionControl: false
            });
            renderMap.once('idle', function() {
                renderMap.getCanvas().toBlob(function(blob) {
                    FileSaver.saveAs(blob, 'map.jpg');
                }, "image/jpeg", 0.8);
                
                renderMap.remove();
                hidden.parentNode.removeChild(hidden);
                Object.defineProperty(window, 'devicePixelRatio', {
                    get: function() {return actualPixelRatio}
                });
                button.style.cursor = "pointer";
            });
        };
        
        this._container.appendChild(button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
}