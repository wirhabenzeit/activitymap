'use client';

import { useState } from 'react';

import {
  DEFAULT_LIVE_RADII,
  LIVE_PLACE_LIMIT,
  type LivePlaceRequest,
} from '~/contracts/live-places';
import { useLivePlaces, useLivePlacesSettings } from '~/hooks/use-live-places';
import { useShallowStore } from '~/store';

const labels = {
  peakRadiusM: 'Peaks',
  passRadiusM: 'Passes',
  hutRadiusM: 'Huts',
} as const;
const outcomeLabels: Record<string, string> = {
  missing_streams: 'Stored GPS unavailable',
  uncovered: 'Outside catalogue coverage',
  partial: 'Incomplete evidence',
  failed: 'Could not evaluate',
  superseded: 'Activity changed',
};
export function LivePlacesPanel() {
  const query = useLivePlaces();
  const { active, setActive, thresholds, setThresholds } =
    useLivePlacesSettings();
  const [draft, setDraft] =
    useState<LivePlaceRequest['thresholds']>(thresholds);
  const showPoints = useShallowStore((state) => state.showVisitedPlaces);
  if (!query.available) return null;
  const changed = Object.keys(labels).some(
    (key) =>
      draft[key as keyof typeof labels] !==
      thresholds[key as keyof typeof labels],
  );
  return (
    <section
      aria-label="Live place matching"
      className="max-h-[30dvh] shrink-0 overflow-y-auto border-t px-3 py-2 text-xs"
    >
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Live place matching{' '}
        <span className="font-normal text-muted-foreground">Local preview</span>
      </label>
      {active && (
        <div className="mt-2 space-y-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setThresholds({ ...draft });
              if (!changed && query.enabled) void query.refetch();
            }}
          >
            <fieldset className="grid grid-cols-3 gap-3">
              <legend className="sr-only">Visit distances in metres</legend>
              {Object.entries(labels).map(([key, label]) => {
                const field = key as keyof typeof labels;
                return (
                  <label key={field} className="min-w-0">
                    <span className="flex justify-between gap-1">
                      {label}
                      <span>{draft[field]} m</span>
                    </span>
                    <input
                      className="mt-1 w-full accent-teal-700"
                      aria-label={`${label} distance`}
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={draft[field]}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          [field]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                );
              })}
            </fieldset>
            <div className="mt-1 flex items-center gap-3">
              <button
                type="submit"
                disabled={!query.enabled || query.isFetching}
                className="rounded border px-2 py-1 disabled:opacity-50"
              >
                {query.isFetching
                  ? 'Matching…'
                  : changed
                    ? 'Apply distances'
                    : 'Run again'}
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setDraft(DEFAULT_LIVE_RADII);
                  setThresholds(DEFAULT_LIVE_RADII);
                }}
              >
                Reset
              </button>
              {changed && (
                <span className="text-muted-foreground">
                  Changes not applied
                </span>
              )}
            </div>
          </form>
          <div
            role="status"
            aria-live="polite"
            className="text-muted-foreground"
          >
            {query.selectedCount > LIVE_PLACE_LIMIT
              ? `Select up to ${LIVE_PLACE_LIMIT} activities for live matching.`
              : query.isFetching
                ? `Matching ${query.selectedCount} selected ${query.selectedCount === 1 ? 'activity' : 'activities'}…`
                : query.isError
                  ? 'Matching failed. Try Run again.'
                  : query.data
                    ? `${query.data.places.length} ${query.data.places.length === 1 ? 'place' : 'places'} · ${query.data.durationMs.toLocaleString()} ms · nothing saved`
                    : 'Select an activity to preview its places.'}
            {!showPoints &&
              ' Enable Show visited places in Map layers to see points.'}
          </div>
          <p
            className="text-muted-foreground"
            aria-label="Matching radius legend"
          >
            <span className="text-teal-700 dark:text-teal-400">
              Solid teal: matched
            </span>{' '}
            ·{' '}
            <span className="text-slate-500 dark:text-slate-400">
              Dashed grey: not matched
            </span>{' '}
            ·{' '}
            <span className="text-amber-700 dark:text-amber-400">
              Amber: incomplete
            </span>
            . Circles show applied distances. Nearby places within 300 m are
            included.
          </p>
          {query.data?.activities
            .filter((activity) => activity.outcome !== 'complete')
            .map((activity) => (
              <p
                key={activity.activityId}
                className="text-amber-700 dark:text-amber-400"
              >
                Activity {activity.activityId}:{' '}
                {outcomeLabels[activity.outcome] ?? activity.outcome}.
              </p>
            ))}
          {!!query.data?.encounters.length && (
            <details>
              <summary className="cursor-pointer">
                Inspect nearby encounters ({query.data.encounters.length})
              </summary>
              <p className="my-1 text-muted-foreground">
                Closest distance; huts indicate vicinity. Encounters use the
                existing 100 m entry / 150 m exit boundary.
              </p>
              <ul className="space-y-1">
                {query.data.encounters.map((encounter) => (
                  <li
                    key={`${encounter.activityId}:${encounter.placeId}`}
                    className="flex flex-wrap justify-between gap-x-2"
                  >
                    <span>
                      {encounter.name}
                      {query.selectedCount > 1 && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {encounter.activityId}
                        </span>
                      )}
                    </span>
                    <span>
                      {encounter.distanceM.toFixed(1)} m ·{' '}
                      {encounter.supported ? 'Supported' : 'Not supported'} ·{' '}
                      {encounter.encounters}{' '}
                      {encounter.encounters === 1 ? 'encounter' : 'encounters'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
