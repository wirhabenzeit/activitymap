'use client';

import { useTable } from '@tanstack/react-table';
import { useMemo } from 'react';

import { ActivityCardContent } from '~/components/list/card';
import { columns } from '~/components/list/columns';
import { features } from '~/components/list/table-extensions';
import type {
  ActivityMapCommand,
  MapActionVariant,
} from '~/hooks/use-show-on-map';
import { type Activity } from '~/server/db/schema';

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
  const data = useMemo(() => [activity], [activity]);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => String(row.id),
  });
  const row = table.getCoreRowModel().rows[0];
  return (
    <div data-stats-detail className="p-3">
      {row && (
        <ActivityCardContent
          row={row}
          onShowOnMap={onShowOnMap}
          mapActionVariant={mapActionVariant}
          showMapButton={!preview}
          readOnly={preview}
        />
      )}
    </div>
  );
}
