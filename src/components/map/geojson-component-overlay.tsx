import React, { useState, useEffect } from 'react';
import { Source, Layer, useControl } from 'react-map-gl/mapbox';
import type { MapMouseEvent, PointLike } from 'mapbox-gl';
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from 'geojson';
import type mapboxgl from 'mapbox-gl';
import { FeatureInfoCard } from './feature-info-card';

type OverlayFeature = Feature<Geometry, GeoJsonProperties>;

type GeoJSONInteractionOptions = {
  layerId: string;
  onFeatureClick?: (feature: OverlayFeature, event: MapMouseEvent) => void;
};

export class GeoJSONInteractionControl implements mapboxgl.IControl {
  private map?: mapboxgl.Map;
  private container: HTMLElement;
  private layerId: string;
  private onFeatureClick?: (
    feature: OverlayFeature,
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

    return this.container;
  }

  onRemove() {
    if (this.map) {
      this.map.off('click', this.click);

    }
  }

  click = (e: MapMouseEvent) => {
    if (!this.map || !this.onFeatureClick) return;

    // Create a small bounding box around the click point for better hit detection
    const bbox: [PointLike, PointLike] = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];

    // Prioritize activity route selection when both layers overlap.
    const styleLayerIds = new Set(
      this.map.getStyle().layers?.map((layer) => layer.id) ?? [],
    );
    const activityLayers = ['routeLayerBG', 'routeLayerBGsel'].filter((id) =>
      styleLayerIds.has(id),
    );
    if (activityLayers.length > 0) {
      const activityHits = this.map.queryRenderedFeatures(bbox, {
        layers: activityLayers,
      });
      if (activityHits.length > 0) {
        return;
      }
    }

    // Query features in the bounding box from our layer
    const selectedFeatures = this.map.queryRenderedFeatures(bbox, {
      layers: [this.layerId],
    });

    if (
      selectedFeatures.length > 0 &&
      selectedFeatures[0]?.properties &&
      this.onFeatureClick
    ) {
      // Pass the first rendered feature with geometry and properties.
      const firstFeature = selectedFeatures[0];
      this.onFeatureClick(
        {
          type: 'Feature',
          geometry: firstFeature.geometry,
          properties: (firstFeature.properties ?? {}) as GeoJsonProperties,
        },
        e,
      );

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
  interactive: _interactive = false,
}) => {
    const [geoJSONData, setGeoJSONData] = useState<FeatureCollection | null>(
      null,
    );
    const [error, setError] = useState<string | null>(null);
    const [selectedFeature, setSelectedFeature] = useState<OverlayFeature | null>(null);

    const onFeatureClick = (feature: OverlayFeature, _event: MapMouseEvent) => {

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


    // Log when component mounts/unmounts
    useEffect(() => {
      let cancelled = false;

      if (typeof data === 'string') {
        const loadData = async () => {
          try {
            const response = await fetch(data, { cache: 'no-cache' });
            if (!response.ok) {
              throw new Error(`Failed to fetch GeoJSON: ${response.status}`);
            }
            const jsonData = (await response.json()) as FeatureCollection;
            if (cancelled) {
              return;
            }
            setGeoJSONData(jsonData);
            setError(null);
          } catch (err) {
            if (cancelled) {
              return;
            }
            const message =
              err instanceof Error ? err.message : 'Failed to load GeoJSON';
            console.error('Error loading GeoJSON:', err);
            setError(message);
          }
        };

        void loadData();
      } else if (typeof data === 'object') {
        // Direct GeoJSON data provided
        setGeoJSONData(data);
        setError(null);
      }

      return () => {
        cancelled = true;
      };
    }, [data]);

    // Add debugging for the render phase


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
