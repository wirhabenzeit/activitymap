import React from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { RasterLayer, RasterSourceSpecification } from 'mapbox-gl';

interface RasterMapProps {
  id: string;
  url: string;
  tileSize?: number;
  opacity?: number;
  minzoom?: number;
  maxzoom?: number;
}

/**
 * RasterMap component for rendering raster tile layers
 * Can be used for both base maps and overlay maps
 * 
 * @example
 * <RasterMap 
 *   id="hiking-trails" 
 *   url="https://example.com/tiles/{z}/{x}/{y}.png" 
 *   opacity={0.7} 
 * />
 */
export const RasterMap: React.FC<RasterMapProps> = ({
  id,
  url,
  tileSize = 256,
  opacity = 1,
  minzoom,
  maxzoom,
}) => {
  const sourceOptions: RasterSourceSpecification = {
    type: 'raster',
    tiles: [url],
    tileSize,
  };

  if (minzoom !== undefined) {
    sourceOptions.minzoom = minzoom;
  }

  if (maxzoom !== undefined) {
    sourceOptions.maxzoom = maxzoom;
  }

  const layerStyle: RasterLayer = {
    id,
    type: 'raster',
    source: `${id}-source`,
    paint: {
      'raster-opacity': opacity,
    },
  };

  return (
    <Source id={`${id}-source`} {...sourceOptions}>
      <Layer {...layerStyle} />
    </Source>
  );
};
