export class FilterController {
    onChange() {
        this.changeHandlers.forEach(handler => handler());
    }

    constructor() {
        this.filterCache = {};
        this._filters = {};
        this.changeHandlers = [];
        this.negationDict = {"==": "!=", "!=": "==", ">": "<=", "<=": ">", ">=": "<", "<": ">=", "in": "!in", "!in": "in", "has": "!has", "!has": "has"};
    }

    addFilter(name,filter) {
        this._filters[name] = filter;
        this.filterCache[name] = filter.filter();
        filter.onChange = () => {
            this.filterCache[name] = filter.filter();
            this.onChange();
        }
    }

    filter(args) {
        var filterArray = ["all"];
        Object.entries(args).forEach(([key, value]) => {
            //console.log("Filtering on " + key + " with value " + value);
            //console.log(this.filterCache[key]);
            //console.log(this.filterCache);
            if (value) filterArray.push(this.filterCache[key]);
            else filterArray.push(this.negation(this.filterCache[key]));
        });
        //console.log(`Filter returned for args ${JSON.stringify(args)}`);
        //console.log(filterArray);
        return filterArray;
    }

    negation = (filter) => {
        return [this.negationDict[filter[0]],...filter.slice(1,filter.length)];
    }
}