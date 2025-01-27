'use client';
import * as React from 'react';

import {
  ColumnDef,
  SortingState,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  getCoreRowModel,
  useReactTable,
  VisibilityState,
  Column,
  Table as TableType,
} from '@tanstack/react-table';
import Link from 'next/link';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
} from '@radix-ui/react-icons';
import { type Row } from '@tanstack/react-table';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '~/components/ui/hover-card';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  MixerHorizontalIcon,
} from '@radix-ui/react-icons';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { ActivityColumn } from './columns';
import { useStore } from '~/contexts/Zustand';
import { useShallow } from 'zustand/shallow';

import { BellRing, Check } from 'lucide-react';

import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { set } from 'zod';

interface DataTableViewOptionsProps<TData> {
  table: TableType<TData>;
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <MixerHorizontalIcon className="mr-2 h-4 w-4" />
          View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[150px]">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter(
            (column) =>
              typeof column.accessorFn !== 'undefined' && column.getCanHide(),
          )
          .map((column) => {
            return (
              <DropdownMenuCheckboxItem
                key={column.id}
                className="capitalize"
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            );
          })}
        <DropdownMenuLabel>Page size</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[50, 100, 200].map((pageSize) => (
          <DropdownMenuCheckboxItem
            key={pageSize}
            checked={table.getState().pagination.pageSize === pageSize}
            onClick={() => table.setPageSize(pageSize)}
          >
            {pageSize}
          </DropdownMenuCheckboxItem>
        ))}
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
  title,
  className,
  dropdown = true,
  table,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  return (
    <div className={cn('flex items-center space-x-2', className)}>
      {dropdown ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="flex-1">
            <Button
              variant="link"
              size="sm"
              className="h-8 justify-center px-0 data-[state=open]:bg-accent"
            >
              {title}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span>{title}</span>
      )}
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

export function DataTable<TData, TValue>({
  className,
  columns,
  data,
  columnVisibility,
  sorting,
  setSorting,
  setColumnVisibility,
  selected,
  setSelected,
  paginationControl = true,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater) => {
      const updatedIDs = updater(
        Object.fromEntries(selected.map((id) => [id, true])),
      );
      setSelected(Object.keys(updatedIDs).map(Number));
    },
    initialState: {
      pagination: {
        pageSize: 50,
      },
    },
    state: {
      sorting,
      columnVisibility,
      rowSelection: Object.fromEntries(selected.map((id) => [id, true])),
    },
  });

  return (
    <div className={cn('flex flex-col', className)}>
      <Table
        id="table-main"
        className="text-xs border-separate border-spacing-0 table-fixed"
        wrapperClassName="overflow-scroll min-h-0 w-full flex-1"
      >
        <TableHeader className="sticky [&_tr]:border-b-0">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="border-b-0">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    className="py-0"
                    key={header.id}
                    style={{ width: header.column.getSize() }}
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
            <TableRow key={footerGroup.id} className="border-b">
              {footerGroup.headers.map((footer) => {
                return (
                  <TableHead
                    key={footer.id}
                    className="py-0 h-8 border-b border-t border-muted/50"
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
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    className="py-1"
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
