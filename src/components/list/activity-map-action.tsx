'use client';

import { Map } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '~/components/ui/button';
import type {
  ActivityMapCommand,
  MapActionVariant,
} from '~/hooks/use-show-on-map';
import { message } from '~/lib/presentation/messages';
import { canFrameRoute, routeCoordinates } from '~/lib/route-framing';
import { cn } from '~/lib/utils';
import type { Activity } from '~/server/db/schema';

/** One eligibility/name policy in compact rows and full detail surfaces. */
export function ActivityMapAction({
  activity,
  onShowOnMap,
  variant = 'show',
  labelled = false,
  compact = false,
}: {
  activity: Activity;
  onShowOnMap: ActivityMapCommand;
  variant?: MapActionVariant;
  labelled?: boolean;
  compact?: boolean;
}) {
  const { map_polyline, map_summary_polyline } = activity;
  const hasRoute = useMemo(
    () =>
      canFrameRoute(routeCoordinates({ map_polyline, map_summary_polyline })),
    [map_polyline, map_summary_polyline],
  );
  const label = message(
    variant === 'show' ? 'action.showOnMap' : 'action.clearFiltersAndShowOnMap',
  );
  const unavailable = 'No GPS route recorded';
  return (
    <Button
      type="button"
      variant={compact ? 'ghost' : 'secondary'}
      disabled={!hasRoute}
      className={cn(
        'min-h-11 shrink-0 gap-1.5',
        labelled ? 'px-3' : 'size-11 p-0',
        !compact &&
          'bg-header-background/10 text-header-background hover:bg-header-background/15',
      )}
      onClick={() => onShowOnMap(activity, variant)}
      aria-label={`${label}: ${activity.name}${hasRoute ? '' : `; ${unavailable}`}`}
      title={hasRoute ? label : unavailable}
    >
      <Map className="size-4" aria-hidden="true" />
      {labelled && label}
    </Button>
  );
}
