'use client';

import { type Table, type RowData } from '@tanstack/react-table';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from '@radix-ui/react-icons';
import { Button } from '~/components/ui/button';
import { DataTableViewOptions } from './data-table-view-options';
import { cn } from '~/lib/utils';
import { type Features } from './table-extensions';

interface DataTablePaginationProps<TData extends RowData> {
  table: Table<Features, TData>;
  className?: string;
  /** Visible columns that fit-to-width mode is currently leaving out. */
  hiddenByFit?: Set<string>;
}

export function DataTablePagination<TData extends RowData>({
  table,
  className,
  hiddenByFit,
}: DataTablePaginationProps<TData>) {
  const filtered = table.getFilteredRowModel().rows.length;
  const selected = table.getSelectedRowModel().rows.length;
  const hiddenSelected =
    selected - table.getFilteredSelectedRowModel().rows.length;
  const fullCount = `${filtered} filtered · ${selected} selected${hiddenSelected > 0 ? ` · ${hiddenSelected} hidden by filters` : ''}`;
  const shortCount = `${filtered.toLocaleString('en-US')}${selected > 0 ? ` · ✓${selected.toLocaleString('en-US')}` : ''}`;

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 sm:gap-4 p-2 border-t border-border bg-muted',
        className,
      )}
    >
      <span className="min-w-0 truncate whitespace-nowrap text-sm text-muted-foreground">
        <span className="sr-only sm:not-sr-only">{fullCount}</span>
        <span aria-hidden className="sm:hidden">
          {shortCount}
        </span>
      </span>
      <DataTableViewOptions table={table} hiddenByFit={hiddenByFit} />
      <div className="flex shrink-0 items-center gap-4">
        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 sm:inline-flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <span className="whitespace-nowrap px-1 text-sm font-medium">
            {`${table.store.state.pagination.pageIndex + 1}/${table.getPageCount()}`}
          </span>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 sm:inline-flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
