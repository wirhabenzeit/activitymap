"use client";
import * as React from "react";

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
} from "@tanstack/react-table";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
} from "@radix-ui/react-icons";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "~/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";

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
} from "@radix-ui/react-icons";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ActivityColumn } from "./columns";
import { useStore } from "~/contexts/Zustand";
import { useShallow } from "zustand/shallow";

import { BellRing, Check } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { set } from "zod";

type CardProps = React.ComponentProps<typeof Card>;

function decFormatter(unit = "", decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0");
};

export function ActivityCard({ className, row, ...props }: CardProps) {
  const date = new Date(row.getValue("date") * 1000);
  const stats = [
    {
      title: "When?",
      description: date.toLocaleString("en-US"),
    },
    {
      title: "How long?",
      description: `Moving: ${duration(row.getValue("moving_time"))}, Elapsed: ${duration(
        row.getValue("elapsed_time"),
      )}`,
    },
    {
      title: "How far?",
      description: decFormatter("km", 1)(row.getValue("distance") / 1000),
    },
    {
      title: "How high?",
      description: `Gain: ${decFormatter("m", 0)(row.getValue("total_elevation_gain"))}, High: ${decFormatter(
        "m",
        0,
      )(row.getValue("elev_high"))}`,
    },
    ...(row.getValue("average_heartrate")
      ? [
          {
            title: "How hard?",
            description: `Avg: ${decFormatter("bpm", 0)(row.getValue("average_heartrate"))}, Max: ${decFormatter(
              "bpm",
              0,
            )(row.getValue("max_heartrate"))}`,
          },
        ]
      : []),
    ...(row.getValue("weighted_average_watts")
      ? [
          {
            title: "How strong?",
            description: `Normalized: ${decFormatter("W", 0)(row.getValue("weighted_average_watts"))} Avg: ${decFormatter("W", 0)(row.getValue("average_watts"))}, Max: ${decFormatter(
              "W",
              0,
            )(row.getValue("max_watts"))}`,
          },
        ]
      : []),
  ];

  return (
    <Card className={cn("w-[380px]", className)} {...props}>
      <CardHeader>
        <CardTitle>{row.getValue("name")}</CardTitle>
        <CardDescription>{row.getValue("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          {stats.map((stat, index) => (
            <div
              key={index}
              className="mb-4 grid grid-cols-[25px_1fr] items-start pb-0 last:mb-0 last:pb-0"
            >
              <span className="flex h-2 w-2 translate-y-1 rounded-full bg-sky-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">{stat.title}</p>
                <p className="text-sm text-muted-foreground">
                  {stat.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full" asChild>
          <a
            href={`https://strava.com/activities/${row.getValue("id")}`}
            target="_blank"
          >
            View on Strava
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

interface DataTableViewOptionsProps<TData> {
  table: TableType<TData>;
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto hidden h-8 lg:flex"
        >
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
              typeof column.accessorFn !== "undefined" && column.getCanHide(),
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
        "flex items-center justify-between bg-secondary px-2 py-1 text-xs",
        className,
      )}
    >
      <div className="flex-1 text-muted-foreground">
        <span className="hidden md:inline">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} activities selected.
        </span>
      </div>
      <div className="flex items-center space-x-6 lg:space-x-8">
        <div className="flex items-center space-x-2">
          <p className="font-medium">Page size</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {[50, 100, 200].map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-[100px] items-center justify-center font-medium">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
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
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
  table: TableType<ActivityColumn>;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  table,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
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
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-4 px-0 data-[state=open]:bg-accent"
        onClick={() => column.toggleSorting()}
      >
        {column.getIsSorted() === "desc" ? (
          <ArrowDownIcon className="h-4 w-4" />
        ) : column.getIsSorted() === "asc" ? (
          <ArrowUpIcon className="h-4 w-4" />
        ) : (
          <CaretSortIcon className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  // const [sorting, setSorting] = React.useState<SortingState>([
  //   { id: "id", desc: true },
  // ]);
  // const [columnVisibility, setColumnVisibility] =
  //   React.useState<VisibilityState>({
  //     id: false,
  //     sport_type: false,
  //     moving_time: false,
  //     elev_high: false,
  //     elev_low: false,
  //     weighted_average_watts: false,
  //     max_watts: false,
  //     max_heartrate: false,
  //     kudos_count: false,
  //     average_heartrate: false,
  //   });

  const {
    selected,
    setSelected,
    sorting,
    setSorting,
    columnVisibility,
    setColumnVisibility,
  } = useStore(
    useShallow((state) => ({
      selected: state.selected,
      setSelected: state.setSelected,
      sorting: state.fullList.sorting,
      columnVisibility: state.fullList.columnVisibility,
      setSorting: state.fullList.setSorting,
      setColumnVisibility: state.fullList.setColumnVisibility,
    })),
  );

  const onRowSelection = (updater) => {
    const updatedIDs = updater(
      Object.fromEntries(selected.map((id) => [id, true])),
    );
    setSelected(Object.keys(updatedIDs).map(Number));
  };

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: onRowSelection,
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
    <div className="flex h-full w-full flex-col">
      <ScrollArea className="h-full w-full overflow-scroll [&>div>div[style]]:!block">
        <Table
          id="table-main"
          className="relative min-h-0 w-full flex-1 text-xs"
        >
          <TableHeader className="sticky">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      className="py-1"
                      key={header.id}
                      style={{
                        width: `${header.getSize()}px`,
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
          </TableHeader>
          <TableBody className="min-h-0 flex-1">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <Popover key={row.id}>
                  <PopoverTrigger asChild>
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          className="py-1"
                          key={cell.id}
                          width={cell.column.columnDef.size}
                          style={{
                            maxWidth: cell.column.columnDef.size,
                            minWidth: cell.column.columnDef.size,
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  </PopoverTrigger>
                  <PopoverContent asChild>
                    <ActivityCard className="w-400 p-0" row={row} />
                  </PopoverContent>
                </Popover>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
      <DataTablePagination table={table} className="" />
    </div>
  );
}
