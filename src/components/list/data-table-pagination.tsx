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
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 p-2 border-t border-border bg-muted',
        className,
      )}
    >
      <span className="text-sm text-muted-foreground">
        {`${table.getFilteredSelectedRowModel().rows.length}/${table.getFilteredRowModel().rows.length}`}
      </span>
      <DataTableViewOptions table={table} hiddenByFit={hiddenByFit} />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
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
          <span className="text-sm font-medium">
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
            className="h-8 w-8 p-0"
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
