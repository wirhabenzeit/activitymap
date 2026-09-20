'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { Gauge, Heart, Mountain, Route, Timer, Zap } from 'lucide-react';
import { LngLatBounds, type Expression } from 'mapbox-gl';
import ReactMapGL, {
  FullscreenControl,
  Layer,
  NavigationControl,
  Source,
  type MapMouseEvent,
  type MapRef,
} from 'react-map-gl/mapbox';
import type { SharedActivityDTO } from '~/contracts/share/activity';
import { buildSharedRouteCollection } from '~/lib/sharing/shared-map';
import { categorySettings, colorMap, iconMap } from '~/settings/category';
import { baseMaps, defaultMapPosition } from '~/settings/map';

import 'mapbox-gl/dist/mapbox-gl.css';

type SharedActivityMapProps = {
  activities: SharedActivityDTO[];
  expiresAt: string;
};

const routeColor: Expression = ['match', ['get', 'sportType']];
for (const setting of Object.values(categorySettings)) {
  for (const sportType of setting.alias) {
    routeColor.push(sportType, setting.color);
  }
}
routeColor.push('#6A4C93');

function formatDistance(meters: number | null): string {
  return meters === null ? '—' : `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, '0')}m`
    : `${minutes}m`;
}

function formatElevation(meters: number | null): string {
  return meters === null ? '—' : `${Math.round(meters)} m`;
}

function formatSpeed(metersPerSecond: number | null): string {
  return metersPerSecond === null
    ? '—'
    : `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[11px] leading-none text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function ActivityDetails({
  activity,
  expiresAt,
}: {
  activity: SharedActivityDTO;
  expiresAt: string;
}) {
  const sportType = activity.sport_type as keyof typeof iconMap;
  const SportIcon = iconMap[sportType];
  const sportColor = colorMap[sportType] ?? '#6A4C93';

  return (
    <section className="rounded-xl border bg-background/95 p-4 shadow-xl backdrop-blur-sm">
      <div className="flex items-start gap-3">
        {SportIcon && (
          <SportIcon
            aria-hidden="true"
            className="mt-0.5 h-6 w-6 shrink-0"
            color={sportColor}
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{activity.name}</h1>
          <p className="text-xs text-muted-foreground">
            {activity.sport_type} ·{' '}
            {new Date(activity.start_date_local).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat
          icon={Route}
          label="Distance"
          value={formatDistance(activity.distance)}
        />
        <Stat
          icon={Timer}
          label="Moving time"
          value={formatDuration(activity.moving_time)}
        />
        <Stat
          icon={Mountain}
          label="Elevation"
          value={formatElevation(activity.total_elevation_gain)}
        />
        <Stat
          icon={Gauge}
          label="Average speed"
          value={formatSpeed(activity.average_speed)}
        />
        {activity.average_heartrate !== undefined && (
          <Stat
            icon={Heart}
            label="Average heart rate"
            value={
              activity.average_heartrate === null
                ? '—'
                : `${Math.round(activity.average_heartrate)} bpm`
            }
          />
        )}
        {activity.average_watts !== undefined && (
          <Stat
            icon={Zap}
            label="Average power"
            value={
              activity.average_watts === null
                ? '—'
                : `${Math.round(activity.average_watts)} W`
            }
          />
        )}
        {activity.kudos_count !== undefined && (
          <Stat
            icon={Heart}
            label="Kudos"
            value={
              activity.kudos_count === null ? '—' : String(activity.kudos_count)
            }
          />
        )}
      </div>

      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        Shared privately via ActivityMap · expires{' '}
        {new Date(expiresAt).toLocaleString()}
      </p>
    </section>
  );
}

export function SharedActivityMap({
  activities,
  expiresAt,
}: SharedActivityMapProps) {
  const mapRef = useRef<MapRef>(null);
  const routes = useMemo(
    () => buildSharedRouteCollection(activities),
    [activities],
  );
  const [selectedId, setSelectedId] = useState(activities[0]?.id ?? null);
  const selectedActivity =
    activities.find((activity) => activity.id === selectedId) ?? activities[0];

  const fitRoutes = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || routes.features.length === 0) return;

    const bounds = new LngLatBounds();
    for (const feature of routes.features) {
      for (const coordinate of feature.geometry.coordinates) {
        bounds.extend(coordinate as [number, number]);
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        duration: 0,
        maxZoom: 15,
        padding: { top: 56, right: 40, bottom: 260, left: 40 },
      });
    }
  }, [routes]);

  const handleRouteClick = useCallback((event: MapMouseEvent) => {
    const properties: unknown = event.features?.[0]?.properties;
    const id =
      properties && typeof properties === 'object'
        ? (properties as Record<string, unknown>).id
        : undefined;
    if (typeof id === 'string') setSelectedId(id);
  }, []);

  if (activities.length === 0) {
    return (
      <main className="grid h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Shared activity unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            None of the activities in this private link are currently available.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="relative h-dvh w-dvw overflow-hidden"
      aria-label="Shared activity map"
    >
      <ReactMapGL
        ref={mapRef}
        initialViewState={defaultMapPosition}
        mapStyle={baseMaps.mapboxStreet.url}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        interactiveLayerIds={['shared-route-hit']}
        onClick={handleRouteClick}
        onLoad={fitRoutes}
        cursor="pointer"
        reuseMaps
      >
        <NavigationControl position="top-right" showCompass />
        <FullscreenControl position="top-right" />
        <Source id="shared-routes" type="geojson" data={routes}>
          <Layer
            id="shared-route-outline"
            type="line"
            paint={{
              'line-color': '#111827',
              'line-width': 7,
              'line-opacity': 0.9,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
          <Layer
            id="shared-route-line"
            type="line"
            paint={{ 'line-color': routeColor, 'line-width': 4 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
          <Layer
            id="shared-route-selected"
            type="line"
            filter={['==', ['get', 'id'], selectedActivity?.id ?? '']}
            paint={{ 'line-color': '#ffffff', 'line-width': 2 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
          <Layer
            id="shared-route-hit"
            type="line"
            paint={{
              'line-color': '#000000',
              'line-width': 20,
              'line-opacity': 0,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>
      </ReactMapGL>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 sm:p-5">
        <div className="pointer-events-auto mx-auto max-w-3xl">
          {activities.length > 1 && (
            <div className="mb-2 flex max-w-full gap-2 overflow-x-auto rounded-lg bg-background/90 p-2 shadow backdrop-blur-sm">
              {activities.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs ${
                    activity.id === selectedActivity?.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setSelectedId(activity.id)}
                >
                  {activity.name}
                </button>
              ))}
            </div>
          )}
          {selectedActivity && (
            <ActivityDetails
              activity={selectedActivity}
              expiresAt={expiresAt}
            />
          )}
        </div>
      </div>
    </main>
  );
}
