'use client';
import * as React from 'react';

import { shallow } from 'zustand/shallow';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
} from '@radix-ui/react-icons';
import {
  ColumnFiltersState,
  getFilteredRowModel,
  type Row,
} from '@tanstack/react-table';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from '~/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableFooter,
  TableRow,
} from '~/components/ui/table';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  MixerHorizontalIcon,
} from '@radix-ui/react-icons';

import { Columns, FileSpreadsheet, FileStack, LineChart } from 'lucide-react';

import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';

import {
  ColumnDef,
  SortingState,
  functionalUpdate,
  makeStateUpdater,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  getCoreRowModel,
  useReactTable,
  VisibilityState,
  Column,
  Table as TableType,
  OnChangeFn,
  Updater,
  RowData,
  TableFeature,
} from '@tanstack/react-table';
import { ListState, ListStateChangers } from '~/contexts/List';
import { column } from '@observablehq/plot';
import { useStore } from '~/contexts/Zustand';

export type DensityState = 'sm' | 'md' | 'lg';
export interface DensityTableState {
  density: DensityState;
}
export interface DensityOptions {
  enableDensity?: boolean;
  onDensityChange?: OnChangeFn<DensityState>;
}
export interface DensityInstance {
  setDensity: (updater: Updater<DensityState>) => void;
  toggleDensity: (value?: DensityState) => void;
}
declare module '@tanstack/react-table' {
  interface TableState extends DensityTableState {}
  interface TableOptionsResolved<TData extends RowData>
    extends DensityOptions {}
  interface Table<TData extends RowData> extends DensityInstance {}
}
export const DensityFeature: TableFeature<any> = {
  getInitialState: (state): DensityTableState => {
    return {
      density: 'md',
      ...state,
    };
  },
  getDefaultOptions: <TData extends RowData>(
    table: TableType<TData>,
  ): DensityOptions => {
    return {
      enableDensity: true,
      onDensityChange: makeStateUpdater('density', table),
    } as DensityOptions;
  },
  createTable: <TData extends RowData>(table: TableType<TData>): void => {
    table.setDensity = (updater) => {
      const safeUpdater: Updater<DensityState> = (old) => {
        let newState = functionalUpdate(updater, old);
        return newState;
      };
      return table.options.onDensityChange?.(safeUpdater);
    };
    table.toggleDensity = (value) => {
      table.setDensity((old) => {
        if (value) return value;
        return old === 'lg' ? 'md' : old === 'md' ? 'sm' : 'lg'; //cycle through the 3 options
      });
    };
  },
};

export type SummaryRowState = null | 'page' | 'all' | 'selected';
export interface SummaryRowTableState {
  summaryRow: SummaryRowState;
}
export interface SummaryRowOptions {
  enableSummaryRow?: boolean;
  onSummaryRowChange?: OnChangeFn<SummaryRowState>;
}
export interface SummaryRowInstance {
  setSummaryRow: (updater: Updater<SummaryRowState>) => void;
}
declare module '@tanstack/react-table' {
  interface TableState extends SummaryRowTableState {}
  interface TableOptionsResolved<TData extends RowData>
    extends SummaryRowOptions {}
  interface Table<TData extends RowData> extends SummaryRowInstance {}
}
export const SummaryRowFeature: TableFeature<any> = {
  getInitialState: (state): SummaryRowTableState => {
    return {
      summaryRow: 'page',
      ...state,
    };
  },
  getDefaultOptions: <TData extends RowData>(
    table: TableType<TData>,
  ): SummaryRowOptions => {
    return {
      enableSummaryRow: true,
      onSummaryRowChange: makeStateUpdater('summaryRow', table),
    } as SummaryRowOptions;
  },
  createTable: <TData extends RowData>(table: TableType<TData>): void => {
    table.setSummaryRow = (updater) => {
      const safeUpdater: Updater<SummaryRowState> = (old) => {
        let newState = functionalUpdate(updater, old);
        return newState;
      };
      return table.options.onSummaryRowChange?.(safeUpdater);
    };
  },
};

interface DataTableViewOptionsProps<TData> {
  table: TableType<TData>;
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  return (
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
            <DropdownMenuSubContent className="h-96 overflow-y-auto">
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
                        e.preventDefault(); // Prevent the default behavior of closing the menu
                        //e.stopPropagation(); // Stop the event from bubbling up
                      }}
                    >
                      {(column.columnDef.meta as string) || column.id}
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
                  onClick={() => table.setSummaryRow(value)}
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
                  onClick={() => table.setDensity(value)}
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
  );
}

interface DataTablePaginationProps<TData>
  extends React.HTMLAttributes<HTMLDivElement> {
  table: TableType<TData>;
}
export function DataTablePagination<TData>({
  table,
  className,
}: DataTablePaginationProps<TData>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between bg-secondary px-2 py-1 text-xs',
        className,
      )}
    >
      <div className="text-muted-foreground">
        <span className="">
          {`${table.getFilteredSelectedRowModel().rows.length}/${table.getFilteredRowModel().rows.length}`}
        </span>
      </div>
      <DataTableViewOptions table={table} />
      <div className="flex items-center space-x-6 lg:space-x-8">
        <div className="w-[100px] items-center justify-center font-medium hidden md:flex">
          Page {table.getState().pagination.pageIndex + 1} of{' '}
          {table.getPageCount()}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
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
            className="hidden h-8 w-8 p-0 lg:flex"
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

interface DataTableColumnHeaderProps<TData, TValue>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  column: Column<TData, TValue>;
  title: React.ReactNode | string;
  table: TableType<ActivityColumn>;
  dropdown?: boolean;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  className,
  children,
  title,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{children}</div>;
  }

  return (
    <div className={cn('flex items-center space-x-2', className)}>
      <div className="flex-1">
        {title && <span className="w-4 h-4">{title}</span>}
        {children}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-4 px-0 data-[state=open]:bg-accent"
        onClick={() => column.toggleSorting()}
      >
        {column.getIsSorted() === 'desc' ? (
          <ArrowDownIcon className="h-4 w-4" />
        ) : column.getIsSorted() === 'asc' ? (
          <ArrowUpIcon className="h-4 w-4" />
        ) : (
          <CaretSortIcon className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

interface DataTableProps<TData, TValue> extends ListState, ListStateChangers {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  className?: string;
  columnVisibility: VisibilityState;
  sorting: SortingState;
  paginationControl?: boolean;
  selected: number[];
  setSelected: (updater: Updater<number[]>) => void;
  columnFilters: ColumnFiltersState;
}

export function DataTable<TData, TValue>({
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
  setSorting,
  setColumnVisibility,
  setSelected,
  setDensity,
  setColumnPinning,
  setSummaryRow,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    _features: [DensityFeature, SummaryRowFeature],
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getFilteredRowModel: getFilteredRowModel(), //<- important
    onRowSelectionChange: (updater) => {
      const updatedIDs = updater(
        Object.fromEntries(selected.map((id) => [id, true])),
      );
      setSelected(Object.keys(updatedIDs).map(Number));
    },
    onDensityChange: setDensity,
    onSummaryRowChange: setSummaryRow,
    onColumnPinningChange: setColumnPinning,
    initialState: {
      pagination: { pageSize: 50 },
    },
    state: {
      columnPinning,
      columnFilters,
      summaryRow,
      density,
      sorting,
      columnVisibility,
      rowSelection: Object.fromEntries(selected.map((id) => [id, true])),
    },
  });

  return (
    <div className={cn('flex flex-col', className)}>
      <Table
        id="table-main"
        className="text-xs border-separate border-spacing-0 table-fixed w-full"
        wrapperClassName="overflow-scroll min-h-0 w-full flex-1"
      >
        <TableHeader className="sticky [&_tr]:border-b-0">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="border-b-0">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    className={cn(
                      'py-0',
                      header.column.getIsPinned() &&
                        'sticky left-0 bg-muted border-border border-r border-b',
                    )}
                    key={header.id}
                    style={{
                      width: header.column.getSize(),
                      minWidth: header.column.getSize(),
                      //maxWidth: header.column.getSize(),
                    }}
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
              className={cn('border-b', !summaryRow && 'hidden')}
            >
              {footerGroup.headers.map((footer) => {
                return (
                  <TableHead
                    key={footer.id}
                    className={cn(
                      'h-8 border-b border-t border-border text-xs font-bold',
                      footer.column.getIsPinned() &&
                        'sticky left-0 bg-muted border-r border-border',
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
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                className="group"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    className={cn(
                      'bg-background group-data-[state=selected]:bg-muted',
                      cell.column.getIsPinned() &&
                        'sticky left-0 border-border border-r',
                      density == 'sm'
                        ? 'py-0 px-1'
                        : density == 'md'
                          ? 'py-1 px-2'
                          : 'p-2 text-sm',
                    )}
                    key={cell.id}
                    width={cell.column.getSize()}
                    style={{
                      width: cell.column.getSize(),
                      minWidth: cell.column.getSize(),
                      maxWidth: cell.column.getSize(),
                    }}
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
