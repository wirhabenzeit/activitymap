import FileSaver from 'file-saver';

export class DownloadControl {

    constructor() {
        this._container = undefined;
        this._map = undefined;
    }

    onAdd = (map) => {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'donwload-button-container';
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        const button = document.createElement('button');
        button.id = "download-button";
        button.innerHTML = '<i class="fa-solid fa-download"></i>';

        button.onclick = () => {
            const png = document.getElementsByTagName("canvas")[0].toBlob(function(blob) {
                FileSaver.saveAs(blob, 'map.jpg');
            }, "image/jpeg", 0.8);
        };
        
        this._container.appendChild(button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
}