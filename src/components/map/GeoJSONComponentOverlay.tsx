import React, { useState, useEffect } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'mapbox-gl';
import type { FeatureCollection, GeoJsonProperties } from 'geojson';

interface GeoJSONComponentOverlayProps {
  id?: string;
  data?: FeatureCollection | string; // Can be direct GeoJSON data or URL to fetch
  color?: string;
  lineWidth?: number;
  opacity?: number;
  fillColor?: string;
  fillOpacity?: number;
  interactive?: boolean;
  onFeatureClick?: (feature: GeoJsonProperties, event: MapMouseEvent) => void;
}

export const GeoJSONComponentOverlay: React.FC<GeoJSONComponentOverlayProps> = ({
  id = 'geojson-overlay',
  data,
  color = '#ff0000',
  lineWidth = 2,
  opacity = 0.8,
  fillColor,
  fillOpacity = 0.2,
  interactive = false,
  onFeatureClick,
}) => {
  const [geoJSONData, setGeoJSONData] = useState<FeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For a real implementation, we would need to use a ref to access the map instance
  // and set up event listeners. For this example, we'll just log that interactive features
  // would be handled here.
  useEffect(() => {
    if (interactive && onFeatureClick) {
      console.log(`Interactive GeoJSON overlay ${id} is ready for feature clicks`);
      // In a real implementation, we would set up map click handlers here
    }
  }, [id, interactive, onFeatureClick]);
  
  // Log when component mounts/unmounts
  useEffect(() => {
    console.log(`GeoJSON overlay component ${id} mounted`);
    return () => {
      console.log(`GeoJSON overlay component ${id} unmounted`);
    };
  }, [id]);

  // Fetch GeoJSON data if URL is provided
  useEffect(() => {
    if (typeof data === 'string') {
      setIsLoading(true);
      setError(null);
      
      // Handle both absolute URLs and relative paths
      // For relative paths, ensure they're properly resolved
      const url = data.startsWith('http') ? data : data;
      console.log(`Fetching GeoJSON from: ${url}`);
      
      // Use fetch with appropriate cache settings
      fetch(url, { cache: 'no-cache' })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch GeoJSON: ${response.status}`);
          }
          return response.json();
        })
        .then((jsonData: FeatureCollection) => {
          console.log('GeoJSON data loaded successfully');
          setGeoJSONData(jsonData);
          setIsLoading(false);
        })
        .catch((err: Error) => {
          console.error('Error loading GeoJSON:', err);
          setError(err.message);
          setIsLoading(false);
        });
    } else if (typeof data === 'object') {
      // Direct GeoJSON data provided
      setGeoJSONData(data);
    }
  }, [data]);

  // Add debugging for the render phase
  useEffect(() => {
    if (geoJSONData) {
      console.log(`Rendering GeoJSON overlay with ID: ${id}`);
      console.log('GeoJSON features count:', geoJSONData.features?.length ?? 0);
    }
  }, [id, geoJSONData]);

  if (isLoading) {
    console.log(`Loading GeoJSON data for ${id}...`);
    return null;
  }

  if (error) {
    console.error(`Error loading GeoJSON data for ${id}: ${error}`);
    return null;
  }

  if (!geoJSONData) {
    return null;
  }

  return (
    <Source
      id={`${id}-source`}
      type="geojson"
      data={geoJSONData}
    >
      <Layer
        id={`${id}-line-layer`}
        type="line"
        paint={{
          'line-color': color,
          'line-width': lineWidth,
          'line-opacity': opacity,
        }}
      />
      {fillColor && (
        <Layer
          id={`${id}-fill-layer`}
          type="fill"
          paint={{
            'fill-color': fillColor ?? color,
            'fill-opacity': fillOpacity,
          }}
        />
      )}
      {interactive && (
        <Layer
          id={`${id}-interactive-layer`}
          type="fill"
          paint={{
            'fill-color': '#000',
            'fill-opacity': 0,
          }}
        />
      )}
    </Source>
  );
};

export default GeoJSONComponentOverlay;
