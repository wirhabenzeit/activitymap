'use client';

import React, {
  useState,
  useCallback,
  useMemo,
  createRef,
  useEffect,
} from 'react';
import { useSidebar } from '~/components/ui/sidebar';
import { Camera, Globe } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { columns } from '~/components/list/columns';

import ReactMapGL, {
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  Layer,
  Source,
  type MapRef,
} from 'react-map-gl/mapbox';
import type { SkyLayer } from 'mapbox-gl';

import { DataTable } from '~/components/list/data-table';

const skyLayer: SkyLayer = {
  id: 'sky',
  type: 'sky',
  paint: {
    'sky-type': 'atmosphere',
    'sky-atmosphere-sun': [0.0, 0.0],
    'sky-atmosphere-sun-intensity': 15,
  },
};
import { useShallowStore } from '~/store';

import Overlay from '~/components/map/Overlay';

import 'mapbox-gl/dist/mapbox-gl.css';

import { baseMaps, overlayMaps } from '~/settings/map';
import { categorySettings } from '~/settings/category';

import { Download } from '~/components/map/DownloadControl';
import { UploadControl } from '~/components/map/UploadControl';
import { Selection } from '~/components/map/SelectionControl';
import { LayerSwitcher } from '~/components/map/LayerSwitcher';
import PhotoLayer from '~/components/map/Photo';
import { cn, groupBy } from '~/lib/utils';

const RouteLayer = React.memo(function RouteLayer() {
  const { filterIDs, selected, highlighted, geoJson } = useShallowStore(
    (state) => ({
      filterIDs: state.filterIDs,
      selected: state.selected,
      highlighted: state.highlighted,
      geoJson: state.geoJson,
    }),
  );

  const color: mapboxgl.Expression = ['match', ['get', 'sport_type']];
  Object.entries(categorySettings).forEach(([, value]) => {
    value.alias.forEach((alias) => {
      color.push(alias, value.color);
    });
  });
  color.push('#000000');

  const filter: mapboxgl.FilterSpecification = ['in', 'id', ...filterIDs];
  const selectedFilter: mapboxgl.FilterSpecification = [
    'in',
    'id',
    ...selected,
  ];
  const unselectedFilter: mapboxgl.FilterSpecification = [
    '!in',
    'id',
    ...selected,
  ];
  const filterAll: mapboxgl.FilterSpecification = [
    'all',
    filter,
    unselectedFilter,
  ];
  const filterSel: mapboxgl.FilterSpecification = [
    'all',
    filter,
    selectedFilter,
  ];
  const filterHigh: mapboxgl.FilterSpecification = ['==', 'id', highlighted];

  return (
    <Source data={geoJson} id="routeSource" type="geojson">
      <Layer
        source="routeSource"
        id="routeLayerBG"
        type="line"
        paint={{ 'line-color': 'black', 'line-width': 4 }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterAll}
      />
      <Layer
        source="routeSource"
        id="routeLayerFG"
        type="line"
        paint={{ 'line-color': color, 'line-width': 2 }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterAll}
      />
      <Layer
        source="routeSource"
        id="routeLayerBGsel"
        type="line"
        paint={{ 'line-color': 'black', 'line-width': 6 }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterSel}
      />
      <Layer
        source="routeSource"
        id="routeLayerMIDsel"
        type="line"
        paint={{ 'line-color': color, 'line-width': 4 }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterSel}
      />
      <Layer
        source="routeSource"
        id="routeLayerFGsel"
        type="line"
        paint={{ 'line-color': 'white', 'line-width': 2 }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterSel}
      />
      <Layer
        source="routeSource"
        id="routeLayerHigh"
        type="line"
        paint={{
          'line-color': 'black',
          'line-pattern': 'pattern-dot',
          'line-width': 6,
        }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterHigh}
      />
    </Source>
  );
});

export default function MapPage() {
  const [cursor, setCursor] = useState('auto');
  const onMouseEnter = useCallback(() => setCursor('pointer'), []);
  const onMouseLeave = useCallback(() => setCursor('auto'), []);

  const {
    selected,
    activityDict,
    filterIDs,
    setSelected,
    baseMap,
    overlays,
    mapPosition,
    setPosition,
    threeDim,
    toggleThreeDim,
    showPhotos,
    togglePhotos,
    compactList,
    photos,
    uploadedGeoJson,
  } = useShallowStore((state) => ({
    selected: state.selected,
    setHighlighted: state.setHighlighted,
    activityDict: state.activityDict,
    setSelected: state.setSelected,
    filterIDs: state.filterIDs,
    baseMap: state.baseMap,
    overlays: state.overlayMaps,
    mapPosition: state.position,
    setPosition: state.setPosition,
    updateActivity: state.updateActivity,
    threeDim: state.threeDim,
    showPhotos: state.showPhotos,
    togglePhotos: state.togglePhotos,
    toggleThreeDim: state.toggleThreeDim,
    compactList: state.compactList,
    uploadedGeoJson: state.uploadedGeoJson,
    photos: state.photos,
  }));
  const { open } = useSidebar();
  const mapRefLoc = createRef<MapRef>();
  const columnFilters = [{ id: 'id', value: filterIDs }];

  useEffect(() => {
    const map = mapRefLoc.current?.getMap();
    if (map) {
      setTimeout(() => map.resize(), 200);
    }
  }, [open, mapRefLoc]);

  const [viewport, setViewport] = useState(mapPosition);

  // Collect all interactive layer IDs from active overlays
  const activeInteractiveLayerIds = useMemo(() => {
    const ids: string[] = ['routeLayerBG', 'routeLayerBGsel']; // Default interactive layers

    overlays.forEach((mapName) => {
      const mapSetting = overlayMaps[mapName];
      if (mapSetting?.interactiveLayerIds?.length) {
        ids.push(...mapSetting.interactiveLayerIds);
      }
    });

    return ids;
  }, [overlays]);

  const overlayMapComponents = useMemo(
    () => (
      <>
        {overlays.map((mapName) => {
          const mapSetting = overlayMaps[mapName];
          if (!mapSetting) return null;

          // Handle raster overlays
          if (mapSetting.type === 'raster') {
            return (
              <Source
                key={mapName + 'source'}
                id={mapName}
                type="raster"
                tiles={mapSetting.url ? [mapSetting.url] : []}
                tileSize={256}
              >
                <Layer
                  key={mapName + 'layer'}
                  id={mapName}
                  type="raster"
                  paint={{
                    'raster-opacity': mapSetting.opacity ?? 1,
                  }}
                />
              </Source>
            );
          }

          // Handle component overlays
          if (mapSetting.type === 'component') {
            const Component = mapSetting.component;
            return (
              <Component
                key={mapName + '-component'}
                {...(mapSetting.props ?? {})}
              />
            );
          }

          return null;
        })}
      </>
    ),
    [overlays],
  );

  const mapSettingBase = baseMaps[baseMap];

  const photoDict = useMemo(() => groupBy(photos, (photo) => photo.activity_id), [photos]);
  const rows = useMemo(() =>
    selected
      .map((key) => {
        const activity = activityDict[key];
        if (!activity) return undefined;
        return {
          ...activity,
          ...(key in photoDict && { photos: photoDict[key] }),
        };
      })
      .filter((x) => x != undefined),
    [selected, activityDict, photoDict]
  );

  return (
    <div className="relative h-full w-full">
      <ReactMapGL
        reuseMaps={true}
        ref={mapRefLoc}
        styleDiffing={false}
        boxZoom={false}
        {...viewport}
        onMove={({ viewState }) => setViewport(viewState)}
        onMoveEnd={({ viewState }) => {
          const map = mapRefLoc.current?.getMap();
          if (map) {
            const bounds = map.getBounds();
            if (bounds) {
              setPosition(viewState, bounds);
            }
          }
        }}
        onLoad={() => {
          const map = mapRefLoc.current?.getMap();
          if (map) {
            map.loadImage(
              'https://docs.mapbox.com/mapbox-gl-js/assets/pattern-dot.png',
              (error, image) => {
                if (error) throw error;
                if (image && !map.hasImage('pattern-dot')) {
                  map.addImage('pattern-dot', image);
                }
              },
            );
          }
        }}
        projection={'globe' as unknown as mapboxgl.Projection}
        mapStyle={
          mapSettingBase?.type === 'vector' ? mapSettingBase.url : undefined
        }
        terrain={{
          source: 'mapbox-dem',
          exaggeration: threeDim ? 1.5 : 0,
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        cursor={cursor}
        interactiveLayerIds={activeInteractiveLayerIds}
      >
        {mapSettingBase?.type === 'raster' && (
          <Source
            type="raster"
            tiles={mapSettingBase.url ? [mapSettingBase.url] : []}
            tileSize={128}
          >
            <Layer id="baseMap" type="raster" paint={{ 'raster-opacity': 1 }} />
          </Source>
        )}
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />
        <Layer {...skyLayer} />
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-right" />
        <FullscreenControl position="top-right" />
        <Overlay position="top-right">
          <Download />
        </Overlay>
        <Overlay position="top-right">
          <UploadControl />
        </Overlay>
        <Selection />
        <Overlay position="top-left">
          <LayerSwitcher />
        </Overlay>
        <Overlay position="top-left">
          <div className="z-1 h-[29px] w-[29px] rounded-md bg-white">
            <Button
              onClick={() => {
                toggleThreeDim();
                mapRefLoc.current
                  ?.getMap()
                  .easeTo({ pitch: threeDim ? 0 : 60 });
              }}
              className="[&_svg]:size-5"
            >
              <Globe
                className="mx-auto"
                color={threeDim ? 'hsl(var(--header-background))' : 'gray'}
              />
            </Button>
          </div>
        </Overlay>
        <Overlay position="top-left">
          <div className="z-1 h-[29px] w-[29px] rounded-md bg-white">
            <Button onClick={togglePhotos} className="[&_svg]:size-5">
              <Camera
                className="mx-auto"
                color={showPhotos ? 'hsl(var(--header-background))' : 'gray'}
              />
            </Button>
          </div>
        </Overlay>
        {overlayMapComponents}
        {uploadedGeoJson && (
          <Source id="uploaded-gpx" type="geojson" data={uploadedGeoJson}>
            <Layer
              id="uploaded-gpx-layer"
              type="line"
              paint={{
                'line-color': '#000',
                'line-width': 2,
                'line-opacity': 1.,
              }}
              layout={{
                'line-join': 'round',
                'line-cap': 'round',
              }}
            />
          </Source>
        )}
        <RouteLayer />
        {showPhotos && <PhotoLayer />}
      </ReactMapGL>
      <div
        className={cn(
          'z-10 absolute w-[80%] left-[10%] right-[10%] bottom-0 bg-background mb-10 rounded-lg shadow-lg overflow-hidden',
          { hidden: rows.length == 0 },
        )}
      >
        <DataTable
          className="max-h-64"
          columns={columns}
          data={rows}
          selected={selected}
          setSelected={setSelected}
          map={mapRefLoc}
          columnFilters={columnFilters}
          {...compactList}
        />
      </div>
    </div>
  );
}