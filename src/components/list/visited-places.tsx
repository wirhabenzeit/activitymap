'use client';

import { House, Mountain, Signpost } from 'lucide-react';

import { placeSourceUrl } from '~/contracts/visited-places';
import { useVisitedPlaces } from '~/hooks/use-visited-places';
import { visitedPlaceKind } from '~/lib/visited-places';

export function VisitedPlaces({ activityId }: { activityId: number }) {
  const query = useVisitedPlaces();
  if (!query.enabled) return null;
  if (query.isError)
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Visited places could not be loaded.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </p>
    );
  if (query.isPending)
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Loading visited places…
      </p>
    );
  const places =
    query.data?.filter((place) =>
      place.activityIds.includes(String(activityId)),
    ) ?? [];
  // No row may mean outside coverage or not evaluated. Never claim "no visits".
  if (!places.length) return null;
  return (
    <section aria-label="Visited places" className="min-w-0">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">
        Visited places
      </h3>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {places.map((place) => {
          const Icon = place.kinds.includes('peak')
            ? Mountain
            : place.kinds.includes('pass')
              ? Signpost
              : House;
          return (
            <li key={place.id} className="max-w-full min-w-0">
              <a
                className="inline-flex max-w-full items-center gap-1 py-1 text-xs hover:underline"
                href={placeSourceUrl(place)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${place.name} · ${visitedPlaceKind(place)} · OpenStreetMap`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="break-words">{place.name}</span>
                {place.elevationM !== null && (
                  <span className="shrink-0 text-muted-foreground">
                    {Math.round(place.elevationM).toLocaleString()} m
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:underline"
      >
        © OpenStreetMap contributors
      </a>
    </section>
  );
}
