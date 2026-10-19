'use client';

import { Gauge, Mountain, Route, Timer } from 'lucide-react';
import type { Expression } from 'mapbox-gl';
import { useCallback, useMemo, useRef, useState } from 'react';
import ReactMapGL, {
  FullscreenControl,
  Layer,
  type MapMouseEvent,
  type MapRef,
  NavigationControl,
  Source,
} from 'react-map-gl/mapbox';

import { ElevationPlot } from '~/components/list/elevation-plot';
import type { SharedActivityDTO } from '~/contracts/share/activity';
import {
  useDateFormat,
  useDisplayUnits,
} from '~/hooks/use-display-preferences';
import { formatPreferredDate } from '~/lib/date-preferences';
import { formatLocalTime } from '~/lib/local-date-time';
import {
  routeBounds,
  routeFitPadding,
  routeFramingPolicy,
} from '~/lib/route-framing';
import {
  buildSharedRouteCollection,
  sharedElevationProfile,
} from '~/lib/sharing/shared-map';
import {
  formatSpeed,
  speedDisplayForSport,
  speedLabel,
} from '~/lib/speed-display';
import { formatMeasurement } from '~/lib/units';
import { categorySettings, colorMap, iconMap } from '~/settings/category';
import { baseMaps, defaultMapPosition } from '~/settings/map';

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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, '0')}m`
    : `${minutes}m`;
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
  onCursor,
}: {
  activity: SharedActivityDTO;
  expiresAt: string;
  onCursor: (coordinate: [number, number] | null) => void;
}) {
  const units = useDisplayUnits();
  const profile = useMemo(() => sharedElevationProfile(activity), [activity]);
  const dateFormat = useDateFormat();
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
            {formatPreferredDate(activity.start_date_local, dateFormat) +
              ' · ' +
              formatLocalTime(activity.start_date_local, {
                hour: '2-digit',
                minute: '2-digit',
              })}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat
          icon={Route}
          label="Distance"
          value={formatMeasurement(activity.distance, 'distance', units)}
        />
        <Stat
          icon={Timer}
          label="Moving time"
          value={formatDuration(activity.moving_time)}
        />
        <Stat
          icon={Mountain}
          label="Elevation"
          value={formatMeasurement(
            activity.total_elevation_gain,
            'elevation',
            units,
          )}
        />
        <Stat
          icon={Gauge}
          label={speedLabel(speedDisplayForSport(activity.sport_type))}
          value={formatSpeed(
            activity.average_speed,
            speedDisplayForSport(activity.sport_type),
            units,
          )}
        />
      </div>

      {profile && (
        <div className="mt-4">
          <ElevationPlot
            key={activity.id}
            profile={profile}
            height={130}
            onSelection={(index) =>
              onCursor(
                index === null ? null : (profile.latlng?.[index] ?? null),
              )
            }
          />
        </div>
      )}

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
  const panelRef = useRef<HTMLDivElement>(null);
  const routes = useMemo(
    () => buildSharedRouteCollection(activities),
    [activities],
  );
  const [selectedId, setSelectedId] = useState(activities[0]?.id ?? null);
  // [lat, lng] of the elevation-profile sample under the pointer.
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const selectActivity = useCallback((id: string) => {
    setSelectedId(id);
    setCursor(null);
  }, []);
  const selectedActivity =
    activities.find((activity) => activity.id === selectedId) ?? activities[0];

  const fitRoutes = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || routes.features.length === 0) return;

    const bounds = routeBounds(
      routes.features.flatMap((feature) => feature.geometry.coordinates),
    );
    const padding = routeFitPadding(
      map.getContainer().getBoundingClientRect(),
      panelRef.current?.getBoundingClientRect(),
    );
    if (!bounds || !padding) return;
    // Fit the disclosed route subset once using the actual card footprint.
    // Later selection, scrolling and resizing preserve the user's camera.
    map.fitBounds(bounds, {
      duration: 0,
      maxZoom: routeFramingPolicy.maxZoom,
      padding,
    });
  }, [routes]);

  const handleRouteClick = useCallback(
    (event: MapMouseEvent) => {
      const properties: unknown = event.features?.[0]?.properties;
      const id =
        properties && typeof properties === 'object'
          ? (properties as Record<string, unknown>).id
          : undefined;
      if (typeof id === 'string') selectActivity(id);
    },
    [selectActivity],
  );

  if (activities.length === 0) {
    return (
      <main className="grid h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Shared tracks unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            None of the tracks in this private link are currently available.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="relative h-dvh w-dvw overflow-hidden"
      aria-label="Shared track map"
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
        {cursor && (
          <Source
            id="shared-elevation-cursor"
            type="geojson"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [cursor[1], cursor[0]] },
            }}
          >
            <Layer
              id="shared-elevation-cursor"
              type="circle"
              paint={{
                'circle-radius': 6,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#111827',
                'circle-stroke-width': 3,
              }}
            />
          </Source>
        )}
      </ReactMapGL>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col p-3 sm:p-5"
        style={{
          // Leave the same minimum usable map area that the fitter requires,
          // including on short windows and with enlarged text.
          maxHeight: `calc(100dvh - ${routeFramingPolicy.padding.top + routeFramingPolicy.minimumExtent + routeFramingPolicy.panelGap}px)`,
        }}
      >
        <div
          ref={panelRef}
          className="pointer-events-auto mx-auto min-h-0 w-full max-w-3xl overflow-y-auto"
        >
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
                  onClick={() => selectActivity(activity.id)}
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
              onCursor={setCursor}
            />
          )}
        </div>
      </div>
    </main>
  );
}
