import { OSM,XYZ } from "ol/source";

const previewTile = "13/4297/2885";
const previewTileYX = "13/2885/4297";

//const basemapURL = "https://basemaps-api.arcgis.com/arcgis/rest/services/styles/ArcGIS:Topographic?type=style&token=AAPK9e1816efee9049b0b314e2b8a93dad45_OjiaSrW-mMznB1t4YlrJJFPoesKfgPp9Ex-IIWC5i-IXy-VTd7mDjSiFv3XxdFn";
//apply(map, basemapURL);


const maps = {
    "CH": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: true, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/${previewTile}.jpeg`, overlay: false},
    "CH (bw)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/${previewTile}.jpeg`, overlay: false},
    "CH (ski)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/${previewTile}.jpeg`, overlay: false},
    //"CH-vec": {vectorSource: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json", visible: false, preview: `https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/13/4297/2885.png`, overlay: false},
    "Esri": {source: new XYZ({url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attributions: `Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community`}), visible: false, preview: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${previewTileYX}`,overlay: false},
    "Maptiler": {vectorSource: "https://api.maptiler.com/maps/outdoor-v2/style.json?key=bfFhPHP12Ztbm0kx8iBE", visible: false, preview: `https://api.maptiler.com/maps/streets-v2/13/4297/2885.png?key=bfFhPHP12Ztbm0kx8iBE`,overlay: false},
    "Esri2": {vectorSource: "https://basemaps-api.arcgis.com/arcgis/rest/services/styles/OSM:StreetsRelief?type=style&token=AAPK9e1816efee9049b0b314e2b8a93dad45_OjiaSrW-mMznB1t4YlrJJFPoesKfgPp9Ex-IIWC5i-IXy-VTd7mDjSiFv3XxdFn", visible: false, preview: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${previewTileYX}`,overlay: false},
    "Mapbox-Light": {vectorSource: 'mapbox://styles/mapbox/light-v11', visible: false, preview: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${previewTileYX}`,overlay: false, accessToken: "pk.eyJ1Ijoid2lyaGFiZW56ZWl0IiwiYSI6ImNrNHJrd3FidTByajkzbnA0anltbXVzcjIifQ.I2ThzlzjoJZ4KryOw2nbow"},
    "Mapbox-Outdoor": {vectorSource: 'mapbox://styles/mapbox/outdoors-v12', visible: false, preview: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${previewTileYX}`,overlay: false, accessToken: "pk.eyJ1Ijoid2lyaGFiZW56ZWl0IiwiYSI6ImNrNHJrd3FidTByajkzbnA0anltbXVzcjIifQ.I2ThzlzjoJZ4KryOw2nbow"},
    "Mapbox-Street": {vectorSource: 'mapbox://styles/mapbox/streets-v12', visible: false, preview: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${previewTileYX}`,overlay: false, accessToken: "pk.eyJ1Ijoid2lyaGFiZW56ZWl0IiwiYSI6ImNrNHJrd3FidTByajkzbnA0anltbXVzcjIifQ.I2ThzlzjoJZ4KryOw2nbow"},
    "OSM": {source: new OSM(), visible: false, preview: `https://tile.openstreetmap.org/${previewTile}.png`, },
    "OTM": {source: new OSM({url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attributions: `Kartendaten: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: © <a href="http://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)`}), visible: false, preview: `https://a.tile.opentopomap.org/${previewTile}.png`,overlay: false},
    "Toner": {source: new OSM({url: 'https://stamen-tiles-{a-d}.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png'} ), visible: false, preview: `https://stamen-tiles-a.a.ssl.fastly.net/toner-lite/${previewTile}.png`,overlay:false},
    "slope": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/${previewTile}.png`, opacity: 0.5,overlay: true},
    "ski": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/${previewTile}.png`, opacity: 1.0, overlay:true}
}

export { previewTile,maps };

