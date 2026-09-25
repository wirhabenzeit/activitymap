'use client';

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { useSidebar } from '~/components/ui/sidebar';
import { Camera, ChevronDown, ChevronUp, Globe } from 'lucide-react';
import { columns } from '~/components/list/columns';
import { ActivityCard, ActivityCardContent } from '~/components/list/card';
import { Button } from '~/components/ui/button';
import { activityFields } from '~/settings/activity';

import ReactMapGL, {
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  Layer,
  Source,
  type MapRef,
  type ViewState,
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

import Overlay from '~/components/map/overlay';

import 'mapbox-gl/dist/mapbox-gl.css';

import {
  baseMaps,
  defaultMapPosition,
  overlayMaps,
  type OverlaySetting,
} from '~/settings/map';
import { categorySettings } from '~/settings/category';
import { parseMapShareParams } from '~/lib/map-share';

import { Download } from '~/components/map/download-control';
import { UploadControl } from '~/components/map/upload-control';
import { Selection } from '~/components/map/selection-control';
import { LayerSwitcher } from '~/components/map/layer-switcher';
import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import PhotoLayer from '~/components/map/photo';
import { cn, groupBy } from '~/lib/utils';

import {
  useActivityGeoJsonFromActivities,
  useActivities,
} from '~/hooks/use-activities';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { usePhotos } from '~/hooks/use-photos';
import type { Activity } from '~/server/db/schema';
import { LEGACY_SHARING_ENABLED } from '~/lib/legacy-sharing';
import { LegacySharingDisabledNotice } from '~/components/map/legacy-sharing-disabled-notice';
import { useSearchParams } from 'next/navigation';

type OverlayMapId = keyof typeof overlayMaps;

const isDefaultViewState = (viewState: ViewState): boolean => {
  return (
    Math.abs(viewState.longitude - defaultMapPosition.longitude) < 1e-8 &&
    Math.abs(viewState.latitude - defaultMapPosition.latitude) < 1e-8 &&
    Math.abs(viewState.zoom - defaultMapPosition.zoom) < 1e-8 &&
    Math.abs((viewState.pitch ?? 0) - defaultMapPosition.pitch) < 1e-8 &&
    Math.abs((viewState.bearing ?? 0) - defaultMapPosition.bearing) < 1e-8
  );
};

const getOverlayMapSetting = (overlayId: OverlayMapId): OverlaySetting => {
  return overlayMaps[overlayId];
};

const RouteLayer = React.memo(function RouteLayer() {
  const { selected, highlighted } = useShallowStore((state) => ({
    selected: state.selected,
    highlighted: state.highlighted,
  }));

  const { data: activities = [] } = useActivities();
  const { filterIDs } = useFilteredActivities(activities);
  const geoJson = useActivityGeoJsonFromActivities(activities);

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
          'line-width': 9,
        }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
        filter={filterHigh}
      />
      <Layer
        source="routeSource"
        id="routeLayerHighFG"
        type="line"
        paint={{ 'line-color': '#f97316', 'line-width': 5 }}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        filter={filterHigh}
      />
    </Source>
  );
});

export default function InteractiveMap() {
  const searchParams = useSearchParams();
  const sharedMapState = useMemo(
    () => parseMapShareParams(searchParams),
    [searchParams],
  );
  const [cursor, setCursor] = useState('auto');
  const [panelExpanded, setPanelExpanded] = useState(false);
  // Bumped on every map pick so a new list starts scrolled to the top.
  const [pickCount, setPickCount] = useState(0);
  const onMouseEnter = useCallback(() => setCursor('pointer'), []);
  const onMouseLeave = useCallback(() => setCursor('auto'), []);

  // Fetch data via hooks
  const { data: activities = [] } = useActivities();
  const { data: photos = [] } = usePhotos();
  const { filterIDs } = useFilteredActivities(activities);

  // Memoize activity dictionary for efficient lookup
  const activityDict = useMemo(
    () =>
      activities.reduce(
        (acc, act) => {
          acc[act.id] = act;
          return acc;
        },
        {} as Record<number, Activity>,
      ),
    [activities],
  );

  const {
    selected,
    highlighted,
    setSelected,
    setHighlighted,
    baseMap,
    overlays,
    mapPosition,
    setPosition,
    hydrateMapState,
    threeDim,
    toggleThreeDim,
    showPhotos,
    togglePhotos,
    compactList,
    uploadedGeoJson,
    isGuest,
    guestModeType,
  } = useShallowStore((state) => ({
    selected: state.selected,
    highlighted: state.highlighted,
    setHighlighted: state.setHighlighted,
    setSelected: state.setSelected,
    baseMap: state.baseMap,
    overlays: state.overlayMaps,
    mapPosition: state.position,
    setPosition: state.setPosition,
    hydrateMapState: state.hydrateMapState,
    threeDim: state.threeDim,
    showPhotos: state.showPhotos,
    togglePhotos: state.togglePhotos,
    toggleThreeDim: state.toggleThreeDim,
    compactList: state.compactList,
    uploadedGeoJson: state.uploadedGeoJson,
    isGuest: state.isGuest,
    guestModeType: state.guestMode.type,
  }));
  const { open } = useSidebar();
  const mapRefLoc = useRef<MapRef>(null);
  const columnFilters = [{ id: 'id', value: filterIDs }];
  const hydratedFromUrlRef = useRef(false);

  useEffect(() => {
    const map = mapRefLoc.current?.getMap();
    if (map) {
      setTimeout(() => map.resize(), 200);
    }
  }, [open]);

  const initialViewport = sharedMapState.patch.position ?? mapPosition;
  const [viewport, setViewport] = useState(initialViewport);
  const hasAutoCenteredOnLatest = useRef(false);
  const hasExplicitInitialView =
    sharedMapState.hasPositionRequest || !isDefaultViewState(mapPosition);

  useEffect(() => {
    if (hydratedFromUrlRef.current || !sharedMapState.hasAnyMapParam) {
      return;
    }
    hydratedFromUrlRef.current = true;

    hydrateMapState(sharedMapState.patch);
  }, [hydrateMapState, sharedMapState]);

  const tryAutoCenterOnLatestActivity = useCallback(() => {
    if (hasAutoCenteredOnLatest.current) {
      return;
    }
    if (hasExplicitInitialView) {
      return;
    }

    const map = mapRefLoc.current?.getMap();
    if (!map) {
      return;
    }

    for (const activity of activities) {
      const coordinates = activity.start_latlng ?? activity.end_latlng;
      if (!coordinates || coordinates.length < 2) {
        continue;
      }

      const [latitude, longitude] = coordinates;
      if (
        typeof latitude !== 'number' ||
        typeof longitude !== 'number' ||
        Number.isNaN(latitude) ||
        Number.isNaN(longitude)
      ) {
        continue;
      }

      hasAutoCenteredOnLatest.current = true;
      map.jumpTo({
        center: [longitude, latitude],
        zoom: Math.max(map.getZoom(), 12),
      });
      return;
    }
  }, [activities, hasExplicitInitialView]);

  useEffect(() => {
    tryAutoCenterOnLatestActivity();
  }, [tryAutoCenterOnLatestActivity]);

  // Collect all interactive layer IDs from active overlays
  const activeInteractiveLayerIds = useMemo(() => {
    const ids: string[] = ['routeLayerBG', 'routeLayerBGsel']; // Default interactive layers

    overlays.forEach((mapName) => {
      const mapSetting = getOverlayMapSetting(mapName);
      const interactiveLayerIds = mapSetting.interactiveLayerIds;
      if (
        Array.isArray(interactiveLayerIds) &&
        interactiveLayerIds.length > 0
      ) {
        ids.push(...interactiveLayerIds);
      }
    });

    return ids;
  }, [overlays]);

  const overlayMapComponents = useMemo(
    () => (
      <>
        {overlays.map((mapName) => {
          const mapSetting = getOverlayMapSetting(mapName);
          if (!mapSetting) return null;

          // Handle raster overlays
          if (mapSetting.type === 'raster') {
            return (
              <Source
                key={mapName + 'source'}
                id={mapName}
                type="raster"
                tiles={[mapSetting.url]}
                tileSize={mapSetting.tileSize}
                attribution={mapSetting.attribution}
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

  const photoDict = useMemo(
    () => groupBy(photos, (photo) => photo.activity_id),
    [photos],
  );
  const rows = useMemo(
    () =>
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
    [selected, activityDict, photoDict],
  );
  const mapColumns = useMemo(
    () =>
      columns.map((column) => {
        // Size columns to the panel instead of the list page's fixed minimums,
        // so the table never scrolls sideways on narrow screens.
        const meta = column.meta && {
          ...column.meta,
          width: column.id === 'name' ? 'minmax(0, 1fr)' : 'max-content',
        };
        return column.id === 'name'
          ? {
              ...column,
              meta,
              cell: ({
                row,
              }: {
                row: Parameters<typeof ActivityCard>[0]['row'];
              }) => <ActivityCard row={row} map={mapRefLoc} inlineDetails />,
            }
          : { ...column, meta };
      }),
    [],
  );
  const mapColumnVisibility = useMemo(
    () => ({
      ...Object.fromEntries(
        Object.keys(activityFields).map((id) => [id, false]),
      ),
      id: false,
      description: false,
      photos: false,
      geometry_state: false,
      edit: false,
      name: true,
      distance: true,
      total_elevation_gain: true,
    }),
    [],
  );
  const clearSelection = () => {
    setSelected([]);
    setPanelExpanded(false);
  };

  // Part of #132: a visitor who arrived via a legacy `/map?user=`/
  // `/map?activities=` share link gets an explicit "no longer works"
  // message instead of a silently empty map - see
  // `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md §5. All hooks
  // above still run unconditionally; only the rendered output branches.
  if (!LEGACY_SHARING_ENABLED && isGuest) {
    return <LegacySharingDisabledNotice guestModeType={guestModeType} />;
  }

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
          tryAutoCenterOnLatestActivity();
        }}
        projection={'globe'}
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
            tiles={[mapSettingBase.url]}
            tileSize={mapSettingBase.tileSize}
            attribution={mapSettingBase.attribution}
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
        <Selection
          onSelection={(ids) => {
            setSelected(ids);
            setHighlighted(ids.length === 1 ? ids[0]! : 0);
            setPanelExpanded(false);
            setPickCount((count) => count + 1);
          }}
        />
        <Overlay position="top-left">
          <LayerSwitcher />
        </Overlay>
        <Overlay position="top-left">
          <MapControlIconButton
            onClick={() => {
              toggleThreeDim();
              mapRefLoc.current?.getMap().easeTo({ pitch: threeDim ? 0 : 60 });
            }}
            aria-label="Toggle 3D globe"
          >
            <Globe
              color={threeDim ? 'hsl(var(--header-background))' : 'gray'}
            />
          </MapControlIconButton>
        </Overlay>
        <Overlay position="top-left">
          <MapControlIconButton
            onClick={togglePhotos}
            aria-label="Toggle photos"
          >
            <Camera
              color={showPhotos ? 'hsl(var(--header-background))' : 'gray'}
            />
          </MapControlIconButton>
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
                'line-opacity': 1,
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
          'z-10 absolute left-2 right-2 bottom-2 lg:left-auto lg:right-5 lg:bottom-5 lg:w-[min(70vw,48rem)] bg-background rounded-lg shadow-lg overflow-hidden flex flex-col',
          { hidden: rows.length == 0 },
        )}
      >
        {selected.length > 1 && (
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
            <span className="font-semibold">Routes</span>
            <span className="text-muted-foreground">
              {selected.length} selected
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={clearSelection}
            >
              Clear selection
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={
                panelExpanded ? 'Collapse route panel' : 'Expand route panel'
              }
              onClick={() => setPanelExpanded(!panelExpanded)}
            >
              {panelExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
        <DataTable
          key={pickCount}
          className={
            // Only the chevron grows the list; opening a route's card keeps
            // the panel compact (card plus a few rows) instead.
            selected.length === 1
              ? 'max-h-[70vh]'
              : panelExpanded
                ? 'max-h-[65vh]'
                : highlighted !== 0
                  ? 'max-h-[min(60vh,24rem)]'
                  : 'max-h-[12.5rem]'
          }
          scrollHint
          columns={mapColumns}
          data={rows}
          selected={selected}
          setSelected={setSelected}
          map={mapRefLoc}
          columnFilters={columnFilters}
          paginationControl={false}
          activeId={highlighted}
          headerClassName="max-lg:hidden"
          cellClassName="max-lg:px-2 max-lg:border-r-0"
          onRowClick={(row) => setHighlighted(row.original.id)}
          renderInlineDetails={(row) => (
            <ActivityCardContent
              row={row}
              mapDetails
              onCollapse={() => setHighlighted(0)}
            />
          )}
          renderSingleDetails={(row) => (
            <ActivityCardContent
              row={row}
              mapDetails
              onClearSelection={clearSelection}
            />
          )}
          {...compactList}
          columnVisibility={mapColumnVisibility}
        />
      </div>
    </div>
  );
}
