'use client';

import { useMemo } from 'react';
import { useTable } from '@tanstack/react-table';
import { type Activity } from '~/server/db/schema';
import { features } from '~/components/list/table-extensions';
import { columns } from '~/components/list/columns';
import { ActivityCardContent } from '~/components/list/card';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog';

// Reuse the existing activity detail presentation without changing map/list selection.
export default function ActivityDetails({
  activity,
  onClose,
}: {
  activity: Activity;
  onClose: () => void;
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto p-4"
        data-stats-detail
      >
        <DialogTitle className="sr-only">{activity.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Activity details from your stats.
        </DialogDescription>
        {row && <ActivityCardContent row={row} />}
      </DialogContent>
    </Dialog>
  );
}
