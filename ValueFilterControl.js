import noUiSlider from 'nouislider';
import wNumb from 'wnumb';

export class ValueFilterControl {
    onChange() {
        return; 
    }

    constructor(af,data) {
        const url = new URL(window.location);
        this.valueFilters = af;
        this.data = data;
        Object.entries(this.valueFilters).forEach(([key, filter]) => {
            const values = this.data.features.map((d) => d.properties[key]);
            filter.range = {min: Math.min(...values), max: Math.max(...values)};
            filter.values = url.searchParams.has(key) ? url.searchParams.get(key).split(",").map((d) => Number(d)) : [filter.range.min, filter.range.max];
        });
    }
    
    onAdd = (map) => {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'value-filter-container';
        const container = document.createElement('div');
        container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        container.id = "value-filter";
        Object.entries(this.valueFilters).forEach(([key, filter]) => {
            const button = document.createElement('button');
            button.id = key;
            button.classList.add('filter-label');
            button.innerHTML = `<i class="${filter.icon}" title="${key}"></i>`;
            container.appendChild(button);
            const sliderbox = document.createElement('div');
            sliderbox.classList.add('slider-box');
            const slider = document.createElement('div');
            slider.classList.add('noUiSlider');
            slider.id = `${key}-slider`;
            sliderbox.appendChild(slider);
            container.appendChild(sliderbox);
            noUiSlider.create(slider, {
                range: filter.range,
                step: filter.step,
                start: filter.values,
                format: wNumb({
                    decimals: filter.decimals,
                }),
                connect: true,
                tooltips: {to: filter.tooltip },
            });
            slider.noUiSlider.on('change', (values, handle) => {
                filter.values[0] = Number(values[0]);
                filter.values[1] = Number(values[1]);
                const url = new URL(window.location);
                url.searchParams.set(key, values.join(","));
                window.history.replaceState({}, '', url);
                this.onChange();
            });
        });
        this._container.appendChild(container);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    filter() {
        var filters = ["all"];
        Object.entries(this.valueFilters).forEach(([key, filter]) => {
            filters.push([">=",key, filter.values[0]]);
            filters.push(["<=",key, filter.values[1]]);
        });
        return filters;
    }
}