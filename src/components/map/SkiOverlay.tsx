import { useState } from 'react';
import { useControl, Source, Layer } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'mapbox-gl';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
} from 'geojson';
import LayerClickControl from '../../lib/LayerClickControl';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../ui/carousel';
import { Mountain, SparkleIcon } from 'lucide-react';
import { RulerHorizontalIcon } from '@radix-ui/react-icons';
import { FaRulerVertical } from 'react-icons/fa6';

// Generic named feature types that can be used for any map feature
type NamedFeature = Feature<
  Geometry,
  GeoJsonProperties & {
    name: string;
  }
>;

type NamedFeatureCollection = FeatureCollection<
  Geometry,
  GeoJsonProperties & {
    name: string;
  }
>;

/**
 * SkiOverlay component that renders a ski map layer and handles ski route data
 * When a user clicks on the ski layer, it fetches ski route data from the Swiss Topo API
 * and displays it as a GeoJSON layer
 */
const SkiOverlay: React.FC = () => {
  const [skiRouteData, setSkiRouteData] =
    useState<NamedFeatureCollection | null>(null);

  // Handle clicks on the ski layer
  const handleSkiLayerClick = async (event: MapMouseEvent) => {
    console.log('SkiOverlay: Processing ski layer click');
    console.log('Coordinates:', event.lngLat);

    try {
      // Make API request to get ski routes at the clicked location
      const url = `https://api3.geo.admin.ch/rest/services/ech/MapServer/identify?layers=all:ch.swisstopo-karto.skitouren&sr=2056&geometry=${event.lngLat.lng},${event.lngLat.lat}&mapExtent=${event.lngLat.lng - 0.1},${event.lngLat.lat - 0.1},${event.lngLat.lng + 0.1},${event.lngLat.lat + 0.1}&imageDisplay=2040,654,96&geometryFormat=geojson&geometryType=esriGeometryPoint&limit=10&tolerance=10&returnGeometry=true&lang=en&sr=4326`;

      const response = await fetch(url);
      const data = (await response.json()) as Record<string, unknown>;

      // Transform the API response to GeoJSON
      const geoJson = transformApiResponseToGeoJSON(data);
      console.log('SkiOverlay: API response:', geoJson);
      setSkiRouteData(geoJson);
    } catch (error) {
      console.error('SkiOverlay: API request failed:', error);
      setSkiRouteData(null);
    }
  };

  // Helper function to transform API response to GeoJSON
  const transformApiResponseToGeoJSON = (
    apiResponse: Record<string, unknown>,
  ): NamedFeatureCollection => {
    const results =
      (apiResponse.results as Array<Record<string, unknown>>) ?? [];

    if (results.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    const features = results.map((result) => {
      const properties = (result.properties as Record<string, unknown>) ?? {};
      return {
        type: 'Feature',
        id: result.id as number,
        geometry: result.geometry as Geometry,
        properties: {
          ...properties,
          tour_name: (properties.name as string) ?? '',
          name: `${(properties.target_name as string) ?? ''} (${(properties.name as string) ?? ''})`,
        },
      } as NamedFeature;
    });

    return {
      type: 'FeatureCollection',
      features,
    } as NamedFeatureCollection;
  };

  // Register the click handler with the generic control
  useControl(
    () =>
      new LayerClickControl('ski-layer', (event) => {
        // Wrap the async function call to avoid returning a Promise
        handleSkiLayerClick(event).catch((error) => {
          console.error('Error in ski layer click handler:', error);
        });
      }),
  );

  return (
    <>
      <Source
        id="ski-source"
        type="raster"
        tiles={[
          'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png',
        ]}
        tileSize={128}
      >
        <Layer
          id="ski-layer"
          type="raster"
          source="ski-source"
          paint={{
            'raster-opacity': 0.8,
          }}
        />
      </Source>

      {/* Render GeoJSON layer when data is available */}
      {skiRouteData && skiRouteData.features.length > 0 && (
        <Source id="ski-routes-geojson" type="geojson" data={skiRouteData}>
          <Layer
            id="ski-routes-line"
            type="line"
            source="ski-routes-geojson"
            paint={{
              'line-color': '#FF4500',
              'line-width': 4,
              'line-opacity': 0.8,
            }}
            layout={{
              'line-join': 'round',
              'line-cap': 'round',
            }}
          />
          <Layer
            id="ski-routes-symbol"
            type="symbol"
            source="ski-routes-geojson"
            layout={{
              'text-field': ['get', 'name'],
              'text-font': ['Open Sans Regular'],
              'text-size': 12,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
            }}
            paint={{
              'text-color': '#000',
              'text-halo-color': '#fff',
              'text-halo-width': 2,
            }}
          />
        </Source>
      )}
      <div className="absolute bottom-10 right-10">
        <Carousel className="w-full max-w-xs">
          <CarouselContent>
            {skiRouteData?.features.map((feature, i) => (
              <CarouselItem key={i}>
                <Card>
                  <CardHeader>
                    <CardTitle>{feature.properties.target_name}</CardTitle>
                    <CardDescription>
                      {feature.properties.tour_name}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      <div className="flex items-center pt-2" key="altitude">
                        <Mountain className="mr-2 h-4 w-4 opacity-70" />
                        <div className="text-xs text-muted-foreground">
                          {`${feature.properties.target_altitude}m`}
                        </div>
                      </div>
                      <div className="flex items-center pt-2" key="length">
                        <FaRulerVertical className="mr-2 h-4 w-4 opacity-70" />
                        <div className="text-xs text-muted-foreground">
                          {`${
                            feature.properties.descent_altitude ??
                            feature.properties.ascent_altitude
                          }m`}
                        </div>
                      </div>
                      <div className="flex items-center pt-2" key="length">
                        <SparkleIcon className="mr-2 h-4 w-4 opacity-70" />
                        <div className="text-xs text-muted-foreground">
                          {feature.properties.difficulty_de}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </div>
    </>
  );
};

export default SkiOverlay;
