import './style.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'

import {Map, View} from 'ol';
import { Group as LayerGroup, Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import { Style, Stroke } from "ol/style";
import GeoJSON from 'ol/format/GeoJSON.js';
import {DragBox, Select} from 'ol/interaction.js';
import { OSM,XYZ, Vector as VectorSource } from "ol/source";
import {platformModifierKeyOnly} from 'ol/events/condition.js';

import activityGeoJSON from '/activities_geo.json';

const colorMap = {"BackcountrySki": "#3FA7D6", "Hike": "#EE6352", "Ride": "#59CD90", "Run": "#EE6352"}
const highlightColor = "#FFC107";
document.body.style.setProperty('--ski-color', colorMap["BackcountrySki"]);
document.body.style.setProperty('--hike-color', colorMap["Hike"]);
document.body.style.setProperty('--bike-color', colorMap["Ride"]);
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

const filteredGeoJSON = {
  "BackcountrySki": {
    "type": "FeatureCollection",
    "features": activityGeoJSON.features.filter(function(feature){
       return (feature.properties.type == "BackcountrySki");
    })
  },
  "Ride": {
    "type": "FeatureCollection",
    "features": activityGeoJSON.features.filter(function(feature){
       return (feature.properties.type == "Ride");
    })
  },
  "Hike": {
    "type": "FeatureCollection",
    "features": activityGeoJSON.features.filter(function(feature){
       return (feature.properties.type == "Hike" || feature.properties.type == "Run");
    })
  }
}
const trackSources =  Object.fromEntries(
  Object.entries(filteredGeoJSON).map(
    ([k, v], i) => [k, new VectorSource({
      features: (new GeoJSON({featureProjection:"EPSG:3857",defaultDataProjection:"EPSG:4326"})).readFeatures(v)
    })]
  )
);

function trackStyle(type, selected) {
  var styles = [];
  if (selected==-1) {
    styles.push(new Style({stroke: new Stroke({color: [0,0,0,0], width: 0 })}));
  }
  else if (selected>=1) {
    styles.push(new Style({stroke: new Stroke({color: colorMap[type], width: 3*selected })}));
    styles.push(new Style({stroke: new Stroke({color: "white", width: selected })}));
  }
  else {
    styles.push(new Style({stroke: new Stroke({color: colorMap[type], width: 3 })}));
  }
  return styles;
}

const trackLayers = Object.fromEntries(
  Object.entries(trackSources).map(
    ([k, v], i) => [k, new VectorLayer({
      source: v,
      style: trackStyle(k, 0)
    })]
  )
);
const trackLayerGroup = new LayerGroup({
  title: 'Tracks',
  layers: Object.values(trackLayers)
});

/*const trackLayer = new VectorLayer({
  source: new VectorSource({
    format: new GeoJSON(),
    url: "activities_geo.json"
  }), 
  style: trackStyle("Ride", 0)
});*/

/*const trackLayer2 = new VectorLayer({
  source: new VectorSource({
    features: (new GeoJSON({featureProjection:"EPSG:3857",defaultDataProjection:"EPSG:4326"})).readFeatures(activityGeoJSON)
  }), 
  style: trackStyle("Hike", 0)
});*/

const map = new Map({
  target: "map",
  controls: defaultControls().extend([
    new ScaleLine({
      units: "metric"
    })
  ]),
  layers: [baseMaps, overlays, trackLayerGroup],
  view: view
});


function trackStyleSelected(feature) {
  return trackStyle(feature.get("type"), 1);
}

//function getGPX(id) {
//  return new URL(`/assets/activities/${id}.gpx`, import.meta.url).href;
//}

/*const trackLayers = Object.entries(activityJSON).map(function([id, track]) {
  var trackSource =  new VectorSource({
    format: new GPX(),
    url: getGPX(id)//"/activities/"+id+".gpx"
  });
  trackSource.once('change', function(e) {
    if (trackSource.getState() == 'ready') {
      trackSource.getFeatures().forEach(function(feature) {
        feature.set('id', id);
        feature.set('type', track.type);
        tracks.push(feature);
      });
    }
  });
  return new VectorLayer({
    source: trackSource,
    style: trackStyle(track.type, 0),
    type: track.type,
    id: id
  });
});
console.log(trackLayers);
const trackLayer = new LayerGroup({
  layers: trackLayers
});
map.addLayer(trackLayer);*/
/*const trackSource = new VectorSource({
  format: new GeoJSON(),
  url: './activities.geojson',
});*/


/*var trackLayer = new VectorLayer({
  source: trackSource,
  style: function(feature) {
    return trackStyle(feature.get('type'), 0);
  }
});
map.addLayer(trackLayer);*/
/*map.addLayer(bikeLayer);
map.addLayer(hikeLayer);
map.addLayer(skiLayer);
console.log(bikeLayer);*/


var shownTracks = {"Hike": true, "BackcountrySki": true, "Ride": true};
Array.from(document.getElementById("activity-switcher").getElementsByTagName("button")).forEach(function(button) {
  button.onclick = function() {
    shownTracks[button.id] = !shownTracks[button.id];
    button.classList.toggle("active");
    trackLayers[button.id].setVisible(!trackLayers[button.id].getVisible());
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
  const boxFeatures = Object.entries(trackSources).map(function([typ, srcs]) {
    if (shownTracks[typ]) {
      return srcs.getFeatures().filter((feature) => feature.getProperties().geometry.intersectsExtent(extent));
    }
    else {
      return [];
    }
  }).flat()

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
    return `<tr id=${feature.get('id')}>`+
    `<td>${feature.get('name')} <a href='https://www.strava.com/activities/${feature.id_}'><i class='fa-brands fa-strava' style='color: ${colorMap[feature.get('type')]}'></i></a></td>`+
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
    document.getElementById(feature.get('id')).addEventListener('mouseover', function() {
      feature.setStyle(trackStyle(feature.get('type'), 2));
    });
    document.getElementById(feature.get('id')).addEventListener('mouseout', function() {
      feature.setStyle(trackStyle(feature.get('type'), 1));
    });
  });
});
