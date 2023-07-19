export class CategoryFilterControl {
    constructor(sc) {
        this.allCategories = [];
        this.activeCategories = [];
        this.sportsCategories = sc;

        this.colorMap = new Proxy({}, {
            get: (target, name) => name in target ? target[name] : this.sportsCategories["Misc"].color
        })  
        this.aliasMap = new Proxy({}, {
            get: (target, name) => name in target ? target[name] : "Misc"
        })

        const url = new URL(window.location);

        this.lineColor = ['match',['get', 'type']]; 
        Object.entries(this.sportsCategories).forEach(([key, value]) => {
            value.active = url.searchParams.has(key) ? url.searchParams.get(key) == "true" : true;
            value.alias.forEach((alias) => {
                this.allCategories.push(alias);
                if (value.active) this.activeCategories.push(alias);
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
            button.innerHTML = `<i class="${value.icon}" title=${key}></i>`;
            if (!value.active) {
                button.classList.add('category-not-active');
            }
            button.style.color = value.color;
            button.onclick = () => {
                value.active = !value.active;
                if (value.active) { value.alias.forEach((alias) => { this.activeCategories.push(alias); }); }
                else { value.alias.forEach((alias) => { this.activeCategories.pop(alias);}); }
                const url = new URL(window.location);
                url.searchParams.set(key, value.active);
                window.history.replaceState({}, '', url);
                button.classList.toggle('category-not-active');
                this.onChange();
            };
            label.appendChild(button);
        });
        this._container.appendChild(label);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    filter() {
        if (this.sportsCategories["Misc"].active) {
            return ["any",["in", "type",...this.activeCategories],["!in", "type", ...this.allCategories]];
        }
        else {
            return ["in", "type", ...this.activeCategories];
        }
    }
}