import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';

/**
 * A GeoJSON feature with a name property
 */
export type NamedFeature = Feature<Geometry, GeoJsonProperties & {
  name: string;
}>;

/**
 * A GeoJSON feature collection where each feature has a name property
 */
export type NamedFeatureCollection = FeatureCollection<Geometry, GeoJsonProperties & {
  name: string;
}>;
