'use client';

import type { FeatureCollection, Point } from 'geojson';
import { Clock, Loader2, MapPin, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Marker, Popup, Source, useMap } from 'react-map-gl/mapbox';

import { PlaceSymbol } from '~/components/place-symbol';
import { useSelectedActivityPlaces } from '~/hooks/use-activity-places';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import type { Activity } from '~/lib/activity';
import { MATCHED_PLACES_HIT_LAYER } from '~/lib/activity-places';
import {
  groupMapPlaces,
  mapPlaceClusterKind,
  mapPlacePolicy,
} from '~/lib/map-places';
import type { MapPointGroup } from '~/lib/map-point-groups';
import {
  type PlaceKind,
  placeSymbolId,
  placeSymbolImage,
  primaryPlaceKind,
} from '~/lib/place-symbols';
import { measurementScale, measurementUnit } from '~/lib/units';
import { useShallowStore } from '~/store';
import { useActivityPlaceFocus } from '~/store/activity-place-focus';

import { MapMarkerPin } from './map-marker-pin';

const noActivityIds: number[] = [];

export const MatchedPlacesLayer = memo(function MatchedPlacesLayer({
  activities,
  selectedIds,
  visibleIds = noActivityIds,
  showAllPlaces = false,
  inspectedActivityId,
  onPickActivities,
  highlighted,
}: {
  activities: ReadonlyMap<number, Activity>;
  selectedIds: number[];
  visibleIds?: number[];
  showAllPlaces?: boolean;
  inspectedActivityId?: number;
  onPickActivities?: (ids: number[]) => void;
  highlighted: number;
}) {
  const query = useSelectedActivityPlaces(
    activities,
    selectedIds,
    showAllPlaces ? visibleIds : noActivityIds,
  );
  const filterPlaceId = useShallowStore((state) =>
    state.place?.userId === query.userId ? state.place?.id : undefined,
  );
  // The place filter has its own pin.
  const places = useMemo(
    () =>
      filterPlaceId
        ? query.places.filter((place) => place.id !== filterPlaceId)
        : query.places,
    [query.places, filterPlaceId],
  );
  const { focus, setFocus } = useActivityPlaceFocus();
  const { current: map } = useMap();
  const handledFocus = useRef(0);
  const units = useDisplayUnits();
  const [layout, setLayout] = useState<{
    userId?: string;
    groups: MapPointGroup[];
  }>({ groups: [] });
  const groups = layout.userId === query.userId ? layout.groups : [];
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(places.map((place) => [place.id, place])),
    [places],
  );
  const selected =
    focus && focus.userId === query.userId
      ? places.find(
          (place) =>
            place.id === focus.placeId &&
            place.activityIds.includes(focus.activityId),
        )
      : undefined;
  useEffect(() => {
    if (!map || !showAllPlaces) return;
    const raw = map.getMap();
    const refresh = () => {
      const { clientWidth: width, clientHeight: height } = raw.getContainer();
      const center = raw.getCenter().lng;
      const points = places.map((place) => {
        const longitude =
          place.longitude + 360 * Math.round((center - place.longitude) / 360);
        const point = raw.project([longitude, place.latitude]);
        return { id: place.id, x: point.x, y: point.y };
      });
      const next = {
        userId: query.userId,
        groups: groupMapPlaces(points, { width, height }, selected?.id),
      };
      setLayout((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    refresh();
    raw.on('load', refresh);
    raw.on('style.load', refresh);
    raw.on('moveend', refresh);
    raw.on('resize', refresh);
    return () => {
      raw.off('load', refresh);
      raw.off('style.load', refresh);
      raw.off('moveend', refresh);
      raw.off('resize', refresh);
    };
  }, [map, showAllPlaces, places, query.userId, selected?.id]);
  const displayedPlaces = showAllPlaces
    ? groups
        .filter((group) => group.pointIDs.length === 1)
        .flatMap((group) => byId.get(group.id) ?? [])
    : places;
  const openGroup = showAllPlaces
    ? groups.find(
        (group) =>
          `${query.userId}:${group.id}` === openGroupId &&
          group.pointIDs.length > 1,
      )
    : undefined;
  const groupAnchor = openGroup ? byId.get(openGroup.id) : undefined;
  const focusedGroup = selected
    ? groups.find((group) => group.id === selected.id)
    : undefined;
  const openPlace = useCallback(
    (id: string) => {
      const place = byId.get(id);
      if (!place || !query.userId) return;
      setOpenGroupId(null);
      const inspectedVisit = place.activityIds.includes(
        String(inspectedActivityId),
      )
        ? String(inspectedActivityId)
        : undefined;
      // Looking up a place along the open activity should not replace its
      // detail with every other activity that happened to visit the same place.
      if (showAllPlaces && !inspectedVisit)
        onPickActivities?.(place.activityIds.map(Number));
      if (useActivityPlaceFocus.getState().focus?.placeId === place.id) {
        useActivityPlaceFocus.setState({ focus: null });
        return;
      }
      setFocus({
        userId: query.userId,
        activityId:
          inspectedVisit ??
          (place.activityIds.includes(String(highlighted))
            ? String(highlighted)
            : place.activityIds[0]!),
        placeId: place.id,
        visitIndex: 0,
        source: 'map',
      });
    },
    [
      byId,
      query.userId,
      highlighted,
      setFocus,
      showAllPlaces,
      inspectedActivityId,
      onPickActivities,
    ],
  );
  const data = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: displayedPlaces.map((place) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [place.longitude, place.latitude],
        },
        properties: {
          id: place.id,
          name: place.name,
          kind: primaryPlaceKind(place),
          icon: placeSymbolId(
            primaryPlaceKind(place),
            place.id === selected?.id,
          ),
        },
      })),
    }),
    [displayedPlaces, selected?.id],
  );
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const ids = [
      'matched-places-points',
      'matched-places-labels',
      MATCHED_PLACES_HIT_LAYER,
    ];
    const raise = () => {
      const layers = raw.getStyle()?.layers;
      if (!layers || !ids.every((id) => raw.getLayer(id))) return;
      // Route layers can be re-added after a style switch. Keep symbols above them.
      if (
        layers
          .slice(-ids.length)
          .every((layer, index) => layer.id === ids[index])
      )
        return;
      for (const id of ids) raw.moveLayer(id);
    };
    raw.on('idle', raise);
    return () => {
      raw.off('idle', raise);
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const register = () => {
      for (const kind of ['peak', 'pass', 'hut'] as PlaceKind[])
        for (const active of [false, true]) {
          const id = placeSymbolId(kind, active);
          const image = placeSymbolImage(kind, active);
          if (raw.hasImage(id)) raw.updateImage(id, image);
          else raw.addImage(id, image, { pixelRatio: 2 });
        }
    };
    const missing = (event: { id: string }) => {
      if (event.id.startsWith('matched-place-')) register();
    };
    if (raw.isStyleLoaded()) register();
    raw.on('style.load', register);
    raw.on('styleimagemissing', missing);
    const themeObserver = new MutationObserver(() => {
      if (raw.isStyleLoaded()) register();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => {
      raw.off('style.load', register);
      raw.off('styleimagemissing', missing);
      themeObserver.disconnect();
    };
  }, [map]);
  useEffect(() => {
    if (!map || !query.userId) return;
    const click = (event: mapboxgl.MapLayerMouseEvent) => {
      if (event.originalEvent.shiftKey) return;
      const id: unknown = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') openPlace(id);
    };
    map.on('click', MATCHED_PLACES_HIT_LAYER, click);
    return () => {
      map.off('click', MATCHED_PLACES_HIT_LAYER, click);
    };
  }, [map, query.userId, openPlace]);
  useEffect(() => {
    if (!focus || !selected || !map || handledFocus.current === focus.sequence)
      return;
    handledFocus.current = focus.sequence;
    if (focus.source === 'profile')
      map.easeTo({
        center: [selected.longitude, selected.latitude],
        zoom: Math.max(13, map.getZoom()),
        duration: 350,
      });
  }, [focus, selected, map]);
  useEffect(() => {
    if (!selected && !openGroup) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        useActivityPlaceFocus.setState({ focus: null });
        setOpenGroupId(null);
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [selected, openGroup]);
  if (!query.userId || (!selectedIds.length && !showAllPlaces)) return null;
  return (
    <>
      {(query.isLoading || query.awaitingCount > 0) && (
        <div className="absolute bottom-10 left-3 z-10 max-w-[calc(100%_-_1.5rem)]">
          <div
            role="status"
            className="flex items-center gap-2 rounded-full border border-border bg-popover/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
            data-map-place
            title={
              query.isLoading
                ? undefined
                : 'Places appear after these routes are checked and synced.'
            }
          >
            {query.isLoading ? (
              <>
                <Loader2
                  className="size-3 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                <span>Loading places</span>
              </>
            ) : (
              <>
                <Clock className="size-3" aria-hidden="true" />
                <span>
                  Places pending
                  {query.totalCount > 1
                    ? ' · ' +
                      (query.totalCount - query.awaitingCount) +
                      '/' +
                      query.totalCount +
                      ' checked'
                    : ''}
                </span>
              </>
            )}
          </div>
        </div>
      )}
      <Source
        id="matched-places"
        type="geojson"
        data={data}
        // Places come from OSM; Copernicus terrain decides which are listed.
        attribution='<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>, <a href="https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model" target="_blank">© DLR e.V. and Airbus, Copernicus programme</a>'
      >
        <Layer
          id="matched-places-points"
          type="symbol"
          layout={{
            'icon-image': ['get', 'icon'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          // Keep route places legible when terrain would otherwise hide them.
          paint={{ 'icon-occlusion-opacity': 1 }}
        />
        <Layer
          id="matched-places-labels"
          type="symbol"
          minzoom={showAllPlaces ? mapPlacePolicy.labelZoom : 10}
          layout={{
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-anchor': 'top',
            'text-offset': [0, 1.4],
          }}
          paint={{
            'text-color': '#111827',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
            'text-occlusion-opacity': 1,
          }}
        />
        <Layer
          id={MATCHED_PLACES_HIT_LAYER}
          type="symbol"
          layout={{
            'icon-image': ['get', 'icon'],
            // Sprites occupy 32 logical pixels, including transparent padding.
            'icon-size': 44 / 32,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          paint={{ 'icon-opacity': 0, 'icon-occlusion-opacity': 1 }}
        />
      </Source>
      {showAllPlaces &&
        groups
          .filter((group) => group.pointIDs.length > 1)
          .map((group) => {
            const anchor = byId.get(group.id);
            if (!anchor) return null;
            const kind = mapPlaceClusterKind(
              group.pointIDs.flatMap((id) => byId.get(id) ?? []),
            );
            return (
              <Marker
                key={group.id}
                longitude={anchor.longitude}
                latitude={anchor.latitude}
                anchor="center"
                offset={
                  focusedGroup &&
                  Math.hypot(
                    group.x - focusedGroup.x,
                    group.y - focusedGroup.y,
                  ) < mapPlacePolicy.pinSpacing
                    ? [40, 24]
                    : undefined
                }
                onClick={(event) => event.originalEvent.stopPropagation()}
              >
                <button
                  type="button"
                  data-map-place
                  data-place-cluster={group.id}
                  aria-label={`Explore ${group.pointIDs.length} visited places`}
                  className="flex size-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!map) return;
                    if (map.getZoom() >= 18) {
                      setOpenGroupId(`${query.userId}:${group.id}`);
                      return;
                    }
                    setOpenGroupId(null);
                    map.easeTo({
                      center: [anchor.longitude, anchor.latitude],
                      zoom: Math.min(18, map.getZoom() + 2),
                      duration: 450,
                    });
                  }}
                >
                  <MapMarkerPin
                    count={group.pointIDs.length}
                    data-place-cluster-kind={kind}
                  >
                    {kind === 'mixed' ? (
                      <MapPin size={14} aria-hidden="true" />
                    ) : (
                      <PlaceSymbol kind={kind} className="size-[22px]" />
                    )}
                  </MapMarkerPin>
                </button>
              </Marker>
            );
          })}
      {openGroup && groupAnchor && (
        <Popup
          className="matched-place-popup"
          longitude={groupAnchor.longitude}
          latitude={groupAnchor.latitude}
          closeButton={false}
          closeOnClick={false}
          offset={18}
          maxWidth="260px"
          onClose={() => setOpenGroupId(null)}
        >
          <div data-map-place className="w-56 p-2 text-popover-foreground">
            <div className="flex items-center justify-between pl-2 text-xs font-semibold">
              {openGroup.pointIDs.length} visited places
              <button
                type="button"
                aria-label="Close places"
                className="flex size-11 items-center justify-center"
                onClick={() => setOpenGroupId(null)}
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {openGroup.pointIDs.map((id) => {
                const place = byId.get(id);
                return place ? (
                  <button
                    key={id}
                    type="button"
                    onClick={() => openPlace(id)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-ring"
                  >
                    <PlaceSymbol
                      kind={primaryPlaceKind(place)}
                      className="size-4 shrink-0"
                    />
                    {place.name}
                  </button>
                ) : null;
              })}
            </div>
          </div>
        </Popup>
      )}
      {selected && (
        <Popup
          className="matched-place-popup"
          closeButton={false}
          focusAfterOpen={false}
          offset={14}
          longitude={selected.longitude}
          latitude={selected.latitude}
          closeOnClick={false}
          onClose={() => useActivityPlaceFocus.setState({ focus: null })}
          maxWidth="220px"
        >
          <div
            className="flex max-w-[220px] items-center pl-3 text-popover-foreground"
            data-map-place
          >
            <div className="max-w-40 min-w-0 py-2">
              <div
                className="line-clamp-2 text-xs leading-snug font-semibold break-words"
                style={{ color: 'var(--activity-accent)' }}
              >
                {selected.name}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {selected.elevationM !== null &&
                  Math.round(
                    selected.elevationM / measurementScale('elevation', units),
                  ).toLocaleString() +
                    ' ' +
                    measurementUnit('elevation', units)}
                {selected.activityIds.length > 1 && (
                  <>
                    {selected.elevationM !== null ? ' · ' : ''}
                    <span>
                      {selected.activityIds.length}{' '}
                      {showAllPlaces ? 'activities' : 'selected routes'}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close place"
              className="group flex size-11 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground"
              onClick={() => useActivityPlaceFocus.setState({ focus: null })}
            >
              <span className="flex size-6 items-center justify-center rounded-md group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring">
                <X className="size-3" aria-hidden="true" />
              </span>
            </button>
          </div>
        </Popup>
      )}
    </>
  );
});
