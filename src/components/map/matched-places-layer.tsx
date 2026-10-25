'use client';

import type { FeatureCollection, Point } from 'geojson';
import { Loader2, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Layer, Popup, Source, useMap } from 'react-map-gl/mapbox';

import { useSelectedActivityPlaces } from '~/hooks/use-activity-places';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import type { Activity } from '~/lib/activity';
import { MATCHED_PLACES_HIT_LAYER } from '~/lib/activity-places';
import {
  type PlaceKind,
  placeSymbolId,
  placeSymbolImage,
  primaryPlaceKind,
} from '~/lib/place-symbols';
import { measurementScale, measurementUnit } from '~/lib/units';
import { useActivityPlaceFocus } from '~/store/activity-place-focus';

export const MatchedPlacesLayer = memo(function MatchedPlacesLayer({
  activities,
  selectedIds,
  highlighted,
}: {
  activities: ReadonlyMap<number, Activity>;
  selectedIds: number[];
  highlighted: number;
}) {
  const query = useSelectedActivityPlaces(activities, selectedIds);
  const { focus, setFocus } = useActivityPlaceFocus();
  const { current: map } = useMap();
  const handledFocus = useRef(0);
  const units = useDisplayUnits();
  const selected =
    focus && focus.userId === query.userId
      ? query.places.find(
          (place) =>
            place.id === focus.placeId &&
            place.activityIds.includes(focus.activityId),
        )
      : undefined;
  const data = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: query.places.map((place) => ({
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
    [query.places, selected?.id],
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
      const place = query.places.find((place) => place.id === id);
      if (!place) return;
      const activityId = place.activityIds.includes(String(highlighted))
        ? String(highlighted)
        : place.activityIds[0]!;
      if (useActivityPlaceFocus.getState().focus?.placeId === place.id) {
        useActivityPlaceFocus.setState({ focus: null });
        return;
      }
      setFocus({
        userId: query.userId!,
        activityId,
        placeId: place.id,
        visitIndex: 0,
        source: 'map',
      });
    };
    map.on('click', MATCHED_PLACES_HIT_LAYER, click);
    return () => {
      map.off('click', MATCHED_PLACES_HIT_LAYER, click);
    };
  }, [map, query.places, query.userId, highlighted, setFocus]);
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
    if (!selected) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        useActivityPlaceFocus.setState({ focus: null });
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [selected]);
  if (!query.userId || !selectedIds.length) return null;
  return (
    <>
      {(query.isLoading || query.isError) && (
        <div className="absolute bottom-10 left-3 z-10 max-w-[calc(100%_-_1.5rem)]">
          <div
            role="status"
            className="flex items-center gap-2 rounded-full border border-border bg-popover/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
            data-map-place
          >
            {query.isError ? (
              <>
                Some places could not be loaded.{' '}
                <button
                  type="button"
                  className="text-foreground underline"
                  onClick={query.retry}
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <Loader2
                  className="size-3 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                <span>
                  Finding places
                  {query.totalCount > 1
                    ? ' · ' +
                      (query.totalCount - query.pendingCount) +
                      '/' +
                      query.totalCount
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
        attribution='<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
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
          minzoom={10}
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
                    <span>{selected.activityIds.length} selected routes</span>
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
