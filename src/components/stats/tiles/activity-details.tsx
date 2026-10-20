'use client';

import { ActivityCardContent } from '~/components/list/card';
import type {
  ActivityMapCommand,
  MapActionVariant,
} from '~/hooks/use-show-on-map';
import { type Activity } from '~/lib/activity';

// Reuse the existing activity detail presentation without changing map/list selection.
export default function ActivityDetails({
  activity,
  preview = false,
  onShowOnMap,
  mapActionVariant,
}: {
  activity: Activity;
  preview?: boolean;
  onShowOnMap?: ActivityMapCommand;
  mapActionVariant?: MapActionVariant;
}) {
  return (
    <div data-stats-detail className="p-3">
      <ActivityCardContent
        activity={activity}
        onShowOnMap={onShowOnMap}
        mapActionVariant={mapActionVariant}
        showMapButton={!preview}
        readOnly={preview}
      />
    </div>
  );
}
