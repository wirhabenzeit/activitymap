import React, { useState, useEffect } from 'react';
import { Source, Layer, useControl } from 'react-map-gl/mapbox';
import type { MapMouseEvent, PointLike } from 'mapbox-gl';
import type { FeatureCollection, GeoJsonProperties } from 'geojson';
import type mapboxgl from 'mapbox-gl';
import { FeatureInfoCard } from './FeatureInfoCard';

type GeoJSONInteractionOptions = {
  layerId: string;
  onFeatureClick?: (feature: GeoJsonProperties, event: MapMouseEvent) => void;
};

export class GeoJSONInteractionControl implements mapboxgl.IControl {
  private map?: mapboxgl.Map;
  private container: HTMLElement;
  private layerId: string;
  private onFeatureClick?: (
    feature: GeoJsonProperties,
    event: MapMouseEvent,
  ) => void;

  constructor(options: GeoJSONInteractionOptions) {
    this.layerId = options.layerId;
    this.onFeatureClick = options.onFeatureClick;
    this.container = document.createElement('div');
  }

  onAdd(map: mapboxgl.Map) {
    this.map = map;
    this.map.on('click', this.click);
    console.log(`GeoJSON interaction control added for layer: ${this.layerId}`);
    return this.container;
  }

  onRemove() {
    if (this.map) {
      this.map.off('click', this.click);
      console.log(
        `GeoJSON interaction control removed for layer: ${this.layerId}`,
      );
    }
  }

  click = (e: MapMouseEvent) => {
    if (!this.map || !this.onFeatureClick) return;

    // Create a small bounding box around the click point for better hit detection
    const bbox: [PointLike, PointLike] = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];

    // Query features in the bounding box from our layer
    const selectedFeatures = this.map.queryRenderedFeatures(bbox, {
      layers: [this.layerId],
    });

    if (
      selectedFeatures.length > 0 &&
      selectedFeatures[0]?.properties &&
      this.onFeatureClick
    ) {
      // Pass the first feature's properties and the event to the callback
      this.onFeatureClick(selectedFeatures[0].properties, e);
      console.log('GeoJSON feature clicked:', selectedFeatures[0].properties);
    }
  };
}

interface GeoJSONComponentOverlayProps {
  id?: string;
  data?: FeatureCollection | string; // Can be direct GeoJSON data or URL to fetch
  color?: string;
  lineWidth?: number;
  opacity?: number;
  fillColor?: string;
  fillOpacity?: number;
  interactive?: boolean;
}

export const GeoJSONComponentOverlay: React.FC<
  GeoJSONComponentOverlayProps
> = ({
  id = 'geojson-overlay',
  data,
  color = '#ff0000',
  lineWidth = 2,
  opacity = 0.8,
  interactive = false,
}) => {
  const [geoJSONData, setGeoJSONData] = useState<FeatureCollection | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<GeoJsonProperties | null>(null);

  const onFeatureClick = (feature: GeoJsonProperties, event: MapMouseEvent) => {
    console.log('GeoJSON feature clicked:', feature);
    setSelectedFeature(feature);
  };

  useControl(
    () =>
      new GeoJSONInteractionControl({
        layerId: `${id}-line-layer`,
        onFeatureClick,
      }),
  );

  // Log when interactivity is enabled
  useEffect(() => {
    if (interactive) {
      console.log(`Interactive GeoJSON overlay ${id} is enabled`);
    }
  }, [id, interactive]);

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
        .then((response) => {
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

  // The interaction control is now handled by the GeoJSONInteraction component

  return (
    <>
      <Source id={`${id}-source`} type="geojson" data={geoJSONData}>
        <Layer
          id={`${id}-line-layer`}
          type="line"
          paint={{
            'line-color': color,
            'line-width': lineWidth,
            'line-opacity': opacity,
          }}
        />
      </Source>
      {selectedFeature && (
        <FeatureInfoCard 
          feature={selectedFeature} 
          onClose={() => setSelectedFeature(null)} 
        />
      )}
    </>
  );
};

export default GeoJSONComponentOverlay;
