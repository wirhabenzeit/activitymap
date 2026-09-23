'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMap } from 'react-map-gl/mapbox';
import type { LineString } from 'geojson';

import { useActivities, useActivityGeoJsonFromActivities } from '~/hooks/use-activities';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { colorMap } from '~/settings/category';
import { RouteHeatmapPool } from '~/lib/route-heatmap-pool';
import {
  projectRoutes,
  TILE_SIZE,
  type HeatmapRoute,
} from '~/lib/route-heatmap';

const SOURCE_ID = 'routeHeatmapSource';
const LAYER_ID = 'routeHeatmapLayer';

export const RouteHeatmapLayer = React.memo(function RouteHeatmapLayer() {
  const { data: activities = [] } = useActivities();
  const { filterIDs } = useFilteredActivities(activities);
  const geoJson = useActivityGeoJsonFromActivities(activities);

  const routes = useMemo(() => {
    const visible = new Set(filterIDs);
    const selected: HeatmapRoute[] = [];
    const colorCounts = new Map<string, number>();
    for (const feature of geoJson.features) {
      if (!visible.has(feature.properties?.id as number)) continue;
      const color =
        colorMap[feature.properties?.sport_type as keyof typeof colorMap] ?? '#000000';
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      selected.push({ color, coordinates: (feature.geometry as LineString).coordinates });
    }
    // Draw the most common category first so rarer ones stay visible on top.
    selected.sort((a, b) => colorCounts.get(b.color)! - colorCounts.get(a.color)!);
    return projectRoutes(selected);
  }, [geoJson, filterIDs]);

  const { current: mapRef } = useMap();
  const [pool, setPool] = useState<RouteHeatmapPool | null>(null);
  useEffect(() => {
    const created = new RouteHeatmapPool();
    setPool(created);
    return () => created.terminate();
  }, []);

  // Tiles are cached per source by tile ID only, so a filter change swaps in
  // a fresh source: clearing tiles in place lets mapbox resurrect stale
  // ones from its internal cache.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !pool) return;
    pool.setRoutes(routes);
    map.addSource(SOURCE_ID, {
      type: 'custom',
      tileSize: TILE_SIZE,
      maxzoom: 18,
      loadTile: (tile: { z: number; x: number; y: number }, { signal }: { signal: AbortSignal }) =>
        pool.drawTile(tile, signal),
    } as unknown as Parameters<typeof map.addSource>[1]);
    map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      paint: { 'raster-fade-duration': 0 },
    });
    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [mapRef, pool, routes]);

  return null;
});
