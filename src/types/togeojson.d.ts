declare module '@mapbox/togeojson' {
  import type {
    FeatureCollection,
    Geometry,
    GeoJsonProperties,
  } from 'geojson';

  export function kml(
    doc: Document,
  ): FeatureCollection<Geometry, GeoJsonProperties>;
  export function gpx(
    doc: Document,
  ): FeatureCollection<Geometry, GeoJsonProperties>;

  const toGeoJSON: {
    kml: typeof kml;
    gpx: typeof gpx;
  };

  export default toGeoJSON;
}
