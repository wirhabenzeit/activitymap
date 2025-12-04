declare module '@mapbox/togeojson' {
  export function kml(doc: Document): {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      geometry: {
        type: string;
        coordinates: number[][];
      };
      properties: {
        name: string;
        [key: string]: unknown;
      };
    }>;
  };
}
