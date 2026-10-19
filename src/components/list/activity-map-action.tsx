'use client';

import { useMemo } from 'react';

import { Button } from '~/components/ui/button';
import type {
  ActivityMapCommand,
  MapActionVariant,
} from '~/hooks/use-show-on-map';
import type { Activity } from '~/lib/activity';
import { semanticAction } from '~/lib/presentation/icons';
import { message } from '~/lib/presentation/messages';
import { canFrameRoute, routeCoordinates } from '~/lib/route-framing';
import { cn } from '~/lib/utils';

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
  const { label, Icon } = semanticAction(
    variant === 'show' ? 'showOnMap' : 'clearFiltersAndShowOnMap',
  );
  const unavailable = message('activity.action.noRoute');
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
      aria-label={
        hasRoute
          ? message('activity.action.named', {
              action: label,
              name: activity.name,
            })
          : message('activity.action.unavailable', {
              action: label,
              name: activity.name,
              reason: unavailable,
            })
      }
      title={hasRoute ? label : unavailable}
    >
      <Icon className="size-4" aria-hidden="true" />
      {labelled && label}
    </Button>
  );
}
