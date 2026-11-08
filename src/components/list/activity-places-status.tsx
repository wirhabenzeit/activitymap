'use client';
import { Clock, Info, Loader2, type LucideIcon } from 'lucide-react';

import type { ActivityPlacesResponse } from '~/contracts/activity-places';

/** A quiet, fixed-height chart-header status. Successful matches live in the plot.
 * Matching runs in backend jobs; results arrive with library sync. */
export function ActivityPlacesStatus({
  data,
  isLoading,
  isAwaiting,
}: {
  data: ActivityPlacesResponse | undefined;
  isLoading: boolean;
  isAwaiting: boolean;
}) {
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
  const notice: [string, string, LucideIcon] | null = isAwaiting
    ? [
        'Places pending',
        'Places for this route have not been checked yet. They appear after the next sync.',
        Clock,
      ]
    : data?.status === 'unavailable'
      ? [
          'Places unavailable',
          'Places could not be checked for this route. They will be retried automatically.',
          Info,
        ]
      : data?.status === 'uncovered'
        ? [
            'Outside place coverage',
            'Places are currently available for routes within Switzerland, Austria and Italy.',
            Info,
          ]
        : data?.status === 'missing_streams'
          ? ['GPS needed', 'Places need recorded GPS for this route.', Info]
          : data?.status === 'partial'
            ? [
                'Places incomplete',
                'This recording could not be fully checked for places.',
                Info,
              ]
            : null;
  if (!notice) return null;
  const [label, description, Icon] = notice;
  return (
    <span
      role="status"
      title={description}
      aria-label={description}
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
