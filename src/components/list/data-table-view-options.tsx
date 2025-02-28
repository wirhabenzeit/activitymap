'use client';
'use no memo';

import { type Table as TableType } from '@tanstack/react-table';
import { type DensityState, type SummaryRowState } from './table-extensions';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Button } from '~/components/ui/button';
import { Columns, FileSpreadsheet, FileStack, LineChart } from 'lucide-react';
import { MixerHorizontalIcon } from '@radix-ui/react-icons';

interface DataTableViewOptionsProps<TData> {
  table: TableType<TData>;
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  return (
    <div className="flex items-center space-x-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <MixerHorizontalIcon className="mr-2 h-4 w-4" />
            View
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Columns className="size-4" />
              <span>Columns</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="h-120 overflow-y-auto">
                {table
                  .getAllColumns()
                  .filter(
                    (column) =>
                      typeof column.accessorFn !== 'undefined' &&
                      column.getCanHide(),
                  )
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onClick={(e) => {
                          column.toggleVisibility(!column.getIsVisible());
                          e.preventDefault();
                        }}
                      >
                        {column.columnDef.meta?.title ?? column.id}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <FileStack className="size-4" />
              <span>{`${table.getState().pagination.pageSize} per page`}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {[50, 100, 200, 500].map((pageSize) => (
                  <DropdownMenuItem
                    key={pageSize}
                    onClick={() => table.setPageSize(pageSize)}
                  >
                    {pageSize}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <LineChart className="size-4" />
              <span>Column summary</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {[null, 'page', 'all', 'selected'].map((value) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    onClick={() =>
                      table.setSummaryRow(() => value as SummaryRowState)
                    }
                    checked={table.getState().summaryRow === value}
                  >
                    {value === null
                      ? 'None'
                      : value === 'page'
                        ? 'Page'
                        : value === 'all'
                          ? 'All'
                          : 'Selected'}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <FileSpreadsheet className="size-4" />
              <span>Table density</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {['sm', 'md', 'lg'].map((value) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    onClick={() =>
                      table.setDensity(() => value as DensityState)
                    }
                    checked={table.getState().density === value}
                  >
                    {value === 'sm'
                      ? 'Dense'
                      : value === 'md'
                        ? 'Normal'
                        : 'Loose'}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
