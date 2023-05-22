import { OSM,XYZ } from "ol/source";

const backgroundMaps = {
    "CH": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: true, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/15/17174/11536.jpeg"},
    "CH(b/w)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/15/17174/11536.jpeg"},
    "CH(ski)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/15/17174/11536.jpeg"},
    "OSM": {source: new OSM(), visible: false, preview: "https://tile.openstreetmap.org/15/17174/11536.png"},
    "OTM": {source: new OSM({url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attributions: `Kartendaten: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: © <a href="http://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)`}), visible: false, preview: 'https://c.tile.opentopomap.org/15/17174/11536.png'},
}

const overlayMaps = {
    "slope": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/15/17174/11536.png", opacity: 0.5},
    "ski": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/15/17174/11536.png", opacity: 1.0}
}

const sportsCategories = {
    "BackcountryNordicSki": {"color": "#1982C4", "icon": "fa-solid fa-person-skiing-nordic", "alias": ["BackcountrySki","NordicSki"]},
    "WalkRun": {"color": "#FF595E", "icon": "fa-solid fa-walking", "alias": ["Walk","Run","Hike","RockClimbing","Snowshoe"]},
    "Ride": {"color": "#8AC926", "icon": "fa-solid fa-biking", "alias": ["Ride","VirtualRide"]},
    "AlpineSki": {"color": "#3FA7D6", "icon": "fa-solid fa-person-skiing", "alias": ["AlpineSki"]},
    "Misc": {"color": "#6A4C93", "icon": "fa-solid fa-person-circle-question", "alias": []},
}

var activityFilters = {
    "start_date_local": { "icon": "fa-solid fa-calendar-days", "transform": function(value) {return new Date(value).getTime();}, "tooltip": function(value) { return new Date(value).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}, "step": 7 * 24 * 60 * 60 * 1000, "decimals":0},
    "distance": { "icon": "fa-solid fa-ruler-horizontal", "transform": function(value) {return value;}, "tooltip": function(value) { return Math.round(value/1000)+"km"}, "step": 100, "decimals":0},
    "total_elevation_gain": { "icon": "fa-solid fa-ruler-vertical", "transform": function(value) {return value;}, "tooltip": function(value) { return Math.round(value)+"m"}, "step": 10, "decimals":0}
};

const colorMap = new Proxy({}, {
    get: (target, name) => name in target ? target[name] : sportsCategories["Misc"].color
})
const aliasMap = new Proxy({}, {
    get: (target, name) => name in target ? target[name] : "Misc"
})
Object.entries(sportsCategories).forEach(function([key, value]) {
    value.alias.forEach(function(alias) {
        aliasMap[alias] = key;
        colorMap[alias] = value.color;
    });
});

function secondsToHours(secs,returnSeconds) {
    var sec_num = parseInt(secs, 10); 
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);
    
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+'h'+minutes+(returnSeconds?(':'+seconds):'');
}

const tableColumns = {
    "name": { 
        "title": "TOUR", 
        "body": function(feature) { return `<a href='https://www.strava.com/activities/${feature.id_}' style='color:${colorMap[feature.values_["type"]]}'>${feature.values_['name']}</a>`; } 
    },
    "total_elevation_gain": {
        "title": "ELEV",
        "body": function(feature) { return feature.values_['total_elevation_gain'].toFixed(0); }
    },
    "distance": {
        "title": "DIST",
        "body": function(feature) { return (feature.values_['distance']/1000).toFixed(1); }
    },
    "elapsed_time": {
        "title": "TIME",
        "body": function(feature) { return new Date(feature.values_['elapsed_time']*1000).toISOString().substr(11, 8); }
    },
    "start_date_local": {
        "title": "DATE",
        "body": function(feature) { return new Date(feature.values_['start_date_local']).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}); },
        "sort": function(feature) { return new Date(feature.values_['start_date_local']).getTime(); }
    }
}

export { backgroundMaps, overlayMaps, sportsCategories, activityFilters, tableColumns, colorMap, aliasMap };
