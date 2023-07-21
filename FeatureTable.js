const styles = `
#feature-table-container {
    max-height: 35em;
    width: 29em;
    overflow-y: scroll;
    pointer-events: all;
    margin: 10px;
    border-radius: 4px;
    box-shadow: 0 0 0 2px rgba(0,0,0,.1);
    transform: translate(3em,0);
  }
  #feature-table-container:empty { 
    box-shadow: none;
  }
`


export class FeatureTable {
    onChange() {
        return;
    }

    constructor(tc) {
        const styleSheet = document.createElement("style")
        styleSheet.innerText = styles
        document.head.appendChild(styleSheet)

        this._map;
        this.tableColumns = tc;
        this.hover = "";
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'feature-table-container';
        
        map.boxZoom.disable();
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    tableRow = (feature) => {
        const tableRows = Object.entries(this.tableColumns).map(function([id, column]) { 
            if ("sort" in column) {
                return `<td data-sort='${column.sort(feature.properties)}'>${column.body(feature.properties)}</td>`;
            }
            else {
                return `<td>${column.body(feature.properties)}</td>`;
            }
        });
        return `<tr id=${feature.properties["id"]} class="${feature.properties['type']}">`+ tableRows.join("") + "</tr>";
    }
    
    update = (features) => {     
        const tourData = features.map(this.tableRow);
        if (tourData.length > 0) { 
            this._container.innerHTML = `<table class="sortable"><thead>
            <tr>${Object.entries(this.tableColumns).map(([id, column]) => { return `<th>${column.title}</th>`; }).join("")}</tr>
            </thead><tbody>`+
            tourData.join('\n') + "</tbody></table>";
        } else {
            this._container.innerHTML = '';
        }
        features.forEach((feature) => {
            document.getElementById(feature.properties["id"]).addEventListener('mouseover', () => {
                this._map.setFeatureState({source: 'strava', id: feature.properties["id"]}, {hover: true});
                this.hover = feature.properties["id"];
                this.onChange();
            });
            document.getElementById(feature.properties["id"]).addEventListener('mouseout', () => {
                this._map.setFeatureState({source: 'strava', id: feature.properties["id"]}, {hover: false});
                this.hover = "";
                this.onChange();
            });
        });
    }

    filter = () => {
        return ["==", "id", this.hover];
    }
}

