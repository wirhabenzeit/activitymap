import { OSM,XYZ } from "ol/source";

const previewTile = "13/4297/2885";
const backgroundMaps = {
    "CH": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: true, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/${previewTile}.jpeg`},
    "CH(b/w)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/${previewTile}.jpeg`},
    "CH(ski)": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/${previewTile}.jpeg`},
    "OSM": {source: new OSM(), visible: false, preview: `https://tile.openstreetmap.org/${previewTile}.png`},
    "OTM": {source: new OSM({url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attributions: `Kartendaten: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: © <a href="http://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)`}), visible: false, preview: `https://c.tile.opentopomap.org/${previewTile}.png`},
    "Toner": {source: new OSM({url: 'https://stamen-tiles-{a-d}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png'} ), visible: false, preview: `https://stamen-tiles-a.a.ssl.fastly.net/toner/${previewTile}.png`}
}

const overlayMaps = {
    "slope": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/${previewTile}.png`, opacity: 0.5},
    "ski": {source: new XYZ({url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`}), visible: false, preview: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/${previewTile}.png`, opacity: 1.0}
}

export { backgroundMaps, overlayMaps};
