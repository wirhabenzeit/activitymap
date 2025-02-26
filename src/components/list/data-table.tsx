'use client';
'use no memo';

import * as React from 'react';

import {
  type ColumnDef,
  type VisibilityState,
  type SortingState,
  type ColumnFiltersState,
  type Updater,
  type RowSelectionState,
  type RowData,
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';
import { type MapRef } from 'react-map-gl/mapbox';
import { type RefObject } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';

import { cn } from '~/lib/utils';

import { DataTablePagination } from './data-table-pagination';
import {
  type DensityState,
  type SummaryRowState,
  DensityFeature,
  MapFeature,
  SummaryRowFeature,
} from './table-extensions';

interface ListState {
  density: DensityState;
  columnPinning: { left?: string[]; right?: string[] };
  summaryRow: SummaryRowState;
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    width: string;
    title: string;
  }
}

interface ListActions {
  setSorting: (updater: Updater<SortingState>) => void;
  setColumnVisibility: (updater: Updater<VisibilityState>) => void;
  setDensity: (updater: Updater<DensityState>) => void;
  setColumnPinning: (
    updater: Updater<{ left?: string[]; right?: string[] }>,
  ) => void;
  setSummaryRow: (updater: Updater<SummaryRowState>) => void;
}

interface DataTableProps<TData, TValue> extends ListState, ListActions {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  className?: string;
  columnVisibility: VisibilityState;
  sorting: SortingState;
  paginationControl?: boolean;
  selected: number[];
  setSelected: (updater: Updater<number[]>) => void;
  columnFilters: ColumnFiltersState;
  map?: RefObject<MapRef | null>;
}

interface RowWithId {
  id: number;
}

export function DataTable<TData extends RowWithId, TValue>({
  className,
  columns,
  data,
  columnFilters,
  columnVisibility,
  sorting,
  selected,
  density,
  columnPinning,
  summaryRow,
  paginationControl = true,
  map,
  setSorting,
  setColumnVisibility,
  setSelected,
  setDensity,
  setColumnPinning,
  setSummaryRow,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id.toString(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const selection =
        typeof updater === 'function'
          ? updater(Object.fromEntries(selected.map((id) => [id, true])))
          : updater;
      setSelected(Object.keys(selection).map(Number));
    },
    onDensityChange: setDensity,
    onSummaryRowChange: setSummaryRow,
    onColumnPinningChange: setColumnPinning,
    initialState: {
      pagination: { pageSize: 200 },
      columnVisibility,
      sorting,
      columnFilters,
      columnPinning,
    },
    state: {
      columnVisibility,
      sorting,
      columnFilters,
      columnPinning,
      density,
      summaryRow,
      map,
      rowSelection: Object.fromEntries(selected.map((id) => [id, true])),
    },
    _features: [DensityFeature, MapFeature, SummaryRowFeature],
  });

  return (
    <div className={cn('flex flex-col', className)}>
      <Table
        id="table-main"
        className="text-xs grid"
        wrapperClassName="overflow-scroll min-h-0 w-full flex-1"
        style={{
          gridTemplateColumns: table
            .getVisibleFlatColumns()
            .map((column) => column.columnDef.meta?.width)
            .join(' '),
        }}
      >
        <TableHeader className="sticky [&_tr]:border-b-0 grid grid-cols-subgrid col-span-full">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="border-b-0 grid grid-cols-subgrid col-span-full"
            >
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    className={cn(
                      'py-0 flex items-center',
                      header.column.getIsPinned() == 'left' &&
                        'sticky left-0 bg-muted border-border border-r',
                      header.column.getIsPinned() == 'right' &&
                        'sticky right-0 bg-muted border-border border-l',
                    )}
                    key={header.id}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
          {table.getFooterGroups().map((footerGroup) => (
            <TableRow
              key={footerGroup.id}
              className={cn(
                'border-b grid grid-cols-subgrid col-span-full',
                !summaryRow && 'hidden',
              )}
            >
              {footerGroup.headers.map((footer) => {
                return (
                  <TableHead
                    key={footer.id}
                    className={cn(
                      'h-8 border-b border-t border-border text-xs font-bold flex items-center',
                      footer.column.getIsPinned() == 'left' &&
                        'sticky left-0 bg-muted border-r border-border',
                      footer.column.getIsPinned() == 'right' &&
                        'sticky right-0 bg-muted border-l border-border',
                    )}
                  >
                    {flexRender(
                      footer.column.columnDef.footer,
                      footer.getContext(),
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="grid grid-cols-subgrid col-span-full">
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                className="group grid grid-cols-subgrid col-span-full"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    className={cn(
                      'bg-background group-data-[state=selected]:bg-muted flex items-center',
                      cell.column.getIsPinned() == 'left' &&
                        'sticky left-0 border-border border-r',
                      cell.column.getIsPinned() == 'right' &&
                        'sticky right-0 border-border border-l',
                      density == 'sm'
                        ? 'py-1 px-1'
                        : density == 'md'
                          ? 'p-2'
                          : 'py-3 px-2 text-sm',
                    )}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {paginationControl && <DataTablePagination table={table} />}
    </div>
  );
}
