import './style.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'
import mapboxgl, { FullscreenControl, GeolocateControl, NavigationControl } from 'mapbox-gl'; // 
import { LayerSwitcherControl } from './LayerSwitcherControl';
import { CategoryFilterControl } from './CategoryFilterControl';
import { SelectionControl } from './SelectionControl';
import { FeatureTable } from './FeatureTable';
import { FilterController } from './FilterController';
import { ValueFilterControl } from './ValueFilterControl';
import { DownloadControl } from './DownloadControl';

var athlete = new URL(window.location.href).searchParams.get("athlete");
if (athlete === null) {
  athlete = "6824046";
}
const url = `./strava_${athlete}.json`;

const layerSwitcherControl = new LayerSwitcherControl({
    "Mapbox Street": {url: 'mapbox://styles/mapbox/streets-v12?optimize=true', type: "vector", visible: true, overlay: false},
    "Mapbox Outdoors": {url: 'mapbox://styles/mapbox/outdoors-v12?optimize=true', type: "vector", visible: false, overlay: false},
    "Mapbox Light": {url: 'mapbox://styles/mapbox/light-v11?optimize=true', type: "vector", visible: false, overlay: false},
    "Mapbox Dark": {url: 'mapbox://styles/mapbox/dark-v11?optimize=true', type: "vector", visible: false, overlay: false},
    "Mapbox Satellite": {url: 'mapbox://styles/mapbox/satellite-v9?optimize=true', type: "vector", visible: false, overlay: false},
    "Swisstopo Light": {url: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json", type: "vector", visible: false, overlay: false},
    "Swisstopo Pixelkarte": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`, type: "raster", visible: false, overlay: false},
    "Swisstopo Winter": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`, type: "raster", visible: false, overlay: false},
    "Swisstopo Ski": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.8, overlay: true},
    "Swisstopo Slope": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.4, overlay: true},
    "Veloland": {url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.4, overlay: true},
    "Wanderland": {url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.4, overlay: true}
});
const categoryFilterControl = new CategoryFilterControl({
    "BackcountryNordicSki": {
        "color": "#1982C4",
        "icon": "fa-solid fa-skiing-nordic",
        "alias": ["BackcountrySki","NordicSki"],
        "active": true
    },
    "WalkRun": {
        "color": "#FF595E",
        "icon": "fa-solid fa-walking",
        "alias": ["Walk","Run","Hike","RockClimbing","Snowshoe"],
        "active": true
    },
    "Ride": {
        "color": "#8AC926",
        "icon": "fa-solid fa-biking",
        "alias": ["Ride","VirtualRide"],
        "active": true
    },
    "AlpineSki": {
        "color": "#3FA7D6",
        "icon": "fa-solid fa-person-skiing",
        "alias": ["AlpineSki"],
        "active": true
    },
    "Misc": {
        "color": "#6A4C93",
        "icon": "fa-solid fa-person-circle-question",
        "alias": [],
        "active": true
    }
});
const featureTable = new FeatureTable({
    "name": {
        "title": '<i class="fa-solid fa-route"></i>',
        "body": (feature) => `<a href='https://www.strava.com/activities/${feature.id}' style='color:${categoryFilterControl.colorMap[feature.properties["type"]]}'>${feature.properties['name']}</a>`
    },
    "total_elevation_gain": {
        "title": '<i class="fa-solid fa-ruler-vertical"></i>',
        "body": (feature) => feature.properties['total_elevation_gain'].toFixed(0)
    },
    "distance": {
        "title": '<i class="fa-solid fa-ruler-horizontal"></i>',
        "body": (feature) => (feature.properties['distance']/1000).toFixed(1)
    },
    "elapsed_time": {
        "title": '<i class="fa-solid fa-stopwatch"></i>',
        "body": (feature) => new Date(feature.properties['elapsed_time']*1000).toISOString().substr(11, 8)
    },
    "start_date_local": {
        "title": '<i class="fa-solid fa-calendar-days"></i>',
        "body": (feature) => new Date(feature.properties['start_date_local']*1000).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}),
    }
});
const valueFilterSettings = {
    "start_date_local": {
        "icon": "fa-solid fa-calendar-days",
        "tooltip": (value) => new Date(value*1000).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}),
        "step": 3600,//604800000,
        "decimals": 0
    },
    "distance": {
        "icon": "fa-solid fa-ruler-horizontal",
        "tooltip": (value) => `${Math.round(value)/1000}km`,
        "step": 100,
        "decimals": 0
    },
    "total_elevation_gain": {
        "icon": "fa-solid fa-ruler-vertical",
        "tooltip": (value) => `${Math.round(value)}m`,
        "step": 10,
        "decimals": 0
    },
    "elapsed_time": {
        "icon": "fa-solid fa-stopwatch",
        "tooltip": (value) => `${new Date(value*1000).toISOString().substr(11, 8)}`,
        "step": 1,
        "decimals": 0
    }
};
const selectionControl = new SelectionControl(["routeLayer","routeLayerSelected"],"strava",featureTable.update);
const geolocateControl = new GeolocateControl({positionOptions: {enableHighAccuracy: true},trackUserLocation: true,showUserHeading: true})
const downloadControl = new DownloadControl()

var filterController = new FilterController();
filterController.addFilter("categoryActive",categoryFilterControl);
filterController.addFilter("selected",selectionControl);

const highlightColor = "#3298FD";
document.body.style.setProperty('--highlight-color', highlightColor);

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lyaGFiZW56ZWl0IiwiYSI6ImNrNHJrd3FidTByajkzbnA0anltbXVzcjIifQ.I2ThzlzjoJZ4KryOw2nbow';


const map = new mapboxgl.Map({
    container: 'map',
    zoom: 9,
    center: [8,47],
    preserveDrawingBuffer: true
});

var stravaData = {};

map.addControl(new NavigationControl(), 'top-left');
map.addControl(geolocateControl,"top-left");
map.addControl(layerSwitcherControl, 'top-left');
map.addControl(new FullscreenControl(), 'top-left');
map.addControl(downloadControl, 'top-left');

map.on('load', () => {
    fetchStrava();
});

map.on('mousemove', 'routeLayer', (event) => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'routeLayer', (event) => {
    map.getCanvas().style.cursor = '';
});

async function fetchStrava() {
    const response = await fetch(url);
    stravaData = await response.json();
    map.addControl(categoryFilterControl, 'top-right');
    const valueFilterControl = new ValueFilterControl(valueFilterSettings,stravaData);
    filterController.addFilter("valueInRange",valueFilterControl);
    filterController.addFilter("hovered",featureTable);
    map.addControl(valueFilterControl, 'top-right');
    map.addControl(selectionControl);
    map.addControl(featureTable, 'bottom-left');
    addRouteLayer();
}

function addDoubleLineLayer(innerWidth,outerWidth,innerColor,outerColor,source,layerName,filterArgs) {
    map.addLayer({
        'id': layerName,
        'type': 'line',
        'source': source,
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': outerColor,
            'line-width': outerWidth,
        },
        'filter': filterController.filter(filterArgs)
    });
    map.addLayer({
        'id': layerName + "2",
        'type': 'line',
        'source': source,
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': innerColor,
            'line-width': innerWidth,
        },
        'filter': filterController.filter(filterArgs)
    });
    filterController.changeHandlers.push(() => { map.setFilter(layerName, filterController.filter(filterArgs)); });
    filterController.changeHandlers.push(() => { map.setFilter(layerName+"2", filterController.filter(filterArgs)); });
}

function addRouteLayer() {
    if ("features" in stravaData && map.getSource('strava') === undefined) {
        map.addSource('strava', {
            type: 'geojson',
            data: stravaData,
            'generateId': false
        });
        addDoubleLineLayer(2,3,categoryFilterControl.lineColor,"black","strava","routeLayer", {"selected": false, "valueInRange": true, "categoryActive": true});
        addDoubleLineLayer(2,4,"white",categoryFilterControl.lineColor,"strava","routeLayerSelected",{"selected": true, "valueInRange": true, "categoryActive": true});
        addDoubleLineLayer(2,4,categoryFilterControl.lineColor,categoryFilterControl.lineColor,"strava","routeLayerHover",{"hovered": true});
    }
}

layerSwitcherControl.onStyleChange = addRouteLayer;