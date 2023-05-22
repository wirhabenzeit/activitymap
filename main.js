import './style.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'
import noUiSlider from 'nouislider';
import wNumb from 'wnumb';

import {Map, View} from 'ol';
import { Group as LayerGroup, Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import { Style, Stroke } from "ol/style";
import GeoJSON from 'ol/format/GeoJSON.js';
import {DragBox, Select} from 'ol/interaction.js';
import { OSM,XYZ, Vector as VectorSource } from "ol/source";
import {platformModifierKeyOnly} from 'ol/events/condition.js';

const sportsCategories = {
  "BackcountryNordicSki": {"color": "#3FA7D6", "icon": "fa-solid fa-person-skiing-nordic", "alias": ["BackcountrySki","NordicSki"]},
  "WalkRun": {"color": "#EE6352", "icon": "fa-solid fa-walking", "alias": ["Walk","Run","Hike","RockClimbing","Snowshoe"]},
  "Ride": {"color": "#59CD90", "icon": "fa-solid fa-biking", "alias": ["Ride","VirtualRide"]},
  "AlpineSki": {"color": "#3FA7D6", "icon": "fa-solid fa-person-skiing", "alias": ["AlpineSki"]},
  "Swim": {"color": "#FAC05E", "icon": "fa-solid fa-person-swimming", "alias": ["Swim"]},
}
var aliasMap = {};
var colorMap = {};
var shownTracks = {};
Object.entries(sportsCategories).forEach(function([key, value]) {
  document.getElementById("activity-switcher").innerHTML += `<button id="${key}" type="button" title="${key}" style="color:${value.color}" class="active"><i class="${value.icon}"></i></button>`;
  shownTracks[key] = true;
  value.alias.forEach(function(alias) {
    aliasMap[alias] = key;
    colorMap[alias] = value.color;
  });
});
const highlightColor = "#FFC107";
document.body.style.setProperty('--highlight-color', highlightColor);

function secondsToHours(secs,returnSeconds) {
  var sec_num = parseInt(secs, 10); 
  var hours   = Math.floor(sec_num / 3600);
  var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
  var seconds = sec_num - (hours * 3600) - (minutes * 60);
  
  if (minutes < 10) {minutes = "0"+minutes;}
  if (seconds < 10) {seconds = "0"+seconds;}
  return hours+'h'+minutes+(returnSeconds?(':'+seconds):'');
}

var backgroundMaps = {
  "CH": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: true, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/15/17174/11536.jpeg"},
  "CH(b/w)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/15/17174/11536.jpeg"},
  "CH(ski)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/15/17174/11536.jpeg"},
  "OSM": {source: new OSM(), visible: false, preview: "https://tile.openstreetmap.org/15/17174/11536.png"},
  "OTM": {source: new OSM({url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attributions: `Kartendaten: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: © <a href="http://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)`}), visible: false, preview: 'https://c.tile.opentopomap.org/15/17174/11536.png'},
}

var overlayMaps = {
  "slope": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/15/17174/11536.png", opacity: 0.5},
  "ski": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/15/17174/11536.png", opacity: 1.0}
}

document.getElementById('layer-switcher-content').getElementsByTagName('ul')[0].innerHTML = Object.entries(backgroundMaps).map(function([id, map]) {
  return `<button id=${id} class="${map.visible?'selected-true':''}"><div class="layer-preview" style="background-image: url(${map.preview});"></div><label>${id}</label></button>`;
}).join('\n');  
document.getElementById('layer-switcher-content').getElementsByTagName('ul')[1].innerHTML = Object.entries(overlayMaps).map(function([id, map]) {
  return `<button id=${id} class="${map.visible?'selected-true':''}"><div class="layer-preview" style="background-image: url(${map.preview});"></div><label>${id}</label></button>`;
}).join('\n');  

var backgroundLayers = Object.entries(backgroundMaps).map(function([id, map]) {
  const tl = new TileLayer({
    id: id,
    title: id, 
    type: 'base',
    visible: map.visible,
    source: map.source
  });
  document.getElementById(id).onclick = function() {
    setActiveMap(id);
  }
  tl.on('change:visible', function(event) {
    map.visible = !map.visible;
    document.getElementById("layer-switcher-content").getElementsByTagName("button")[id].classList.toggle("selected-true");
  });
  return tl;
});

var overlayLayers = Object.entries(overlayMaps).map(function([id, map]) {
  const tl = new TileLayer({
    id: id,
    title: id,
    type: 'overlay',
    visible: map.visible,
    source: map.source,
    opacity: map.opacity
  });
  document.getElementById(id).onclick = function() {
    tl.setVisible(!tl.getVisible());
  }
  tl.on('change:visible', function(event) {
    map.visible = !map.visible;
    document.getElementById("layer-switcher-content").getElementsByTagName("button")[id].classList.toggle("selected-true");
  });
  return tl;
});

function setActiveMap(id) {
  backgroundLayers.forEach(function(layer) {
    layer.setVisible(layer.get('id') == id);
  });
}

const baseMaps = new LayerGroup({
  title: 'Karte',
  layers: backgroundLayers
});

const overlays = new LayerGroup({
  title: 'Overlays',
  layers: overlayLayers
});

const view = new View({
  projection: "EPSG:3857",
  center: [900000, 5900000],
  zoom: 8
});


const trackSource = new VectorSource({
  format: new GeoJSON(),
  url: './activities_geo.json',
});

var sourceEventListener = trackSource.on('change', function(e) {
  if (trackSource.getState() == 'ready') {
    var prev_legend_element = "activity-switcher";
Object.entries(activityFilters).forEach(function([id, filter]) {
  const activity_values = trackSource.getFeatures().map(function(feature) {return filter.transform(feature.values_[id])});
  //console.log(activity_values);
  noUiSlider.create(document.getElementById(`${id}-slider`), {
    range: {min: Math.min(...activity_values), max:  Math.max(...activity_values)},
    step: filter.step,
    start: [Math.min(...activity_values), Math.max(...activity_values)],
    format: wNumb({
      decimals: filter.decimals,
    }),
    connect: true,
    tooltips: {to: filter.tooltip},
  });
  filter["limits"] = [Math.min(...activity_values), Math.max(...activity_values)];
  document.getElementById(`${id}-slider`).noUiSlider.on('change', function (values, handle) {  
    filter["limits"] = values;
    trackLayer.setStyle(trackStyleUnselected);
  });
  document.getElementById(`${id}-label`).style.top = document.getElementById(prev_legend_element).getBoundingClientRect().bottom + 8 + "px";
  document.getElementById(`${id}-label`).nextSibling.style.top = document.getElementById(prev_legend_element).getBoundingClientRect().bottom + 14 + "px";
  prev_legend_element = `${id}-label`;
});
    trackSource.un('change', sourceEventListener);
  }
});

const trackLayer = new VectorLayer({
  source: trackSource,
  style: trackStyleUnselected
});

const map = new Map({
  target: "map",
  controls: defaultControls().extend([
    new ScaleLine({
      units: "metric"
    })
  ]),
  layers: [baseMaps, overlays, trackLayer],
  view: view
});

function trackStyle(color, selected) {
  var styles = [];
  if (selected==-1) {
    return new Style({});
  }
  else if (selected==-.5) {
    return new Style({stroke: new Stroke({color: color, width: 1.5 })});
  }
  else if (selected>=1) {
    styles.push(new Style({stroke: new Stroke({color: color, width: 3*selected })}));
    styles.push(new Style({stroke: new Stroke({color: "white", width: selected })}));
  }
  else {
    styles.push(new Style({stroke: new Stroke({color: color, width: 3 })}));
  }
  return styles;
}


var activityFilters = {
  "start_date_local": { "icon": "fa-solid fa-calendar-days", "transform": function(value) {return new Date(value).getTime();}, "tooltip": function(value) { return new Date(value).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}, "step": 7 * 24 * 60 * 60 * 1000, "decimals":0},
  "distance": { "icon": "fa-solid fa-ruler-horizontal", "transform": function(value) {return value;}, "tooltip": function(value) { return Math.round(value/1000)+"km"}, "step": 100, "decimals":0},
  "total_elevation_gain": { "icon": "fa-solid fa-ruler-vertical", "transform": function(value) {return value;}, "tooltip": function(value) { return Math.round(value)+"m"}, "step": 10, "decimals":0}
};

function featureVisible(feature) {
  if (!shownTracks[aliasMap[feature.get("type")]]) {
    return -1;
  }
  for (let [id, filter] of Object.entries(activityFilters)) {
      var limits = filter.limits;
      if (limits[0] > filter.transform(feature.get(id)) || limits[1] < filter.transform(feature.get(id))) {
        return -1;
      }
  }
  return 0;
}

function trackStyleUnselected(feature) {
  if (feature.get("type") in colorMap) {
    return trackStyle(colorMap[feature.get("type")], featureVisible(feature));
  }
  else {
    console.log(feature.get("type"));
    return trackStyle("black", 0);
  }
}
function trackStyleSelected(feature) {
  return trackStyle(colorMap[feature.get("type")], 1);
}

document.getElementById("layer-switcher").style.top = document.getElementsByClassName("ol-zoom")[0].getBoundingClientRect().bottom + 8 + "px";
document.getElementById("activity-switcher").style.top = document.getElementById("layer-switcher").getBoundingClientRect().bottom + 8 + "px";



Object.entries(activityFilters).forEach(function([id, filter]) {
  document.getElementById('activity-filters').innerHTML += `<div id="${id}-label" class="ol-control filter-label"><button><i class="${filter.icon}"></i></button></div><div class="slider-box"><div id="${id}-slider" class="noUiSlider"></div></div>`;
});


Array.from(document.getElementById("activity-switcher").getElementsByTagName("button")).forEach(function(button) {
  button.onclick = function() {
    shownTracks[button.id] = !shownTracks[button.id];
    button.classList.toggle("active");
    button.style.color = shownTracks[button.id] ? sportsCategories[button.id].color : "grey";
    trackLayer.setStyle(trackStyleUnselected);
  };
});

const select = new Select({
  style: trackStyleSelected,
});
map.addInteraction(select);

const selectedFeatures = select.getFeatures();

const dragBox = new DragBox({
  condition: platformModifierKeyOnly,
});

map.addInteraction(dragBox);

dragBox.on('boxend', function () {
  const extent = dragBox.getGeometry().getExtent();
  const boxFeatures = trackSource.getFeatures().filter((feature) => {
    if (feature.getProperties().geometry == null) {
      return false;
    }
    else {
      return feature.getProperties().geometry.intersectsExtent(extent) && featureVisible(feature) >= 0;
    }
  });
  const rotation = map.getView().getRotation();
  const oblique = rotation % (Math.PI / 2) !== 0;
  
  if (oblique) {
    const anchor = [0, 0];
    const geometry = dragBox.getGeometry().clone();
    geometry.rotate(-rotation, anchor);
    const extent = geometry.getExtent();
    boxFeatures.forEach(function (feature) {
      const geometry = feature.getGeometry().clone();
      geometry.rotate(-rotation, anchor);
      if (geometry.intersectsExtent(extent)) {
        selectedFeatures.push(feature);
      }
    });
  } else {
    selectedFeatures.extend(boxFeatures);
  }
});

dragBox.on('boxstart', function () {
  selectedFeatures.clear();
});

map.on("pointermove", function (evt) {
  var hit = this.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
    return true;
  }); 
  if (hit) {
    this.getTargetElement().style.cursor = 'pointer';
  } else {
    this.getTargetElement().style.cursor = '';
  }
});

const infoBox = document.getElementById('info');

selectedFeatures.on(['add', 'remove'], function () {
  const tourData = selectedFeatures.getArray().map(function (feature) {
    const date = new Date(feature.get('start_date_local'));
    return `<tr id=${feature.get('index')}>`+
    `<td>${feature.get('name')} <a href='https://www.strava.com/activities/${feature.get("index")}'><i class='fa-brands fa-strava' style='color: ${colorMap[feature.get('type')]}'></i></a></td>`+
    "<td>"+feature.get('total_elevation_gain').toFixed(0)+"</td>"+
    "<td>"+(feature.get('distance')/1000).toFixed(1)+"</td>"+
    "<td>"+secondsToHours(feature.get('elapsed_time'),false)+"</td>"+
    "<td data-sort='"+date.valueOf()+"'>"+date.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})+"</td>"+
    "</tr>";
  });
  if (tourData.length > 0) {
    infoBox.innerHTML = `<thead>
    <tr>
    <th>TOUR</th>
    <th>ELEV</th>
    <th>DIST</th>
    <th>TIME</th>
    <th>DATE</th>
    </tr>
    </thead><tbody>`+
    tourData.join('\n') + "</tbody>";
  } else {
    infoBox.innerHTML = '';
  }
  selectedFeatures.getArray().forEach(function(feature) {
    document.getElementById(feature.get('index')).addEventListener('mouseover', function() {
      feature.setStyle(trackStyle(colorMap[feature.get('type')], 2));
    });
    document.getElementById(feature.get('index')).addEventListener('mouseout', function() {
      feature.setStyle(trackStyle(colorMap[feature.get('type')], 1));
    });
  });
});


//document.getElementById("distance-selector").style.top = document.getElementById("date-selector").getBoundingClientRect().bottom + 8 + "px";
//console.log(console.log(rect.top, rect.right, rect.bottom, rect.left);)