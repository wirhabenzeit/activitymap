'use client';

import { MapPin } from 'lucide-react';

import type { ActivityPlacesResponse } from '~/contracts/activity-places';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import { placeKindLabel } from '~/lib/activity-places';
import { elevationDistanceLabel } from '~/lib/elevation-profile';
import { useActivityPlaceFocus } from '~/store/activity-place-focus';

export function ActivityPlacesSummary({
  userId,
  activityId,
  data,
  isLoading,
  isError,
  retry,
  profileReady,
  profileSpanM,
}: {
  userId: string;
  activityId: string;
  data: ActivityPlacesResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
  profileReady: boolean;
  profileSpanM?: number;
}) {
  const units = useDisplayUnits();
  const { focus, setFocus } = useActivityPlaceFocus();
  const message = isError
    ? 'Places could not be loaded.'
    : isLoading
      ? 'Finding places…'
      : data?.status === 'uncovered'
        ? 'Places are currently available for routes within Switzerland, Austria and Italy.'
        : data?.status === 'missing_streams'
          ? 'Places need recorded GPS for this route.'
          : data?.status === 'partial'
            ? 'This recording could not be fully checked for places.'
            : data?.status === 'unavailable'
              ? 'Places are temporarily unavailable.'
              : !data?.places.length
                ? 'No matching peaks, passes or huts found along this route.'
                : null;
  if (message)
    return (
      <div
        className="mt-2 flex items-start gap-2 text-xs text-muted-foreground"
        role="status"
      >
        <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {message}
          {(isError || data?.status === 'unavailable') && (
            <>
              {' '}
              <button
                className="text-foreground underline"
                type="button"
                onClick={retry}
              >
                Try again
              </button>
            </>
          )}
        </span>
      </div>
    );
  return (
    <div className="mt-2 space-y-1.5" aria-label="Matched places">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden="true" />
        Places along this route
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {data?.places.flatMap((place) =>
          place.visits.map((visit, visitIndex) => {
            const distance =
              profileReady && visit.distanceM !== null
                ? elevationDistanceLabel(
                    visit.distanceM,
                    profileSpanM ?? visit.distanceM,
                    units,
                  )
                : null;
            const active =
              focus?.userId === userId &&
              focus.activityId === activityId &&
              focus.placeId === place.id &&
              focus.visitIndex === visitIndex;
            return (
              <button
                key={`${place.id}:${visitIndex}`}
                type="button"
                aria-pressed={active}
                aria-label={`Highlight ${place.name}${distance ? ` at ${distance}` : ''}`}
                title={placeKindLabel(place)}
                onClick={() =>
                  setFocus({
                    userId,
                    activityId,
                    placeId: place.id,
                    visitIndex,
                    source: 'profile',
                  })
                }
                className="max-w-full rounded-md border border-teal-700/20 bg-teal-700/5 px-2 py-1 text-left text-xs text-foreground outline-none hover:bg-teal-700/10 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-orange-500 aria-pressed:bg-orange-500/10"
              >
                <span className="font-medium">{place.name}</span>
                {distance && (
                  <span className="ml-1.5 text-muted-foreground tabular-nums">
                    {distance}
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
