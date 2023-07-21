import './style.css';
import './sortable.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'
import mapboxgl, { FullscreenControl, GeolocateControl, NavigationControl } from 'mapbox-gl'; 
import { createClient } from '@supabase/supabase-js'

import { LayerSwitcherControl } from './LayerSwitcherControl';
import { CategoryFilterControl } from './CategoryFilterControl';
import { SelectionControl } from './SelectionControl';
import { FeatureTable } from './FeatureTable';
import { FilterController } from './FilterController';
import { ValueFilterControl } from './ValueFilterControl';
import { DownloadControl } from './DownloadControl';
import { LoginControl } from './LoginControl';

import {mapSettings, categorySettings, filterSettings, tableSettings} from './settings.js';

const supabaseUrl = 'https://yvkdmnzwrhvjckzyznwu.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2a2Rtbnp3cmh2amNrenl6bnd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODkzMTY4NjEsImV4cCI6MjAwNDg5Mjg2MX0.dTJIcC50-lwOTXHNsJ7fr4LVund8cI4LLQkJmED60BY'
const supabase = createClient(supabaseUrl, supabaseKey)

const urlParams = new URLSearchParams(window.location.search);
const getCookieValue = (name) => (
    document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)')?.pop() || ''
  )
const athlete = getCookieValue("athlete") ? getCookieValue("athlete") : (urlParams.has("athlete") ? urlParams.get("athlete") : 0);

const layerSwitcherControl = new LayerSwitcherControl(mapSettings);
const categoryFilterControl = new CategoryFilterControl(categorySettings);
const featureTable = new FeatureTable(tableSettings);
const selectionControl = new SelectionControl(["routeLayer","routeLayerSelected"],"strava",featureTable.update);
const geolocateControl = new GeolocateControl({positionOptions: {enableHighAccuracy: true},trackUserLocation: true,showUserHeading: true})
const downloadControl = new DownloadControl()
const loginControl = new LoginControl(athlete)

var filterController = new FilterController();
filterController.addFilter("categoryActive",categoryFilterControl);
filterController.addFilter("selected",selectionControl);

const highlightColor = "#3298FD";
document.body.style.setProperty('--highlight-color', highlightColor);

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lyaGFiZW56ZWl0IiwiYSI6ImNsanpzYW5uYjAycHozcG4zYjAxaWRmcHcifQ._kspcd24UylBUYfCR3odHg';

const zoom = urlParams.has("zoom") ? urlParams.get("zoom") : 9;
const center = urlParams.has("center") ? urlParams.get("center").split(",").map((coord) => parseFloat(coord)) : [8,47];
const pitch = urlParams.has("pitch") ? urlParams.get("pitch") : 0;
const bearing = urlParams.has("bearing") ? urlParams.get("bearing") : 0;
const map = new mapboxgl.Map({
    container: 'map',
    zoom: zoom,
    center: center,
    pitch: pitch,
    bearing: bearing
});

var stravaData = {};

map.addControl(new NavigationControl(), 'top-left');
map.addControl(geolocateControl,"top-left");
map.addControl(layerSwitcherControl, 'top-left');
map.addControl(new FullscreenControl(), 'top-left');
map.addControl(downloadControl, 'top-left');
map.addControl(loginControl, 'bottom-right');

map.on('moveend', () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const bearing = map.getBearing();
    const url = new URL(window.location.href);
    url.searchParams.set("center",`${center.lng},${center.lat}`);
    url.searchParams.set("zoom",zoom);
    url.searchParams.set("pitch",pitch);
    url.searchParams.set("bearing",bearing);
    window.history.replaceState({}, '', url);
});

map.on('load', () => {
    fetchStrava();
});

map.on('mousemove', 'routeLayer', (event) => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'routeLayer', (event) => {
    map.getCanvas().style.cursor = '';
});

async function fetchSupabase(requiredFields, range) {
    const { data, error } = await supabase.from('strava-activities').select(Array.from(requiredFields).join(',')).eq('athlete',athlete).range(...range);

    data.forEach((feature) => {
        const properties = {};
        Object.entries(feature).forEach(([key,value]) => {
            if (key != "geometry") {
                properties[key] = value;
            }
            if (key != "geometry" && key != "id") {
                delete feature[key];
            }
        });
        feature.type = "Feature";
        feature.properties = properties;
    });
    
    return data;
}


async function fetchStrava() {
    var requiredFields = new Set(["id","athlete","type","geometry:geometry_simplified"]);
    Object.keys(filterSettings).forEach((key) => {
        requiredFields.add(key);
    });
    Object.keys(tableSettings).forEach((key) => {
        requiredFields.add(key);
    });
    const { nodata, counterror, count, status} = await supabase.from('strava-activities').select('*', { count: 'exact', head: true }).eq('athlete',athlete);
    
    const pageSize = 1000;
    const numPages = Math.ceil(count / pageSize);
    const ranges = Array.from({ length: numPages }, (_, i) => [i * pageSize, (i + 1) * pageSize]);
    const promises = ranges.map((range) => fetchSupabase(requiredFields, range));
    const results = await Promise.all(promises);
    
    stravaData = {"type":"FeatureCollection", "features": results.flat()};
    
    map.addControl(categoryFilterControl, 'top-right');
    const valueFilterControl = new ValueFilterControl(filterSettings,stravaData);
    filterController.addFilter("valueInRange",valueFilterControl);
    filterController.addFilter("hovered",featureTable);
    map.addControl(valueFilterControl, 'top-right');
    map.addControl(selectionControl);
    map.addControl(featureTable, 'bottom-left');
    addRouteLayer();

    /*console.log("creating datepicker");
    const pickerL = new AirDatepicker('#datepickerL',{locale:localeDE});
    const pickerU = new AirDatepicker('#datepickerU',{locale:localeDE});
    console.log(pickerL);
    console.log(pickerU);*/
}

function addDoubleLineLayer(innerWidth,outerWidth,innerColor,outerColor,source,layerName,filterArgs) {
    const debugFilter = ["any",["in","type",...categoryFilterControl.activeCategories],["!in", "type", ...categoryFilterControl.allCategories]];
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
        selectionControl.selectedFeatureIDs.forEach((id) => {
            map.setFeatureState({source: 'strava', id: id}, {selected: true});
        });
        selectionControl.selectedFeatures = stravaData.features.filter((feature) => selectionControl.selectedFeatureIDs.includes(feature.id));
        addDoubleLineLayer(2,4,categoryFilterControl.lineColor,"black","strava","routeLayer", {"selected": false, "valueInRange": true, "categoryActive": true}); 
        addDoubleLineLayer(2,4,"white",categoryFilterControl.lineColor,"strava","routeLayerSelected",{"selected": true, "valueInRange": true, "categoryActive": true});
        addDoubleLineLayer(2,4,categoryFilterControl.lineColor,categoryFilterControl.lineColor,"strava","routeLayerHover",{"hovered": true});
        selectionControl.postSelection();
    }
}

layerSwitcherControl.onStyleChange = addRouteLayer;