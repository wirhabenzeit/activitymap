import { useState, useEffect, useCallback } from 'react';
import { Source, Layer, useControl, useMap } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'mapbox-gl';
import type { Feature } from 'geojson';
import LayerClickControl from '../../lib/LayerClickControl';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { Mountain, MapPin, Info } from 'lucide-react';
import { FaRulerVertical } from 'react-icons/fa6';
import type { NamedFeature, NamedFeatureCollection } from '../../lib/types/geojson';

interface GeoJSONOverlayProps {
  url: string; // Path to GeoJSON file in public folder (e.g., '/geojson/tracks.geojson')
  layerId?: string;
  lineColor?: string;
  lineWidth?: number;
  lineOpacity?: number;
}

/**
 * GeoJSONOverlay component that renders a GeoJSON layer from a URL
 * When a user clicks on the layer, it displays information about the selected feature
 */
const GeoJSONOverlay: React.FC<GeoJSONOverlayProps> = ({
  url,
  layerId = 'geojson-layer',
  lineColor = '#FF4500',
  lineWidth = 4,
  lineOpacity = 0.8,
}) => {
  const [geoJsonData, setGeoJsonData] = useState<NamedFeatureCollection | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<NamedFeature | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { current: map } = useMap();

  // Fetch GeoJSON data from URL (in public folder)
  useEffect(() => {
    const fetchGeoJson = async () => {
      setIsLoading(true);
      setError(null);
      try {
        console.log(`Fetching GeoJSON from: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch GeoJSON: ${response.statusText}`);
        }
        const data = await response.json() as { type: string; features: Feature[] };
        console.log(`Loaded GeoJSON with ${data.features.length} features`);
        
        // Ensure all features have a name property
        const features = data.features.map((feature: Feature, index) => {
          const props = feature.properties ?? {} as Record<string, string | number | boolean>;
          const featureWithProps = { ...feature, properties: props };
          
          // Use title or name property if available, otherwise use a default name
          if (!props.name) {
            props.name = 
              String(props.title ?? 
              props.NAME ?? 
              props.Title ?? 
              `Feature ${index}`);
          }
          
          return featureWithProps as NamedFeature;
        });
        
        const geoJsonCollection = {
          type: 'FeatureCollection',
          features,
        } as NamedFeatureCollection;
        
        console.log(`Processed GeoJSON collection with ${features.length} features`);
        setGeoJsonData(geoJsonCollection);
        
        // Add the layer ID to the map's interactiveLayerIds if possible
        if (map) {
          try {
            // Get the current map style
            const mapStyle = map.getStyle();
            if (mapStyle?.layers) {
              console.log(`Map has ${mapStyle.layers.length} layers`);
              // We can't directly modify interactiveLayerIds, but we can make sure our layer is visible
              console.log(`Ensuring ${layerId} is properly configured`);
            }
          } catch (err) {
            console.warn('Error configuring layer:', err);
          }
        }
      } catch (err) {
        console.error('Error fetching GeoJSON:', err);
        setError(err instanceof Error ? err.message : 'Failed to load GeoJSON data');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchGeoJson();
  }, [url, layerId, map]);

  // Handle clicks on the GeoJSON layer
  const handleLayerClick = useCallback((event: MapMouseEvent) => {
    console.log('Click detected on GeoJSON layer', event);
    console.log('Click coordinates:', event.lngLat);
    console.log('Click point:', event.point);
    
    if (!geoJsonData?.features?.length) {
      console.log('No GeoJSON features available');
      return;
    }
    
    console.log('GeoJSON features:', geoJsonData.features.length);

    // Find the feature that was clicked on based on proximity
    let minDistance = Infinity;
    let closestFeature: NamedFeature | null = null;

    geoJsonData.features.forEach((feature, index) => {
      // Type assertion to ensure TypeScript knows this is a NamedFeature
      const typedFeature = feature as NamedFeature;
      const featureName = typedFeature.properties?.name || 'unnamed';
      
      if (feature.geometry.type === 'LineString') {
        const coordinates = feature.geometry.coordinates as [number, number][];
        console.log(`Feature ${index} (${featureName}) has ${coordinates.length} coordinates`);
        
        // Find the closest point in the LineString to the clicked point
        coordinates.forEach((coord, _i) => {
          const dx = coord[0] - event.lngLat.lng;
          const dy = coord[1] - event.lngLat.lat;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < minDistance) {
            minDistance = distance;
            closestFeature = feature as NamedFeature;
          }
        });
      }
    });

    // Log the closest feature information
    const featureName = closestFeature ? getFeatureName(closestFeature) : 'unnamed';
    console.log('Closest feature:', featureName, 'Distance:', minDistance);

    // If a feature is found and it's close enough to the click (threshold can be adjusted)
    const threshold = 0.05; // Increased threshold for better usability
    console.log(`Using distance threshold: ${threshold}`);
    
    if (closestFeature && minDistance < threshold) {
      // Log the selected feature name
      console.log('Feature selected:', getFeatureName(closestFeature));
      setSelectedFeature(closestFeature);
    } else {
      console.log('No feature selected, clearing selection');
      setSelectedFeature(null);
    }
  }, [geoJsonData]);

  // Register the click handler with the LayerClickControl
  useControl(
    () => new LayerClickControl(layerId, handleLayerClick),
    { position: 'bottom-right' }
  );

  // Helper function to safely get feature name
  const getFeatureName = (feature: NamedFeature): string => {
    if (feature && feature.properties) {
      if ('name' in feature.properties) {
        return String(feature.properties.name);
      }
    }
    return 'unnamed';
  };

  // Extract properties to display in the info card
  const getDisplayProperties = (feature: NamedFeature) => {
    const props = feature.properties;
    const displayProps: { key: string; label: string; value: string; icon: React.ReactNode }[] = [];

    // Add common properties if they exist
    if (props.title ?? props.name) {
      displayProps.push({
        key: 'name',
        label: 'Name',
        value: String(props.title ?? props.name),
        icon: <MapPin className="mr-2 h-4 w-4 opacity-70" />,
      });
    }

    // Add elevation/altitude if it exists
    if (props.elevation ?? props.altitude ?? props.height) {
      displayProps.push({
        key: 'elevation',
        label: 'Elevation',
        value: `${props.elevation ?? props.altitude ?? props.height}m`,
        icon: <Mountain className="mr-2 h-4 w-4 opacity-70" />,
      });
    }

    // Add length/distance if it exists
    if (props.length ?? props.distance) {
      displayProps.push({
        key: 'length',
        label: 'Length',
        value: `${props.length ?? props.distance}km`,
        icon: <FaRulerVertical className="mr-2 h-4 w-4 opacity-70" />,
      });
    }

    // Add description if it exists (truncate if too long)
    if (props.description) {
      const desc = String(props.description);
      displayProps.push({
        key: 'description',
        label: 'Description',
        value: desc.length > 100 ? `${desc.substring(0, 100)}...` : desc,
        icon: <Info className="mr-2 h-4 w-4 opacity-70" />,
      });
    }

    return displayProps;
  };

  return (
    <>
      {isLoading ? (
        // You could add a loading indicator here if needed
        <></>
      ) : error ? (
        // You could add an error display here if needed
        <></>
      ) : geoJsonData && (
        <Source id={`${layerId}-source`} type="geojson" data={geoJsonData}>
          <Layer
            id={layerId}
            type="line"
            source={`${layerId}-source`}
            paint={{
              'line-color': lineColor,
              'line-width': lineWidth,
              'line-opacity': lineOpacity,
            }}
            layout={{
              'line-join': 'round',
              'line-cap': 'round',
              'visibility': 'visible'
            }}
          />
          {/* Symbol layer removed to fix glyphs error */}
        </Source>
      )}

      {/* Display info card for selected feature */}
      {selectedFeature && (
        <div className="absolute bottom-10 right-10 z-10">
          <Card className="w-full max-w-xs shadow-lg">
            <CardHeader>
              <CardTitle>{selectedFeature.properties.name}</CardTitle>
              {selectedFeature.properties.title && selectedFeature.properties.title !== selectedFeature.properties.name && (
                <CardDescription>{selectedFeature.properties.title}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {getDisplayProperties(selectedFeature).map((prop) => (
                  <div className="flex items-center pt-1" key={prop.key}>
                    {prop.icon}
                    <div className="text-xs text-muted-foreground">
                      {prop.value}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            {selectedFeature.properties.url && (
              <CardFooter>
                <a 
                  href={String(selectedFeature.properties.url)} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline"
                >
                  View more details
                </a>
              </CardFooter>
            )}
          </Card>
        </div>
      )}
    </>
  );
};

export default GeoJSONOverlay;
