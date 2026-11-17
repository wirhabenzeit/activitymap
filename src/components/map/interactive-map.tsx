'use client';

import { ArrowLeft, Box } from 'lucide-react';
import {
  type ExpressionSpecification,
  type FilterSpecification,
  LngLat,
} from 'maplibre-gl';
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
} from 'react-map-gl/maplibre';

import { SelectionBar } from '~/components/activity-selection-controls';
import { ActivityCard, ActivityCardContent } from '~/components/list/card';
import { columns } from '~/components/list/columns';
import { DataTable } from '~/components/list/data-table';
import { usePrefetchStreamSummaries } from '~/components/list/elevation-chart';
import { LayerSwitcher } from '~/components/map/layer-switcher';
import { LegacySharingDisabledNotice } from '~/components/map/legacy-sharing-disabled-notice';
import { MapControlIconButton } from '~/components/map/map-control-icon-button';
import Overlay from '~/components/map/overlay';
import {
  PanelColumnMenu,
  panelColumnVisibility,
} from '~/components/map/panel-column-menu';
import { PanelResizeHandle } from '~/components/map/panel-resize-handle';
import PhotoLayer from '~/components/map/photo';
import { Selection } from '~/components/map/selection-control';
import { Button } from '~/components/ui/button';
import { useActivityGeoJsonFromActivities } from '~/hooks/use-activities';
import { useBaseMapStyle } from '~/hooks/use-base-map-style';
import { useBrowsingIDs } from '~/hooks/use-browsing-activities';
import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import { usePhotos } from '~/hooks/use-photos';
import type { Activity } from '~/lib/activity';
import { MATCHED_PLACES_HIT_LAYER } from '~/lib/activity-places';
import { sortActivities } from '~/lib/activity-presentation';
import { LEGACY_SHARING_ENABLED } from '~/lib/legacy-sharing';
import { syncBuildingExtrusions } from '~/lib/map-buildings';
import { transformMapRequest } from '~/lib/map-glyphs';
import { observeMapResize } from '~/lib/map-resize';
import { parseMapShareParams } from '~/lib/map-share';

import '~/lib/maplibre-worker';

import {
  TERRAIN_SOURCE_ID,
  mapSky,
  terrainFor,
  terrainSource,
} from '~/lib/map-style';
import { semanticAction } from '~/lib/presentation/icons';
import {
  canFrameRoute,
  routeBounds,
  routeCoordinates,
  routeFitPadding,
  routeFramingPolicy,
} from '~/lib/route-framing';
import { hasStoredLibraryAccess } from '~/lib/stored-library-access';
import { activityStreamMetadata } from '~/lib/sync/v1-mappers';
import { cn, groupBy } from '~/lib/utils';
import { categorySettings } from '~/settings/category';
import {
  type OverlaySetting,
  defaultMapPosition,
  overlayMaps,
} from '~/settings/map';
import { store } from '~/store';
import { useShallowStore } from '~/store';

import { ActivityPlacesLayers } from './activity-places-layers';
import { ElevationRouteMarker } from './elevation-route-marker';
import { PlaceFilterPin } from './place-filter-pin';

type OverlayMapId = keyof typeof overlayMaps;

/** Tilt applied by the 3D control (iOS requests the same pitch). */
const MAP_3D_PITCH = 50;
/** Any tilt above this counts as a 3D view, however the user reached it. */
const MAP_3D_PITCH_THRESHOLD = 1;

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

/**
 * Route line widths in px, mirroring iOS RouteLayers.swift. Every state keeps
 * the sport colour; selected and active add contrasting casings so the state
 * never depends on colour alone.
 */
const ROUTE_WIDTHS = {
  ordinary: 3,
  selectedCasing: 8,
  selected: 5,
  activeCasing: 12,
  activeHalo: 9,
  active: 6,
} as const;
const ROUTE_CASING = {
  selected: '#ffffff',
  halo: '#ffffff',
  active: '#000000',
};
const ROUTE_LINE_LAYOUT = {
  'line-join': 'round',
  'line-cap': 'round',
} as const;

/** Sport colour per route, black for unknown sport types. */
const sportColorExpression = (): ExpressionSpecification =>
  [
    'match',
    ['get', 'sport_type'],
    ...Object.values(categorySettings).flatMap((value) =>
      value.alias.flatMap((alias) => [alias, value.color]),
    ),
    '#000000',
  ] as unknown as ExpressionSpecification;

const RouteLayer = React.memo(function RouteLayer({
  activities,
  filterIDs,
  selected,
  highlighted,
}: {
  activities: Activity[];
  filterIDs: number[];
  selected: number[];
  highlighted: number;
}) {
  const geoJson = useActivityGeoJsonFromActivities(activities);

  const color = sportColorExpression();

  const filter: FilterSpecification = ['in', 'id', ...filterIDs];
  const selectedFilter: FilterSpecification = ['in', 'id', ...selected];
  const unselectedFilter: FilterSpecification = ['!in', 'id', ...selected];
  const filterAll: FilterSpecification = ['all', filter, unselectedFilter];
  const filterSel: FilterSpecification = ['all', filter, selectedFilter];
  const filterHigh: FilterSpecification = [
    'all',
    filter,
    ['==', 'id', highlighted],
  ];
  const line = (
    id: string,
    lineFilter: FilterSpecification,
    lineColor: ExpressionSpecification | string,
    width: number,
  ) => (
    <Layer
      source="routeSource"
      id={id}
      type="line"
      paint={{
        'line-color': lineColor,
        'line-width': width,
      }}
      layout={ROUTE_LINE_LAYOUT}
      filter={lineFilter}
    />
  );

  return (
    <Source data={geoJson} id="routeSource" type="geojson">
      {/* routeLayerBG / routeLayerBGsel double as the pick targets. */}
      {line('routeLayerBG', filterAll, color, ROUTE_WIDTHS.ordinary)}
      {line(
        'routeLayerBGsel',
        filterSel,
        ROUTE_CASING.selected,
        ROUTE_WIDTHS.selectedCasing,
      )}
      {line('routeLayerMIDsel', filterSel, color, ROUTE_WIDTHS.selected)}
      {line(
        'routeLayerHigh',
        filterHigh,
        ROUTE_CASING.active,
        ROUTE_WIDTHS.activeCasing,
      )}
      {line(
        'routeLayerHighHalo',
        filterHigh,
        ROUTE_CASING.halo,
        ROUTE_WIDTHS.activeHalo,
      )}
      {line('routeLayerHighFG', filterHigh, color, ROUTE_WIDTHS.active)}
    </Source>
  );
});

const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };
const NO_SUMMARY_ACTIVITIES: never[] = [];

/**
 * While the map is hidden behind another tab it keeps the last value it
 * showed, so library, filter and selection changes made elsewhere do not
 * re-tile routes nobody can see. It catches up once it is shown again.
 */
function useHeldWhileHidden<T>(value: T, active: boolean): T {
  const [held, setHeld] = useState(value);
  if (active && held !== value) setHeld(value);
  return active ? value : held;
}

/**
 * The browsing map. Under the app shell it stays mounted across Map/List/Stats
 * switches (see `PersistentMap`) and is told whether it is on screen through
 * `active`: rebuilding the route source on every visit cost ~1 s for a few
 * thousand activities.
 */
export default function InteractiveMap({
  active = true,
}: {
  active?: boolean;
}) {
  const searchParams = useSearchParams();
  const sharedMapState = useMemo(
    () => parseMapShareParams(searchParams),
    [searchParams],
  );
  const [cursor, setCursor] = useState('auto');
  // Pixel height set by dragging the panel handle; null keeps the default size.
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
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
    showPhotos,
    showPlaces,
    compactList,
    isGuest,
    guestModeType,
    summaryUserId,
    routeFitRequest,
    requestRouteFit,
    completeRouteFit,
    placeFlyRequest,
    completePlaceFly,
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
    showPlaces: state.showPlaces,
    compactList: state.compactList,
    isGuest: state.isGuest,
    guestModeType: state.guestMode.type,
    routeFitRequest: state.routeFitRequest,
    requestRouteFit: state.requestRouteFit,
    completeRouteFit: state.completeRouteFit,
    placeFlyRequest: state.placeFlyRequest,
    completePlaceFly: state.completePlaceFly,
    addNotification: state.addNotification,
    // Same conditions under which a route card shows its elevation profile.
    summaryUserId:
      !state.isGuest && hasStoredLibraryAccess(state.user)
        ? state.user?.id
        : undefined,
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
  usePrefetchStreamSummaries(
    active ? selectedSummaryActivities : NO_SUMMARY_ACTIVITIES,
    summaryUserId,
  );
  const mapRefLoc = useRef<MapRef>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement>(null);
  // A new selection starts at the default size, not at the last dragged height.
  const hasSelection = selected.length > 0;
  const [hadSelection, setHadSelection] = useState(hasSelection);
  if (hasSelection !== hadSelection) {
    setHadSelection(hasSelection);
    if (!hasSelection) setPanelHeight(null);
  }
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
  // The controlled viewport mirrors every move/pitch event of the real map.
  const pitched = (viewport.pitch ?? 0) > MAP_3D_PITCH_THRESHOLD;

  const hasAutoCenteredOnLatest = useRef(false);
  const hasExplicitInitialView =
    !!routeFitRequest ||
    sharedMapState.hasPositionRequest ||
    !isDefaultViewState(mapPosition);

  useEffect(() => {
    if (!placeFlyRequest || !mapLoaded || !active) return;
    const map = mapRefLoc.current?.getMap();
    if (!map) return;
    // Centre the chosen place beside any results panel, close enough to see
    // the routes around it. The map is controlled: moving it only through the
    // map instance is undone by the next render, so set the viewport like the
    // route fit does.
    const panel = panelRef.current?.getBoundingClientRect();
    const padding = routeFitPadding(
      map.getContainer().getBoundingClientRect(),
      panel?.width && panel.height ? panel : null,
    );
    hasAutoCenteredOnLatest.current = true;
    // Let the camera helper place the point in the clear area, then apply the
    // result without map padding (see the route fit).
    const { longitude, latitude } = placeFlyRequest;
    const zoom = Math.min(Math.max(map.getZoom(), 13), 15);
    const camera = map.cameraForBounds(
      [
        [longitude - 0.00005, latitude - 0.00005],
        [longitude + 0.00005, latitude + 0.00005],
      ],
      {
        padding: padding ?? NO_PADDING,
        maxZoom: zoom,
        // The clear area's offset points along the screen, not north.
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
    );
    const center = camera?.center ? LngLat.convert(camera.center) : null;
    const target: ViewState = {
      longitude: center?.lng ?? longitude,
      latitude: center?.lat ?? latitude,
      zoom,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      padding: NO_PADDING,
    };
    setViewport(target);
    completePlaceFly(placeFlyRequest.id);
    // Controlled camera changes do not reliably emit onMoveEnd; persist the
    // view once React has applied it to the map.
    // The request is completed above, which re-runs this effect, so the loop
    // is bounded by its tries rather than cancelled by cleanup.
    let tries = 0;
    const record = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      if (
        bounds &&
        Math.abs(map.getZoom() - target.zoom) < 0.0001 &&
        Math.abs(center.lat - target.latitude) < 0.0001
      )
        setPosition(target, bounds);
      else if (++tries < 60) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  }, [placeFlyRequest, mapLoaded, active, completePlaceFly, setPosition]);

  useEffect(() => {
    // Fit only once the map is on screen: its results panel, whose size sets
    // the padding, is not rendered while hidden.
    if (!routeFitRequest || !mapLoaded || !active || activitiesPending) return;
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
          'Shrink results to leave room for the route, then try Fit again.',
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
            'The map is not ready to frame this route. Try Fit again once it has loaded.',
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
        finish('These activities have no GPS route to frame.');
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
        pitch: map.getPitch(),
        // cameraForBounds already folded the padding into center and zoom;
        // applying it to the map as well would offset the routes twice.
        padding: NO_PADDING,
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
    active,
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
    if (summaryUserId && visibleSelected.length)
      ids.push(MATCHED_PLACES_HIT_LAYER);

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
  }, [overlays, summaryUserId, visibleSelected.length]);

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

  const baseMapStyle = useBaseMapStyle(baseMap);

  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRefLoc.current?.getMap();
    if (!map) return;
    const sync = () => syncBuildingExtrusions(map, pitched);
    sync();
    map.on('style.load', sync);
    return () => {
      map.off('style.load', sync);
    };
  }, [mapLoaded, baseMapStyle, pitched]);

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
    () => panelColumnVisibility(compactList.columnVisibility),
    [compactList.columnVisibility],
  );
  const previousAction = semanticAction('previousActivity');
  const nextAction = semanticAction('nextActivity');
  // Fit keeps the catalog's frame glyph; it is not a panel-size control.
  const fitAction = semanticAction('fit');
  // Like iOS, Fit is unavailable when none of its targets has a route to frame.
  const fittableIDs = useMemo(
    () =>
      new Set(
        resultIds.filter((id) => {
          const activity = activityDict.get(id);
          return activity && canFrameRoute(routeCoordinates(activity));
        }),
      ),
    [resultIds, activityDict],
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
            aria-label={previousAction.label}
            disabled={detailIndex <= 0}
            onClick={() => openDetail(resultIds[detailIndex - 1]!)}
          >
            <previousAction.Icon className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={nextAction.label}
            disabled={detailIndex < 0 || detailIndex >= resultIds.length - 1}
            onClick={() => openDetail(resultIds[detailIndex + 1]!)}
          >
            <nextAction.Icon className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      {detailId === 0 && <PanelColumnMenu className="size-10" />}
      <Button
        size="icon"
        variant="ghost"
        className={detailId > 0 ? 'size-8' : 'size-10'}
        aria-label={fitLabel}
        title={fitLabel}
        disabled={!fitIds.some((id) => fittableIDs.has(id))}
        onClick={() => requestRouteFit(fitIds)}
      >
        <fitAction.Icon className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  const handleMapPick = useCallback((ids: number[]) => {
    const state = store.getState();
    const hits = state.pickActivities(ids);
    if (state.combineSelections && !hits.length) return;
    setDetailId(!state.combineSelections && hits.length === 1 ? hits[0]! : 0);
    setPanelHeight(null);
    setPickCount((count) => count + 1);
  }, []);

  // What the map layers draw; frozen while another tab is on screen.
  const shownActivities = useHeldWhileHidden(activities, active);
  const shownActivityDict = useHeldWhileHidden(activityDict, active);
  const shownVisibleIDs = useHeldWhileHidden(visibleIDs, active);
  const shownVisibleIDSet = useHeldWhileHidden(visibleIDSet, active);
  const shownVisibleSelected = useHeldWhileHidden(visibleSelected, active);
  const shownSelected = useHeldWhileHidden(selected, active);
  const shownHighlighted = useHeldWhileHidden(highlighted, active);
  const shownPhotos = useHeldWhileHidden(photos, active);

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
      {/* Mount once the first style is ready, so app layers never meet a
          glyph-less placeholder style. */}
      {baseMapStyle !== undefined && (
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
          projection="globe"
          mapStyle={baseMapStyle}
          transformRequest={transformMapRequest}
          sky={mapSky}
          terrain={terrainFor(threeDim)}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          cursor={cursor}
          interactiveLayerIds={activeInteractiveLayerIds}
        >
          <Source id={TERRAIN_SOURCE_ID} {...terrainSource} />
          <NavigationControl position="top-right" />
          <GeolocateControl position="top-right" />
          <FullscreenControl position="top-right" />
          <Selection onSelection={handleMapPick} />
          <Overlay position="top-left">
            <LayerSwitcher
              activities={shownActivityDict}
              visibleIds={shownVisibleIDs}
              photos={shownPhotos}
            />
          </Overlay>
          <Overlay position="top-left">
            <MapControlIconButton
              onClick={() => {
                // Terrain follows the control; the pressed state follows the
                // real tilt, so tilting with the compass control stays in sync.
                hydrateMapState({ threeDim: !pitched });
                mapRefLoc.current
                  ?.getMap()
                  .easeTo({ pitch: pitched ? 0 : MAP_3D_PITCH });
              }}
              aria-label="3D map"
              title="3D map"
              aria-pressed={pitched}
            >
              <Box color={pitched ? 'hsl(var(--header-background))' : 'gray'} />
            </MapControlIconButton>
          </Overlay>
          {overlayMapComponents}
          <RouteLayer
            activities={shownActivities}
            filterIDs={shownVisibleIDs}
            selected={shownSelected}
            highlighted={shownHighlighted}
          />
          <ElevationRouteMarker
            activities={shownActivityDict}
            visibleIDs={shownVisibleIDSet}
          />
          <ActivityPlacesLayers
            activities={shownActivityDict}
            selectedIds={shownVisibleSelected}
            visibleIds={shownVisibleIDs}
            showAllPlaces={showPlaces}
            inspectedActivityId={detailId || undefined}
            onPickActivities={handleMapPick}
            highlighted={shownHighlighted}
          />
          {showPhotos && (
            <PhotoLayer photos={shownPhotos} visibleIDs={shownVisibleIDs} />
          )}
          <PlaceFilterPin />
        </ReactMapGL>
      )}
      {active && selected.length > 0 && (
        <div
          ref={panelRef}
          id="map-route-panel"
          style={
            {
              '--selection-results-height': `${resultIds.length * 33 + 40}px`,
              height: panelHeight ?? undefined,
            } as React.CSSProperties
          }
          className={cn(
            'absolute right-2 bottom-2 z-10 flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg bg-background shadow-lg lg:right-5 lg:bottom-5 lg:max-h-[calc(100%-2.5rem)]',
            selected.length > 0 &&
              'left-2 lg:left-auto lg:w-[min(70vw,48rem)] [@media(min-width:650px)_and_(max-height:500px)]:left-auto [@media(min-width:650px)_and_(max-height:500px)]:w-[min(42vw,24rem)]',
          )}
        >
          <PanelResizeHandle
            panelRef={panelRef}
            height={panelHeight}
            onHeightChange={setPanelHeight}
          />
          {
            <SelectionBar
              filterIDs={filterIDs}
              activities={activities}
              showShare={detailId === 0}
              backButton={
                detailId > 0 ? (
                  <Button
                    ref={detailBackButtonRef}
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Back to selected activities"
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
              // List and detail share a stable footprint; only the handle changes it.
              // Once dragged, the panel owns the height and the table fills it.
              className={
                panelHeight !== null
                  ? 'min-h-0 flex-1'
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
