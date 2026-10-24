'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';
import { Marker, Popup, useMap } from 'react-map-gl/mapbox';

import { PlaceSymbol } from '~/components/place-symbol';
import { Button } from '~/components/ui/button';
import {
  DEFAULT_PLACE_DEBUG_SETTINGS,
  type DebugPlace,
  type PlaceDebugSettings,
  placeDebugResponseSchema,
  placeDebugSettingsSchema,
} from '~/contracts/place-debug';
import type { Activity } from '~/lib/activity';
import { placeDebugReason } from '~/lib/place-debug';
import { primaryPlaceKind } from '~/lib/place-symbols';
import { usePlaceDebug } from '~/store/place-debug';

type DebugField = [keyof PlaceDebugSettings, string];
const peakFields: DebugField[] = [
  ['peakRadiusM', 'Horizontal tolerance'],
  ['peakVerticalToleranceM', 'Vertical tolerance'],
];
const otherFields: DebugField[] = [
  ['passRadiusM', 'Pass distance'],
  ['hutRadiusM', 'Hut distance'],
];
const encounterFields: DebugField[] = [
  ['discoveryRadiusM', 'Discover nearby'],
  ['entryRadiusM', 'Encounter entry'],
  ['exitRadiusM', 'Encounter exit'],
];
const colors = {
  matched: '#0f766e',
  rejected: '#b45309',
  uncertain: '#64748b',
};
const statusMessages = {
  pending: 'Place matching is pending.',
  complete: 'Check complete',
  partial: 'Incomplete check — results are not conclusive.',
  uncovered:
    'The route corridor extends beyond catalogue coverage. Try a smaller discovery radius.',
  unavailable: 'No published place catalogue is available.',
  missing_streams: 'No usable stored GPS is available for this activity.',
};

export function PlaceDebugLayer({
  activities,
  selectedIds,
  userId,
  authSession,
}: {
  activities: ReadonlyMap<number, Activity>;
  selectedIds: number[];
  userId: string;
  authSession: number;
}) {
  const { current: map } = useMap();
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_PLACE_DEBUG_SETTINGS);
  const [settings, setSettings] = useState(DEFAULT_PLACE_DEBUG_SETTINGS);
  const [chosenRoute, setChosenRoute] = useState('');
  const [chosenPlace, setChosenPlace] = useState<string | null>(null);
  const activityId = selectedIds.some((id) => String(id) === chosenRoute)
    ? chosenRoute
    : String(selectedIds[0] ?? '');
  const metadata = activities.get(Number(activityId))?.streamsMetadata;
  const validation = placeDebugSettingsSchema.safeParse(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const query = useQuery({
    queryKey: [
      'place-debug',
      userId,
      authSession,
      activityId,
      metadata?.generation,
      metadata?.revision,
      settings,
    ],
    enabled: Boolean(activityId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/activities/${activityId}/places/debug`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
          signal,
          cache: 'no-store',
        },
      );
      if (response.status === 401 || response.status === 404)
        usePlaceDebug.setState({ userId: null });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? 'The route changed. Try again.'
            : 'Debug places could not be loaded. Try again.',
        );
      const data = placeDebugResponseSchema.parse(await response.json());
      if (data.userId !== userId || data.activityId !== activityId)
        throw new Error('Account or activity changed.');
      return data;
    },
  });
  const data = !query.isError ? query.data : undefined;
  const selected = data?.candidates.find((place) => place.id === chosenPlace);
  const inspect = (place: DebugPlace) => {
    setChosenPlace(place.id);
    setCollapsed(true);
    map?.easeTo({ center: [place.longitude, place.latitude], duration: 250 });
  };
  const renderFields = (fields: DebugField[]) => (
    <div className="space-y-2">
      {fields.map(([key, label]) => (
        <label
          key={key}
          className="grid grid-cols-[1fr_5rem] items-center gap-2"
        >
          <span>{label} (m)</span>
          <input
            type="number"
            min={1}
            max={2000}
            step="any"
            required
            value={Number.isNaN(draft[key]) ? '' : draft[key]}
            className="min-h-9 min-w-0 rounded border bg-background px-2"
            onChange={(event) =>
              setDraft((value) => ({
                ...value,
                [key]: event.target.valueAsNumber,
              }))
            }
          />
        </label>
      ))}
    </div>
  );
  return (
    <>
      <section
        data-map-place
        aria-label="Place matching debug"
        className="absolute top-3 left-14 z-20 w-[min(21rem,calc(100%_-_7rem))] rounded-lg border bg-popover text-popover-foreground shadow-lg"
      >
        <div className="flex items-center justify-between gap-2 p-2">
          <button
            type="button"
            className="flex min-h-9 flex-1 items-center gap-2 text-left text-sm font-semibold"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronUp className="size-4" />
            )}{' '}
            Place matching debug
          </button>
          <button
            type="button"
            aria-label="Turn off place matching debug"
            className="flex size-9 items-center justify-center"
            onClick={() => usePlaceDebug.setState({ userId: null })}
          >
            <X className="size-4" />
          </button>
        </div>
        {!collapsed && (
          <div className="max-h-[min(65dvh,36rem)] space-y-3 overflow-y-auto border-t p-3 text-xs">
            <p className="text-muted-foreground">
              Weighted spatial matching · results are never saved.
            </p>
            {!activityId ? (
              <p>Select an activity on the map to inspect nearby places.</p>
            ) : (
              <>
                <label className="block space-y-1">
                  <span>Activity to inspect</span>
                  <select
                    aria-label="Activity to inspect"
                    className="min-h-9 w-full rounded border bg-background px-2"
                    value={activityId}
                    onChange={(e) => {
                      setChosenRoute(e.target.value);
                      setChosenPlace(null);
                    }}
                  >
                    {selectedIds.map((id) => (
                      <option key={id} value={String(id)}>
                        {activities.get(id)?.name ?? String(id)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (validation.success) {
                  setSettings(validation.data);
                  setChosenPlace(null);
                  if (!dirty) void query.refetch();
                }
              }}
            >
              <fieldset className="space-y-2 rounded border border-teal-700/30 bg-teal-700/5 p-2">
                <legend className="px-1 text-sm font-semibold">
                  Weighted peak score
                </legend>
                <p>
                  A score of <strong>1 or less</strong> passes. These tolerances
                  set the horizontal and vertical weights.
                </p>
                {renderFields(peakFields)}
                <p className="font-mono text-[11px] leading-relaxed break-words">
                  score = √((distance ÷ horizontal tolerance)² + (height
                  difference ÷ vertical tolerance)²)
                </p>
                <p className="text-muted-foreground">
                  Larger tolerances are more permissive. Missing elevation uses
                  horizontal distance only.
                </p>
              </fieldset>
              <details className="mt-3 rounded border p-2">
                <summary className="cursor-pointer py-1 font-medium">
                  Pass and hut distances
                </summary>
                <p className="my-2 text-muted-foreground">
                  Passes and huts use horizontal proximity.
                </p>
                {renderFields(otherFields)}
              </details>
              <details className="mt-3 rounded border p-2">
                <summary className="cursor-pointer py-1 font-medium">
                  Candidate search and encounter grouping
                </summary>
                <p className="my-2 text-muted-foreground">
                  Discovery finds places near the route. Entry starts an
                  encounter; exit ends it. These control which points are
                  evaluated.
                </p>
                {renderFields(encounterFields)}
              </details>
              {!validation.success && (
                <p role="alert" className="mt-2 text-destructive">
                  Use 1–2000 m. Match radii must fit inside entry ≤ exit ≤
                  discovery.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !validation.success || !activityId || query.isFetching
                  }
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(DEFAULT_PLACE_DEBUG_SETTINGS);
                    setSettings(DEFAULT_PLACE_DEBUG_SETTINGS);
                    setChosenPlace(null);
                  }}
                >
                  Reset
                </Button>
              </div>
            </form>
            {dirty && (
              <p role="status">
                Settings changed. Apply to update the preview.
              </p>
            )}
            <div role="status" aria-live="polite">
              {query.isFetching ? (
                'Checking nearby places…'
              ) : query.isError ? (
                <>
                  <p>{query.error.message}</p>
                  <button
                    type="button"
                    className="min-h-9 underline"
                    onClick={() => void query.refetch()}
                  >
                    Try again
                  </button>
                </>
              ) : data ? (
                <>
                  <p>{statusMessages[data.status]}</p>
                  <p className="mt-1">
                    {data.candidates.length} candidates ·{' '}
                    {
                      data.candidates.filter((p) => p.status === 'matched')
                        .length
                    }{' '}
                    matched ·{' '}
                    {
                      data.candidates.filter(
                        (p) =>
                          p.status === 'matched' && p.defaultMatched === false,
                      ).length
                    }{' '}
                    gained ·{' '}
                    {
                      data.candidates.filter(
                        (p) =>
                          p.status === 'rejected' && p.defaultMatched === true,
                      ).length
                    }{' '}
                    lost
                  </p>
                  {data.reasons.map((reason) => (
                    <p key={reason} className="mt-1">
                      {placeDebugReason(reason)}
                    </p>
                  ))}
                </>
              ) : null}
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              {(['matched', 'rejected', 'uncertain'] as const).map((status) => (
                <span key={status} className="capitalize">
                  <span aria-hidden="true" style={{ color: colors[status] }}>
                    ●
                  </span>{' '}
                  {status}
                </span>
              ))}
            </p>
            <p className="text-muted-foreground">
              <a
                className="underline"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap contributors
              </a>
            </p>
            {data?.candidates.length === 0 && data.status === 'complete' && (
              <p>No catalogue places found in the discovery corridor.</p>
            )}
            {!!data?.candidates.length && (
              <ul className="space-y-1" aria-label="Nearby places">
                {data.candidates.map((place) => (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => inspect(place)}
                      className="flex min-h-9 w-full items-center gap-2 rounded px-1 text-left hover:bg-muted"
                    >
                      <span
                        aria-hidden="true"
                        style={{ color: colors[place.status] }}
                      >
                        ●
                      </span>
                      <span className="min-w-0 flex-1">{place.name}</span>
                      <span>
                        <span className="block font-medium">
                          {place.peakMatch
                            ? `Score ${place.peakMatch.score.toFixed(3)}`
                            : place.kinds.includes('peak')
                              ? 'Unscored'
                              : place.distanceM === null
                                ? 'Unmeasured'
                                : `${Math.round(place.distanceM)} m`}
                        </span>
                        <span className="block text-muted-foreground">
                          {place.status}
                          {place.peakMatch && !place.peakMatch.usesElevation
                            ? ' · horizontal only'
                            : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      {data?.candidates.map((place) => (
        <Marker
          key={place.id}
          longitude={place.longitude}
          latitude={place.latitude}
          anchor="center"
        >
          <button
            type="button"
            data-map-place
            aria-label={`${place.name}: ${place.status}`}
            onClick={(event) => {
              event.stopPropagation();
              setChosenPlace(place.id);
              setCollapsed(true);
            }}
            className="flex size-8 items-center justify-center rounded-full border-2 border-white text-white shadow"
            style={{ backgroundColor: colors[place.status] }}
          >
            <PlaceSymbol kind={primaryPlaceKind(place)} className="size-4" />
          </button>
        </Marker>
      ))}
      {selected && (
        <Popup
          className="matched-place-popup"
          longitude={selected.longitude}
          latitude={selected.latitude}
          closeOnClick={false}
          onClose={() => setChosenPlace(null)}
          offset={20}
          maxWidth="280px"
        >
          <div
            data-map-place
            className="space-y-2 p-2 text-xs text-popover-foreground"
          >
            <h3 className="pr-4 text-sm font-semibold">{selected.name}</h3>
            <p className="capitalize">
              {selected.status} · Default:{' '}
              {selected.defaultMatched === null
                ? 'incomplete'
                : selected.defaultMatched
                  ? 'matched'
                  : 'not matched'}
            </p>
            {selected.peakMatch && (
              <div className="space-y-1 border-t pt-2">
                <p className="font-semibold">Weighted spatial match</p>
                <p>
                  Weighted score: {selected.peakMatch.score.toFixed(3)} (≤ 1
                  passes)
                </p>
                <p>
                  Horizontal distance:{' '}
                  {Math.round(selected.peakMatch.horizontalDistanceM)} m
                </p>
                <p>
                  Elevation difference:{' '}
                  {selected.peakMatch.altitudeDifferenceM === null
                    ? 'unavailable'
                    : `${Math.round(selected.peakMatch.altitudeDifferenceM)} m`}
                </p>
                {selected.peakMatch.spatialDistanceM !== null && (
                  <p>
                    3D distance:{' '}
                    {Math.round(selected.peakMatch.spatialDistanceM)} m
                  </p>
                )}
                <p>
                  {selected.peakMatch.usesElevation
                    ? 'Horizontal and elevation scoring'
                    : 'Horizontal-only fallback (elevation unavailable)'}
                </p>
                {!selected.peakMatch.reliable && (
                  <p>GPS segment too sparse for a confirmed match.</p>
                )}
              </div>
            )}
            <details className="border-t pt-2">
              <summary className="cursor-pointer font-medium">
                Closest-point reference
              </summary>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <p>
                  Closest valid route:{' '}
                  {selected.distanceM === null
                    ? 'not measured'
                    : `${Math.round(selected.distanceM)} m`}
                </p>
                <p>
                  Elevation difference at closest point:{' '}
                  {selected.altitudeDifferenceM === null
                    ? 'unavailable'
                    : `${Math.round(selected.altitudeDifferenceM)} m`}
                </p>
              </div>
            </details>
            <ul className="space-y-1">
              {selected.reasons.map((reason) => (
                <li key={reason}>{placeDebugReason(reason)}</li>
              ))}
            </ul>
          </div>
        </Popup>
      )}
    </>
  );
}
