'use client';

import type { FeatureCollection, Point } from 'geojson';
import { useEffect, useMemo, useState } from 'react';
import { Layer, Popup, Source, useMap } from 'react-map-gl/mapbox';

import { placeSourceUrl } from '~/contracts/visited-places';
import { useLivePlaces, useLivePlacesSettings } from '~/hooks/use-live-places';
import { useVisitedPlaces } from '~/hooks/use-visited-places';
import {
  PLACE_MATCH_COLORS,
  livePlaceRadii,
  livePlaceStatus,
  placeRadius,
} from '~/lib/live-place-radii';
import {
  VISITED_PLACES_HIT_LAYER,
  visibleVisitedPlaces,
  visitedPlaceKind,
} from '~/lib/visited-places';

import Overlay from './overlay';

export function VisitedPlacesLayer({
  visibleIDs,
  highlighted,
}: {
  visibleIDs: number[];
  highlighted: number;
}) {
  const query = useVisitedPlaces();
  const live = useLivePlaces();
  const thresholds = useLivePlacesSettings((state) => state.thresholds);
  const candidates = useMemo(
    () => visibleVisitedPlaces(live.data?.candidates ?? [], visibleIDs),
    [live.data, visibleIDs],
  );
  const radii = useMemo(
    () => livePlaceRadii(candidates, thresholds),
    [candidates, thresholds],
  );
  const { current: map } = useMap();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const places = useMemo(
    () =>
      live.active
        ? candidates
        : visibleVisitedPlaces(query.data ?? [], visibleIDs),
    [live.active, candidates, query.data, visibleIDs],
  );
  const selected = places.find((place) => place.id === selectedId);
  const selectedCandidate = candidates.find((place) => place.id === selectedId);
  const data = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: places.map((place) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [place.longitude, place.latitude],
        },
        properties: {
          id: place.id,
          name: place.name,
          highlighted: place.activityIds.includes(String(highlighted)),
          color: live.active
            ? PLACE_MATCH_COLORS[
                livePlaceStatus(
                  candidates.find((candidate) => candidate.id === place.id)!,
                )
              ]
            : place.activityIds.includes(String(highlighted))
              ? '#f97316'
              : '#0f766e',
        },
      })),
    }),
    [places, highlighted, live.active, candidates],
  );
  useEffect(() => {
    if (!map) return;
    const click = (event: mapboxgl.MapLayerMouseEvent) => {
      const id: unknown = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') setSelectedId(id);
    };
    map.on('click', VISITED_PLACES_HIT_LAYER, click);
    return () => {
      map.off('click', VISITED_PLACES_HIT_LAYER, click);
    };
  }, [map]);
  if (!query.enabled) return null;
  return (
    <>
      {query.isError && (
        <Overlay position="bottom-left">
          <div
            className="flex items-center gap-2 bg-background p-2 text-xs text-foreground"
            role="status"
          >
            Visited places unavailable.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </div>
        </Overlay>
      )}
      {live.active && (
        <Source id="live-place-radii" type="geojson" data={radii}>
          <Layer
            id="live-place-radii-fill"
            type="fill"
            paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 }}
          />
          <Layer
            id="live-place-radii-matched"
            type="line"
            filter={['==', ['get', 'status'], 'matched']}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 2,
              'line-opacity': 0.9,
            }}
          />
          <Layer
            id="live-place-radii-nearby"
            type="line"
            filter={['!=', ['get', 'status'], 'matched']}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 2,
              'line-dasharray': [3, 2],
              'line-opacity': 0.9,
            }}
          />
        </Source>
      )}
      <Source
        id="visited-places"
        type="geojson"
        data={data}
        attribution='<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
      >
        <Layer
          id="visited-places-points"
          type="circle"
          paint={{
            'circle-radius': ['case', ['get', 'highlighted'], 7, 5],
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          }}
        />
        <Layer
          id="visited-places-labels"
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
          id={VISITED_PLACES_HIT_LAYER}
          type="circle"
          paint={{ 'circle-radius': 14, 'circle-opacity': 0 }}
        />
      </Source>
      {selected && (
        <Popup
          longitude={selected.longitude}
          latitude={selected.latitude}
          closeOnClick={false}
          onClose={() => setSelectedId(null)}
          maxWidth="260px"
        >
          <div
            className="space-y-1 p-1 text-sm text-black"
            data-map-place-popup
          >
            <div className="font-medium">{selected.name}</div>
            <div className="text-xs">
              {visitedPlaceKind(selected)}
              {selected.elevationM !== null
                ? ` · ${Math.round(selected.elevationM).toLocaleString()} m`
                : ''}
            </div>
            {live.active && selectedCandidate ? (
              <div className="space-y-1 text-xs">
                {selectedCandidate.kinds.map((kind) => (
                  <div key={kind}>
                    {kind === 'peak'
                      ? 'Peak'
                      : kind === 'pass'
                        ? 'Pass'
                        : 'Hut'}{' '}
                    radius: {placeRadius(kind, thresholds)} m ·{' '}
                    {livePlaceStatus(selectedCandidate, kind) === 'matched'
                      ? 'Matched'
                      : livePlaceStatus(selectedCandidate, kind) ===
                          'incomplete'
                        ? 'Incomplete evidence'
                        : 'Not matched'}
                  </div>
                ))}
                <div>
                  {
                    selectedCandidate.evaluations.filter(
                      (e) =>
                        selectedCandidate.activityIds.includes(e.activityId) &&
                        e.complete &&
                        e.supportedKinds.length > 0,
                    ).length
                  }{' '}
                  of {selectedCandidate.activityIds.length} nearby selected
                  activities matched
                </div>
                <div className="text-gray-600">
                  Circles show horizontal distance. GPS evidence
                  {selectedCandidate.kinds.includes('peak')
                    ? ' and peak elevation'
                    : ''}{' '}
                  also affect matching.
                </div>
              </div>
            ) : (
              <div className="text-xs">
                {selected.activityIds.length}{' '}
                {selected.activityIds.length === 1 ? 'activity' : 'activities'}{' '}
                in view
              </div>
            )}
            <a
              className="text-xs underline"
              href={placeSourceUrl(selected)}
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap
            </a>
          </div>
        </Popup>
      )}
    </>
  );
}
