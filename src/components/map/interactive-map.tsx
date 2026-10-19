'use client';

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Globe,
  Maximize2,
  Minimize2,
  Scan,
} from 'lucide-react';
import { LngLat, type SkyLayer } from 'mapbox-gl';
import { useSearchParams } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMapGL, {
  FullscreenControl,
  GeolocateControl,
  Layer,
  type MapRef,
  NavigationControl,
  Source,
  type ViewState,
} from 'react-map-gl/mapbox';

import { SelectionBar } from '~/components/activity-selection-controls';
import { ActivityCard, ActivityCardContent } from '~/components/list/card';
import { columns } from '~/components/list/columns';
import { DataTable } from '~/components/list/data-table';
import { usePrefetchStreamSummaries } from '~/components/list/elevation-chart';
import { Download } from '~/components/map/download-control';
import { LayerSwitcher } from '~/components/map/layer-switcher';
import { LegacySharingDisabledNotice } from '~/components/map/legacy-sharing-disabled-notice';
import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import Overlay from '~/components/map/overlay';
import PhotoLayer from '~/components/map/photo';
import { Selection } from '~/components/map/selection-control';
import { UploadControl } from '~/components/map/upload-control';
import { Button } from '~/components/ui/button';
import { useActivityGeoJsonFromActivities } from '~/hooks/use-activities';
import { useBrowsingIDs } from '~/hooks/use-browsing-activities';
import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import { usePhotos } from '~/hooks/use-photos';
import type { Activity } from '~/lib/activity';
import { sortActivities } from '~/lib/activity-presentation';
import { LEGACY_SHARING_ENABLED } from '~/lib/legacy-sharing';
import { observeMapResize } from '~/lib/map-resize';
import { parseMapShareParams } from '~/lib/map-share';
import {
  routeBounds,
  routeCoordinates,
  routeFitPadding,
  routeFramingPolicy,
} from '~/lib/route-framing';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import { cn, groupBy } from '~/lib/utils';
import { activityFields } from '~/settings/activity';
import { categorySettings } from '~/settings/category';
import {
  type OverlaySetting,
  baseMaps,
  defaultMapPosition,
  overlayMaps,
} from '~/settings/map';
import { store } from '~/store';
import { useShallowStore } from '~/store';

import { ElevationRouteMarker } from './elevation-route-marker';

const skyLayer: SkyLayer = {
  id: 'sky',
  type: 'sky',
  paint: {
    'sky-type': 'atmosphere',
    'sky-atmosphere-sun': [0.0, 0.0],
    'sky-atmosphere-sun-intensity': 15,
  },
};

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

const RouteLayer = React.memo(function RouteLayer({
  activities,
  filterIDs,
}: {
  activities: Activity[];
  filterIDs: number[];
}) {
  const { selected, highlighted } = useShallowStore((state) => ({
    selected: state.selected,
    highlighted: state.highlighted,
  }));

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
  const filterHigh: mapboxgl.FilterSpecification = [
    'all',
    filter,
    ['==', 'id', highlighted],
  ];

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
  const {
    query: { data: activities = [], isPending: activitiesPending },
    filterIDs,
    filterIDSet,
    byID: activityDict,
  } = useBrowsingLibrary();
  const visibleIDs = useBrowsingIDs(filterIDs);
  const visibleIDSet = useMemo(() => new Set(visibleIDs), [visibleIDs]);
  const { data: photos = [] } = usePhotos();

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
    compactList,
    uploadedGeoJson,
    isGuest,
    guestModeType,
    summaryUserId,
    routeFitRequest,
    requestRouteFit,
    completeRouteFit,
    addNotification,
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
    toggleThreeDim: state.toggleThreeDim,
    compactList: state.compactList,
    uploadedGeoJson: state.uploadedGeoJson,
    isGuest: state.isGuest,
    guestModeType: state.guestMode.type,
    routeFitRequest: state.routeFitRequest,
    requestRouteFit: state.requestRouteFit,
    completeRouteFit: state.completeRouteFit,
    addNotification: state.addNotification,
    // Same conditions under which a route card shows its elevation profile.
    summaryUserId:
      !state.isGuest && state.user?.stravaConnected ? state.user.id : undefined,
  }));
  const visibleSelected = useMemo(
    () => selected.filter((id) => filterIDSet.has(id) && activityDict.has(id)),
    [selected, filterIDSet, activityDict],
  );
  // Follow active changes only while inspecting details. Results can toggle
  // the highlighted route independently, just like the native results list.
  const [detailId, setDetailId] = useState(highlighted);
  const [previousHighlight, setPreviousHighlight] = useState(highlighted);
  if (previousHighlight !== highlighted) {
    setPreviousHighlight(highlighted);
    if (detailId) setDetailId(highlighted);
  } else if (
    !activitiesPending &&
    detailId &&
    (!selected.includes(detailId) || !filterIDSet.has(detailId))
  ) {
    setDetailId(0);
  }
  const selectedSummaryActivities = useMemo(
    () =>
      selected.flatMap((id) => {
        const activity = activityDict.get(id);
        return activity
          ? [{ id, streamsMetadata: activityStreamMetadata(activity) }]
          : [];
      }),
    [activityDict, selected],
  );
  usePrefetchStreamSummaries(selectedSummaryActivities, summaryUserId);
  const mapRefLoc = useRef<MapRef>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  useEffect(() => {
    // A reused map can fire load before React attaches its ref. Publish the
    // fixture bridge after commit so Map/List switches keep it available.
    if (
      mapLoaded &&
      process.env.NODE_ENV === 'development' &&
      window.__ACTIVITYMAP_GALLERY__
    ) {
      window.__ACTIVITYMAP_GALLERY_MAP__ = mapRefLoc.current?.getMap();
    }
  }, [mapLoaded]);
  const columnFilters = useMemo(
    () => [{ id: 'id', value: filterIDSet }],
    [filterIDSet],
  );
  const hydratedFromUrlRef = useRef(false);

  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRefLoc.current?.getMap();
    if (map) return observeMapResize(map);
  }, [mapLoaded]);

  const initialViewport = sharedMapState.patch.position ?? mapPosition;
  const [viewport, setViewport] = useState(initialViewport);
  const hasAutoCenteredOnLatest = useRef(false);
  const hasExplicitInitialView =
    !!routeFitRequest ||
    sharedMapState.hasPositionRequest ||
    !isDefaultViewState(mapPosition);

  useEffect(() => {
    if (!routeFitRequest || !mapLoaded || activitiesPending) return;
    const map = mapRefLoc.current?.getMap();
    if (!map) return;
    let frame = 0,
      lastLayout = '',
      stableSince = performance.now();
    const started = performance.now();
    const finish = (message?: string) => {
      if (message)
        addNotification({ type: 'info', title: 'Map camera', message });
      completeRouteFit(routeFitRequest.id);
    };
    // A pending navigation must not override a gesture begun by the user.
    const cancel = () => {
      cancelAnimationFrame(frame);
      finish();
    };
    const canvas = map.getCanvasContainer();
    canvas.addEventListener('pointerdown', cancel, { once: true });
    const fit = () => {
      const rect = map.getContainer().getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      const layout = JSON.stringify([rect.toJSON(), panel?.toJSON()]);
      if (layout !== lastLayout) {
        lastLayout = layout;
        stableSince = performance.now();
      }
      const padding = routeFitPadding(
        rect,
        panel?.width && panel.height ? panel : null,
      );
      if (
        map.isStyleLoaded() &&
        performance.now() - stableSince >= 200 &&
        !padding
      ) {
        finish(
          'Shrink results or collapse filters to leave room for the route, then try Fit again.',
        );
        return;
      }
      if (
        !map.isStyleLoaded() ||
        performance.now() - stableSince < 200 ||
        !padding
      ) {
        if (performance.now() - started > 15000) {
          finish(
            'The map is not ready to frame this route. Try Fit routes once it has loaded.',
          );
        } else frame = requestAnimationFrame(fit);
        return;
      }
      const targets = routeFitRequest.activityIDs.filter((id) =>
        filterIDSet.has(id),
      );
      const bounds = routeBounds(
        targets.flatMap((id) => {
          const activity = activityDict.get(id);
          return activity ? routeCoordinates(activity) : [];
        }),
      );
      if (!bounds) {
        finish('These activities have no visible GPS route to frame.');
        return;
      }
      // Read the destination geometry after the list-to-map navigation and
      // panel/sidebar layout have settled. This request is consumed once;
      // later panel expansion or resizing never moves the user's camera.
      map.resize();
      hasAutoCenteredOnLatest.current = true;
      const camera = map.cameraForBounds(bounds, {
        padding,
        maxZoom: routeFramingPolicy.maxZoom,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
      if (
        !camera?.center ||
        camera.zoom === undefined ||
        !Number.isFinite(camera.zoom)
      ) {
        finish(
          'The route could not be framed. Try again once the map has loaded.',
        );
        return;
      }
      const center = LngLat.convert(camera.center);
      const target: ViewState = {
        longitude: center.lng,
        latitude: center.lat,
        zoom: camera.zoom,
        bearing: camera.bearing ?? map.getBearing(),
        pitch: camera.pitch ?? map.getPitch(),
        padding,
      };
      setViewport(target);
      const record = () => {
        // Controlled camera changes do not reliably emit onMoveEnd. Persist
        // the fitted view only once React has applied it to the actual map.
        const actual = map.getCenter();
        const longitudeDelta = Math.abs(
          ((actual.lng - target.longitude + 540) % 360) - 180,
        );
        const bounds = map.getBounds();
        if (
          bounds &&
          Math.abs(map.getZoom() - target.zoom) < 0.0001 &&
          Math.abs(actual.lat - target.latitude) < 0.0001 &&
          longitudeDelta < 0.0001
        ) {
          setPosition(target, bounds);
          finish();
        } else if (performance.now() - started > 15000) {
          finish(
            'The camera did not finish framing this route. Please try again.',
          );
        } else frame = requestAnimationFrame(record);
      };
      frame = requestAnimationFrame(record);
    };
    frame = requestAnimationFrame(fit);
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', cancel);
    };
  }, [
    routeFitRequest,
    mapLoaded,
    activitiesPending,
    activityDict,
    filterIDSet,
    addNotification,
    completeRouteFit,
    setPosition,
  ]);

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
      visibleSelected
        .map((key) => {
          const activity = activityDict.get(key);
          if (!activity) return undefined;
          return {
            ...activity,
            ...(key in photoDict && { photos: photoDict[key] }),
          };
        })
        .filter((x) => x != undefined),
    [visibleSelected, activityDict, photoDict],
  );
  const resultIds = useMemo(
    () =>
      sortActivities(
        rows.filter((row) => filterIDSet.has(row.id)),
        compactList.sorting,
      ).map((row) => row.id),
    [rows, filterIDSet, compactList.sorting],
  );
  const detailIndex = resultIds.indexOf(detailId);
  const openDetail = (id: number) => {
    setHighlighted(id);
    setDetailId(id);
  };
  const mapColumns = useMemo(
    () =>
      columns.map((column) => {
        // Size columns to the panel instead of the list page's fixed minimums,
        // so the table never scrolls sideways on narrow screens.
        const meta = column.meta && {
          ...column.meta,
          width: column.id === 'name' ? 'minmax(0, 1fr)' : 'max-content',
          // Keep the name and its highlight control readable before
          // spending the remaining panel width on metric columns.
          ...(column.id === 'name' && { minWidth: 240 }),
        };
        return column.id === 'name'
          ? {
              ...column,
              meta,
              cell: ({
                row,
              }: {
                row: Parameters<typeof ActivityCard>[0]['row'];
              }) => (
                <ActivityCard
                  row={row}
                  showMapButton={false}
                  showHighlightButton
                />
              ),
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
  const panelControls = (fitIds: number[], fitLabel: string) => (
    <div className="flex shrink-0 items-center gap-0.5">
      {detailId > 0 && resultIds.length > 1 && (
        <div
          className="flex items-center"
          role="group"
          aria-label="Browse selected activities"
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Previous activity"
            disabled={detailIndex <= 0}
            onClick={() => openDetail(resultIds[detailIndex - 1]!)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Next activity"
            disabled={detailIndex < 0 || detailIndex >= resultIds.length - 1}
            onClick={() => openDetail(resultIds[detailIndex + 1]!)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      <Button
        size="icon"
        variant="ghost"
        className={detailId > 0 ? 'size-8' : 'size-10'}
        aria-label={fitLabel}
        title={fitLabel}
        onClick={() => requestRouteFit(fitIds)}
      >
        <Scan className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className={detailId > 0 ? 'size-8' : 'size-10'}
        aria-label={panelExpanded ? 'Shrink route panel' : 'Expand route panel'}
        title={panelExpanded ? 'Shrink route panel' : 'Expand route panel'}
        aria-expanded={panelExpanded}
        aria-controls="map-route-panel"
        onClick={() => setPanelExpanded((value) => !value)}
      >
        {panelExpanded ? (
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );

  // Part of #132: a visitor who arrived via a legacy `/map?user=`/
  // `/map?activities=` share link gets an explicit "no longer works"
  // message instead of a silently empty map - see
  // `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md §5. All hooks
  // above still run unconditionally; only the rendered output branches.
  if (!LEGACY_SHARING_ENABLED && isGuest) {
    return <LegacySharingDisabledNotice guestModeType={guestModeType} />;
  }

  return (
    <div
      className="relative h-full w-full"
      data-route-fit={routeFitRequest ? 'pending' : 'idle'}
    >
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
          setMapLoaded(true);
          tryAutoCenterOnLatestActivity();
        }}
        projection={'globe'}
        mapStyle={
          mapSettingBase?.type === 'vector' ? mapSettingBase.url : undefined
        }
        terrain={{ source: 'mapbox-dem', exaggeration: threeDim ? 1.5 : 0 }}
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
            const state = store.getState();
            const hits = state.pickActivities(ids);
            if (state.combineSelections && !hits.length) return;
            setDetailId(
              !state.combineSelections && hits.length === 1 ? hits[0]! : 0,
            );
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
        <RouteLayer activities={activities} filterIDs={visibleIDs} />
        <ElevationRouteMarker
          activities={activityDict}
          visibleIDs={visibleIDSet}
        />
        {showPhotos && <PhotoLayer photos={photos} visibleIDs={visibleIDs} />}
      </ReactMapGL>
      {selected.length > 0 && (
        <div
          ref={panelRef}
          id="map-route-panel"
          style={
            {
              '--selection-results-height': `${resultIds.length * 33 + 40}px`,
            } as React.CSSProperties
          }
          className={cn(
            'absolute right-2 bottom-2 z-10 flex flex-col overflow-hidden rounded-lg bg-background shadow-lg lg:right-5 lg:bottom-5',
            selected.length > 0 &&
              'left-2 lg:left-auto lg:w-[min(70vw,48rem)] [@media(min-width:650px)_and_(max-height:500px)]:left-auto [@media(min-width:650px)_and_(max-height:500px)]:w-[min(42vw,24rem)]',
          )}
        >
          {
            <SelectionBar
              filterIDs={filterIDs}
              backButton={
                detailId > 0 ? (
                  <Button
                    ref={detailBackButtonRef}
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Back to ${resultIds.length} ${resultIds.length === 1 ? 'route' : 'routes'}`}
                    title="Back to selected activities"
                    onClick={() => setDetailId(0)}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : undefined
              }
              controls={
                selected.length > 0
                  ? panelControls(
                      detailId > 0 ? [detailId] : resultIds,
                      detailId > 0 ? 'Fit route' : 'Fit selection',
                    )
                  : undefined
              }
            />
          }
          {selected.length > 0 && (
            <DataTable
              key={pickCount}
              // List and detail share a stable footprint; only the size control changes it.
              className={
                panelExpanded
                  ? 'h-[calc(65dvh+3rem)]'
                  : detailId
                    ? 'h-[min(43dvh,23rem)]'
                    : 'h-[min(43dvh,var(--selection-results-height))]'
              }
              scrollHint={detailId === 0}
              columns={mapColumns}
              data={rows}
              selected={selected}
              setSelected={setSelected}
              columnFilters={columnFilters}
              paginationControl={false}
              cellClassName="max-lg:px-2 max-lg:border-r-0"
              activeId={detailId}
              highlightedId={highlighted}
              onRowClick={(row) => openDetail(row.original.id)}
              onDetailBack={() => setDetailId(0)}
              detailBackButtonRef={detailBackButtonRef}
              renderDetails={(row) => (
                <ActivityCardContent
                  key={row.id}
                  activity={row.original}
                  stickyHeader
                  showMapButton={false}
                />
              )}
              {...compactList}
              columnVisibility={mapColumnVisibility}
            />
          )}
        </div>
      )}
    </div>
  );
}
