'use client';

import {
  useState,
  useCallback,
  useMemo,
  type FC,
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
  type SkyLayer,
  MapboxMap,
} from 'react-map-gl/mapbox';

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
import { useShallow } from 'zustand/shallow';

import Overlay from '~/components/map/Overlay';

import 'mapbox-gl/dist/mapbox-gl.css';

import { useStore } from '~/contexts/Zustand';

import { type CustomLayerProps, mapSettings } from '~/settings/map';
import { categorySettings } from '~/settings/category';

import { Download } from '~/components/map/DownloadControl';
import { Selection } from '~/components/map/SelectionControl';
import { LayerSwitcher } from '~/components/map/LayerSwitcher';
import PhotoLayer from '~/components/map/Photo';
import { cn } from '~/lib/utils';
import { map } from 'd3';

function RouteLayer() {
  const { filterIDs } = useStore(
    useShallow((state) => ({
      filterIDs: state.filterIDs,
    })),
  );
  const { selected, highlighted, geoJson } = useStore(
    useShallow((state) => ({
      selected: state.selected,
      highlighted: state.highlighted,
      geoJson: state.geoJson,
    })),
  );

  const color: mapboxgl.Expression = ['match', ['get', 'sport_type']];
  Object.entries(categorySettings).forEach(([, value]) => {
    value.alias.forEach((alias) => {
      color.push(alias, value.color);
    });
  });
  color.push('#000000');

  const filter = ['in', 'id', ...filterIDs];
  const selectedFilter = ['in', 'id', ...selected];
  const unselectedFilter = ['!in', 'id', ...selected];
  const filterAll = ['all', filter, unselectedFilter];
  const filterSel = ['all', filter, selectedFilter];
  const filterHigh = ['==', 'id', highlighted];
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
}

function Map() {
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
  } = useStore(
    useShallow((state) => ({
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
    })),
  );
  const { open } = useSidebar();
  const mapRefLoc = createRef<MapRef>();

  useEffect(() => {
    const map = mapRefLoc.current?.getMap();
    if (map) {
      setTimeout(() => map.resize(), 200);
    }
  }, [open]);

  const loaded = useStore(useShallow((state) => state.loaded));
  const [viewport, setViewport] = useState(mapPosition);

  const overlayMaps = useMemo(
    () => (
      <>
        {overlays.map((mapName) => {
          const mapSetting = mapSettings[mapName];
          if (mapSetting == undefined) return;
          if (mapSetting.type == 'custom') {
            const CustomLayer: FC<CustomLayerProps> = mapSetting.component;
            return <CustomLayer key={mapName} mapRef={mapRefLoc} />;
          } else
            return (
              <Source
                key={mapName + 'source'}
                id={mapName}
                type="raster"
                tiles={[mapSetting.url]}
                tileSize={256}
              >
                <Layer
                  key={mapName + 'layer'}
                  id={mapName}
                  type="raster"
                  paint={{
                    'raster-opacity':
                      'opacity' in mapSetting ? mapSetting.opacity! : 1,
                  }}
                />
              </Source>
            );
        })}
      </>
    ),
    [overlays, mapRefLoc],
  );

  const mapSettingBase = mapSettings[baseMap]!;
  const rows = selected
    .map((key) => activityDict[key])
    .filter((x) => x != undefined);

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
          if (mapRefLoc.current) {
            setPosition(viewState, mapRefLoc.current.getMap().getBounds());
          }
        }}
        onLoad={() => {
          mapRefLoc.current?.loadImage(
            'https://docs.mapbox.com/mapbox-gl-js/assets/pattern-dot.png',
            (error, image) => {
              if (error) throw error;
              if (mapRefLoc.current) {
                if (!mapRefLoc.current.getMap().hasImage('pattern-dot'))
                  mapRefLoc.current.getMap().addImage('pattern-dot', image);
              }
            },
          );
        }}
        //optimizeForTerrain={true}
        //onLoad={(event: MapboxEvent) => console.log(event)}
        projection={'globe' as unknown as mapboxgl.Projection}
        mapStyle={
          mapSettingBase.type === 'vector' ? mapSettingBase.url : undefined
        }
        terrain={{
          source: 'mapbox-dem',
          exaggeration: threeDim ? 1.5 : 0,
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        cursor={cursor}
        interactiveLayerIds={['routeLayerBG', 'routeLayerBGsel']}
      >
        {mapSettingBase != undefined && mapSettingBase.type == 'raster' && (
          <Source type="raster" tiles={[mapSettingBase.url]} tileSize={256}>
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
        {overlayMaps}
        {loaded && <RouteLayer />}
        {loaded && showPhotos && <PhotoLayer />}
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
          {...compactList}
        />
      </div>
    </div>
  );
}

export default Map;
