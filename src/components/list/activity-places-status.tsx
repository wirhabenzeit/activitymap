'use client';
import { Info, Loader2 } from 'lucide-react';

import type { ActivityPlacesResponse } from '~/contracts/activity-places';

/** A quiet, fixed-height chart-header status. Successful matches live in the plot. */
export function ActivityPlacesStatus({
  data,
  isLoading,
  isError,
  retry,
}: {
  data: ActivityPlacesResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}) {
  if (isError || data?.status === 'unavailable')
    return (
      <button
        type="button"
        className="shrink-0 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        onClick={retry}
        title="Places could not be loaded. Try again."
      >
        Retry places
      </button>
    );
  if (isLoading)
    return (
      <span
        role="status"
        aria-label="Finding places"
        className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2
          className="size-3 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Places
      </span>
    );
  const notice =
    data?.status === 'uncovered'
      ? [
          'Outside place coverage',
          'Places are currently available for routes within Switzerland, Austria and Italy.',
        ]
      : data?.status === 'missing_streams'
        ? ['GPS needed', 'Places need recorded GPS for this route.']
        : data?.status === 'partial'
          ? [
              'Places incomplete',
              'This recording could not be fully checked for places.',
            ]
          : null;
  return notice ? (
    <span
      role="status"
      title={notice[1]}
      aria-label={notice[1]}
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <Info className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{notice[0]}</span>
    </span>
  ) : null;
}
