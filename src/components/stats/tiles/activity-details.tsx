'use client';

import { useMemo } from 'react';
import { useTable } from '@tanstack/react-table';
import { type Activity } from '~/server/db/schema';
import { features } from '~/components/list/table-extensions';
import { columns } from '~/components/list/columns';
import { ActivityCardContent } from '~/components/list/card';

// Reuse the existing activity detail presentation without changing map/list selection.
export default function ActivityDetails({
  activity,
  preview = false,
}: {
  activity: Activity;
  preview?: boolean;
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
          showMapButton={!preview}
          readOnly={preview}
        />
      )}
    </div>
  );
}
