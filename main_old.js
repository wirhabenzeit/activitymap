import './style.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'
import noUiSlider from 'nouislider';
import wNumb from 'wnumb';

import {Map, View} from 'ol';
import { Group as LayerGroup, Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import VectorTileLayer from 'ol/layer/VectorTile.js'
import { defaults as defaultControls, ScaleLine } from "ol/control";
import { Style, Stroke } from "ol/style";
import { asArray } from 'ol/color';
import Polyline from 'ol/format/Polyline.js';
import {DragBox, Select} from 'ol/interaction.js';
import {  Vector as VectorSource } from "ol/source";
import {platformModifierKeyOnly} from 'ol/events/condition.js';
import {apply,applyBackground,applyStyle} from 'ol-mapbox-style';
import MapboxVectorLayer from 'ol/layer/MapboxVector';

import {maps} from './mapConfig.js';
import ac from './activityConfig.json' assert {type: 'json'};
var activityFilters = ac.activityFilters;
const sportsCategories = ac.sportsCategories;
const tableColumns = ac.tableColumns;

var athlete = new URL(window.location.href).searchParams.get("athlete");
if (athlete === null) {
  athlete = "6824046";
}
const url = `./polyline_${athlete}.json`;
const urlParams = new URLSearchParams(window.location.search);


var shownTracks = {};
const colorMap = new Proxy({}, {
  get: (target, name) => name in target ? target[name] : sportsCategories["Misc"].color
})
const aliasMap = new Proxy({}, {
  get: (target, name) => name in target ? target[name] : "Misc"
})
Object.entries(sportsCategories).forEach(function([key, value]) {
  shownTracks[key] = true;
  value.alias.forEach(function(alias) {
    aliasMap[alias] = key;
    colorMap[alias] = value.color;
  });
});

const highlightColor = "#FFC107";
document.body.style.setProperty('--highlight-color', highlightColor);

var visibleMaps = []
if (urlParams.has('maps')) {
  visibleMaps = urlParams.get('maps').split(',');
  Object.entries(maps).forEach(function([id, map]) {
    map.visible = visibleMaps.includes(id);
  });
  console.log(visibleMaps);
}

var backgroundLayers = Object.entries(maps).map(function([id, map]) {
  var tl; 
  if ("vectorSource" in map) {
    tl = new LayerGroup({
      title: id,
      id: id,
      type: map.overlay?'overlay':'base',
      visible: (urlParams.has('maps'))?(visibleMaps.includes(id)):map.visible,
      opacity: map.opacity
    });
    if ("accessToken" in map) {
      apply(tl, map.vectorSource, {accessToken: map.accessToken});
    }
    else {
      apply(tl, map.vectorSource);
    }
  }
   /* tl = new MapboxVectorLayer({
      styleUrl: map.vectorSource,
      accessToken: "pk.eyJ1Ijoid2lyaGFiZW56ZWl0IiwiYSI6ImNrNHJrd3FidTByajkzbnA0anltbXVzcjIifQ.I2ThzlzjoJZ4KryOw2nbow",
      visible: (urlParams.has('maps'))?(visibleMaps.includes(id)):map.visible,
      opacity: map.opacity,
      properties: {"id": id, "title": id, "type" : map.overlay?'overlay':'base' }
    });
    //applyStyle(tl, map.vectorSource);
  }*/
  else {
    tl = new TileLayer({
    id: id,
    title: id, 
    type: map.overlay?'overlay':'base',
    visible: (urlParams.has('maps'))?(visibleMaps.includes(id)):map.visible,
    source: map.source,
    opacity: map.opacity
  });
  }
  tl.on('change:visible', function(event) {
    map.visible = !map.visible;
    document.getElementById("layer-switcher-content").getElementsByTagName("button")[id].classList.toggle("selected-true");
  });
  return tl;
});


const baseMaps = new LayerGroup({
  title: 'Karte',
  layers: backgroundLayers
});

var zoom = 8;
if (urlParams.has('zoom')) {
  zoom = parseFloat(urlParams.get('zoom'));
}
var center = [900000, 5900000];
if (urlParams.has('center')) {
  center = urlParams.get('center').split(',').map(function(x) {return parseFloat(x);});
}
const view = new View({
  projection: "EPSG:3857",
  center: center,
  zoom: zoom
});

const mapvar = new Map({
  target: "map",
  controls: defaultControls().extend([
    new ScaleLine({
      units: "metric"
    })
  ]),
  layers: [baseMaps],
  view: view
});


mapvar.on('moveend', function(e) {
  urlParams.set('zoom', `${mapvar.getView().getZoom()}`);
  urlParams.set('center', `${mapvar.getView().getCenter()}`);
  window.history.replaceState({}, '', `${location.pathname}?${urlParams}`);
});


const vectorSource = loadVectorSource();

mapvar.addLayer(new VectorLayer({
  source: vectorSource,
  style: trackStyleUnselected
}));


mapvar.once('loadend', function () {
  Object.entries(maps).forEach(function([id, map]) {
    var button = document.createElement("button");
    button.id = id;
    button.classList.add("select-layer-button")
    if (map.visible) {
      button.classList.add("selected-true")
    }
    button.style = `background-image: url(${map.preview}); background-size: 100%; background-position: 50% 65%;`;
    button.innerHTML = `<div>${id}</div>`;
    button.onclick = function () {
      var visibleLayers= []; 
      backgroundLayers.forEach(function(layer) {
      /*if (!map.overlay && "vectorSource" in map && layer.get("id")==id) {
        apply(baseMaps, map.vectorSource);
      }
      else */
      if (!map.overlay && layer.get('type') == 'base') {
        layer.setVisible(layer.get('id') == id);
      }
      else if (map.overlay && layer.get("id")==id) {
        layer.setVisible(!layer.getVisible());
      }
      if (layer.getVisible()) {
        visibleLayers.push(layer.get("id")); 
      }
    });
    urlParams.set('maps', visibleLayers);
    window.history.replaceState({}, '', `${location.pathname}?${urlParams}`);
  };
    document.getElementById("layer-switcher-content").appendChild(button);
  });
});

function loadVectorSource() {
  const vectorSource = new VectorSource({
    loader: function(extent, resolution, projection, success, failure) {
      const url = `./polyline_${athlete}.json`;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      const onError = function() {
        vectorSource.removeLoadedExtent(extent);
        failure();
      }
      xhr.onerror = onError;
      xhr.onload = function() {
        if (xhr.status == 200) {
          const features = Object.entries(JSON.parse(xhr.responseText)).map(function([id, dict]) {
            const feature = new Polyline({"geometryLayout": 'XY', 'factor': 1e5}).readFeature(dict.polyline);
            feature.getGeometry().transform('EPSG:4326', 'EPSG:3857');
            feature.setId(id);
            feature.setProperties(dict);
            return feature;
          });
          vectorSource.addFeatures(features);
          setupFilters(vectorSource);
          success(features);
        } else {
          onError();
        }
      }
      xhr.send();
    },
  });
  return vectorSource;
}

function setupFilters(vectorSource) {
  Object.entries(sportsCategories).forEach(function([key, value]) {
    document.getElementById("activity-switcher").innerHTML += `<button id="${key}" type="button" title="${key}" style="color:${value.color}" class="active"><span><i class="${value.icon}"></i></span></button>`;
  });
  Object.entries(activityFilters).forEach(function([id, filter]) {
    document.getElementById('activity-filters').innerHTML += `<div><button id="${id}" type="button" title="${id}" class="filter-label"><span><i class="${filter.icon}"></i></span></button><div class="slider-box"><div id="${id}-slider" class="noUiSlider"></div></div></div>`;
  });
  document.getElementById("layer-switcher").style.top = document.getElementsByClassName("ol-zoom")[0].getBoundingClientRect().bottom + 8 + "px";
  document.getElementById("activity-switcher").style.top = document.getElementById("layer-switcher").getBoundingClientRect().bottom + 8 + "px";
  document.getElementById("activity-filters").style.top = document.getElementById("activity-switcher").getBoundingClientRect().bottom + 8 + "px";
  Array.from(document.getElementById("activity-switcher").getElementsByTagName("button")).forEach(function(button) {
    button.onclick = function() {
      shownTracks[button.id] = !shownTracks[button.id];
      button.classList.toggle("active");
      button.style.color = shownTracks[button.id] ? sportsCategories[button.id].color : "grey";
      vectorSource.forEachFeature(function (feature) { feature.setStyle(trackStyleUnselected); });
    };
  });
  Object.entries(activityFilters).forEach(function([id, filter]) {
    const activity_values = vectorSource.getFeatures().map(function(feature) {
      return new Function('value', 'return ' + filter.transform)(feature.values_[id]);
    });
    noUiSlider.create(document.getElementById(`${id}-slider`), {
      range: {min: Math.min(...activity_values), max:  Math.max(...activity_values)},
      step: filter.step,
      start: [Math.min(...activity_values), Math.max(...activity_values)],
      format: wNumb({
        decimals: filter.decimals,
      }),
      connect: true,
      tooltips: {to: function(value) { return eval(filter.tooltip); } },
    });
    filter["limits"] = [Math.min(...activity_values), Math.max(...activity_values)];
    document.getElementById(`${id}-slider`).noUiSlider.on('change', function (values, handle) {  
      filter["limits"] = values;
      vectorSource.forEachFeature(function (feature) { feature.setStyle(trackStyleUnselected); });
    });
  });
}

function trackStyle(color, selected) {
  var styles = [];
  if (selected==-1) {
    return new Style({});
  }
  else if (selected>=1) {
    styles.push(new Style({stroke: new Stroke({color: color, width: 4*selected }), zIndex: 100}));
    styles.push(new Style({stroke: new Stroke({color: "white", width: selected }), zIndex: 100}));
  }
  else {
    var colorArray = asArray(color).slice();
    colorArray[3] = 0.75;
    styles.push(new Style({stroke: new Stroke({color: colorArray, width: 4})}));
  }
  return styles;
}


function featureVisible(feature) {
  if (!shownTracks[aliasMap[feature.get("type")]]) {
    return -1;
  }
  for (let [id, filter] of Object.entries(activityFilters)) {
    var limits = filter.limits;
    //var value = feature.get(id);
    if (limits[0] > new Function('value', 'return ' + filter.transform)(feature.get(id)) || limits[1] < new Function('value', 'return ' + filter.transform)(feature.get(id))) {
      return -1;
    }
  }
  return 0;
}

function trackStyleUnselected(feature) {
  return trackStyle(colorMap[feature.get("type")], featureVisible(feature));
}
function trackStyleSelected(feature) {
  return trackStyle(colorMap[feature.get("type")], 1);
}


const select = new Select({
  style: trackStyleSelected,
});
mapvar.addInteraction(select);

var selectedFeatures = select.getFeatures();

const dragBox = new DragBox({
  condition: platformModifierKeyOnly,
});

mapvar.addInteraction(dragBox);

dragBox.on('boxend', function () {
  const extent = dragBox.getGeometry().getExtent();
  const boxFeatures = vectorSource.getFeatures().filter((feature) => {
    if (feature.getProperties().geometry == null) {
      return false;
    }
    else {
      return feature.getProperties().geometry.intersectsExtent(extent) && featureVisible(feature) >= 0;
    }
  });
  const rotation = mapvar.getView().getRotation();
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

mapvar.on("pointermove", function (evt) {
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

function tableRow(feature) {
  return `<tr id=${feature.id_} class="${feature.values_['type']}">`+
  Object.entries(tableColumns).map(function([id, column]) { 
    if ("sort" in column) {
      return `<td data-sort='${eval(column.sort)}'>${eval(column.body)}</td>`;
    }
    else {
      return `<td>${eval(column.body)}</td>`;
    }
  }).join("") + "</tr>";
}

selectedFeatures.on(['add', 'remove'], function () {
  const tourData = selectedFeatures.getArray().map(tableRow);
  if (tourData.length > 0) {
    infoBox.innerHTML = `<thead>
    <tr>${Object.entries(tableColumns).map(function([id, column]) { return `<th>${column.title}</th>`; }).join("")}</tr>
    </thead><tbody>`+
    tourData.join('\n') + "</tbody>";
  } else {
    infoBox.innerHTML = '';
  }
  selectedFeatures.getArray().forEach(function(feature) {
    document.getElementById(feature.id_).addEventListener('mouseover', function() {
      feature.setStyle(trackStyle(colorMap[feature.values_['type']], 2));
    });
    document.getElementById(feature.id_).addEventListener('mouseout', function() {
      feature.setStyle(trackStyle(colorMap[feature.values_['type']], 1));
    });
  });
});
