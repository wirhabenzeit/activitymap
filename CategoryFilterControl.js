export class CategoryFilterControl {
    constructor(sc) {
        this.allCategories = [];
        this.sportsCategories = sc;
        this.shownTracks = {};

        this.colorMap = new Proxy({}, {
            get: (target, name) => name in target ? target[name] : this.sportsCategories["Misc"].color
        })  
        this.aliasMap = new Proxy({}, {
            get: (target, name) => name in target ? target[name] : "Misc"
        })

        this.lineColor = ['match',['get', 'type']]; 
        Object.entries(this.sportsCategories).forEach(([key, value]) => {
            this.shownTracks[key] = true;
            value.alias.forEach((alias) => {
                this.aliasMap[alias] = key;
                this.colorMap[alias] = value.color;
                this.lineColor.push(alias, value.color);
            });
            if (key == "Misc") this.lineColor.push(value.color);
        });
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'activity-filter-container';
        const label = document.createElement('div');
        label.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        label.id = "activity-filter";
        Object.entries(this.sportsCategories).forEach(([key, value]) => {
            const button = document.createElement('button');
            button.id = key;
            button.innerHTML = `<i class="${value.icon}"></i>`;
            if (!value.active) {
                button.classList.add('category-not-active');
            }
            button.style.color = value.color;
            button.onclick = () => {
                value.active = !value.active;
                button.classList.toggle('category-not-active');
                this.onChange();
            };
            label.appendChild(button);
            Object.entries(value.alias).forEach(([key, value]) => {
                this.allCategories.push(value);
            });
        });
        this._container.appendChild(label);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    filter() {
        var includedCategories = [];
        Object.entries(this.sportsCategories).forEach(([key, value]) => {
            if (value.active) {
                Object.entries(value.alias).forEach(([key, value]) => {
                    includedCategories.push(value);
                });
            }
        });
        if (this.sportsCategories["Misc"].active) {
            return ["any",["in", "type", ...includedCategories],["!in", "type", "Hike", ...this.allCategories]];
        }
        else {
            return ["in", "type", ...includedCategories];
        }
    }
}