import { type RowData, type Table } from '@tanstack/react-table';
import { FoldHorizontal, MoveHorizontal, Pin } from 'lucide-react';
import { type Features } from './table-extensions';

/**
 * How the list handles columns that don't fit: hide them (fit), or scroll
 * sideways with or without the name column pinned. Stored as the table's
 * fitWidth flag plus the name column's pin, so no extra state is needed.
 */
export type WidthMode = 'fit' | 'pinned' | 'free';

export const widthModes: Record<
  WidthMode,
  { label: string; next: WidthMode; icon: typeof Pin }
> = {
  fit: { label: 'Fit to width', next: 'pinned', icon: FoldHorizontal },
  pinned: { label: 'Scroll, name pinned', next: 'free', icon: Pin },
  free: { label: 'Scroll freely', next: 'fit', icon: MoveHorizontal },
};

export function getWidthMode<TData extends RowData>(
  table: Table<Features, TData>,
): WidthMode {
  if (table.store.state.fitWidth) return 'fit';
  return table.getColumn('name')?.getIsPinned() ? 'pinned' : 'free';
}

export function setWidthMode<TData extends RowData>(
  table: Table<Features, TData>,
  mode: WidthMode,
) {
  table.setFitWidth(mode === 'fit');
  // Pinning only matters while scrolling; fit mode restores it.
  table.getColumn('name')?.pin(mode === 'free' ? false : 'start');
}
