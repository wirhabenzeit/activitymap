import { OSM,XYZ } from "ol/source";

const previewTile = "13/4297/2885";
const maps = {
    "CH": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: true, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/${previewTile}.jpeg`, overlay: false},
    "CH (bw)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/${previewTile}.jpeg`, overlay: false},
    "CH (ski)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/${previewTile}.jpeg`, overlay: false},
    "Esri": {source: new XYZ({url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attributions: `Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community`}), visible: false, preview: `https://c.tile.opentopomap.org/${previewTile}.png`,overlay: false},
    "OSM": {source: new OSM(), visible: false, preview: `https://tile.openstreetmap.org/${previewTile}.png`, },
    "OTM": {source: new OSM({url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attributions: `Kartendaten: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: © <a href="http://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)`}), visible: false, preview: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${previewTile}`,overlay: false},
    "Toner": {source: new OSM({url: 'https://stamen-tiles-{a-d}.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png'} ), visible: false, preview: `https://stamen-tiles-a.a.ssl.fastly.net/toner-lite/${previewTile}.png`,overlay:false},
    "slope": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/${previewTile}.png`, opacity: 0.5,overlay: true},
    "ski": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/${previewTile}.png`, opacity: 1.0, overlay:true}
}

export { previewTile,maps };

