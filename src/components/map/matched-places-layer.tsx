'use client';

import type { FeatureCollection, Point } from 'geojson';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Layer, Popup, Source, useMap } from 'react-map-gl/mapbox';

import { useSelectedActivityPlaces } from '~/hooks/use-activity-places';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import type { Activity } from '~/lib/activity';
import {
  MATCHED_PLACES_HIT_LAYER,
  placeKindLabel,
} from '~/lib/activity-places';
import { measurementScale, measurementUnit } from '~/lib/units';
import { useActivityPlaceFocus } from '~/store/activity-place-focus';

import Overlay from './overlay';

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
          color:
            place.id === selected?.id ||
            place.activityIds.includes(String(highlighted))
              ? '#f97316'
              : '#0f766e',
        },
      })),
    }),
    [query.places, selected?.id, highlighted],
  );
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
  if (!query.userId || !selectedIds.length) return null;
  return (
    <>
      {(query.isLoading || query.isError) && (
        <Overlay position="bottom-left">
          <div
            role="status"
            className="flex items-center gap-2 rounded bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
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
              'Finding places…'
            )}
          </div>
        </Overlay>
      )}
      <Source
        id="matched-places"
        type="geojson"
        data={data}
        attribution='<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
      >
        <Layer
          id="matched-places-points"
          type="circle"
          paint={{
            'circle-radius': 6,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          }}
        />
        <Layer
          id="matched-places-labels"
          type="symbol"
          minzoom={10}
          layout={{
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-anchor': 'top',
            'text-offset': [0, 0.8],
          }}
          paint={{
            'text-color': '#111827',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
          }}
        />
        <Layer
          id={MATCHED_PLACES_HIT_LAYER}
          type="circle"
          paint={{ 'circle-radius': 22, 'circle-opacity': 0 }}
        />
      </Source>
      {selected && (
        <Popup
          className="text-black"
          longitude={selected.longitude}
          latitude={selected.latitude}
          closeOnClick={false}
          onClose={() => useActivityPlaceFocus.setState({ focus: null })}
          maxWidth="260px"
        >
          <div className="space-y-1 p-1 text-sm text-black" data-map-place>
            <div className="font-medium">{selected.name}</div>
            <div className="text-xs">
              {placeKindLabel(selected)}
              {selected.elevationM !== null &&
                ` · ${Math.round(selected.elevationM / measurementScale('elevation', units)).toLocaleString()} ${measurementUnit('elevation', units)}`}
            </div>
            <div className="text-xs text-gray-600">
              Matched on{' '}
              {selected.activityIds.length === 1
                ? 'this route'
                : `${selected.activityIds.length} selected routes`}
            </div>
          </div>
        </Popup>
      )}
    </>
  );
});
