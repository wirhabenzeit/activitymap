'use client';

import * as React from 'react';

import {
  type ColumnDef,
  type ColumnVisibilityState,
  type ColumnPinningState,
  type SortingState,
  type ColumnFiltersState,
  type Updater,
  type RowSelectionState,
  type RowData,
  type Row,
  type TableFeatures,
  useTable,
  flexRender,
} from '@tanstack/react-table';

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
  type Features,
  features,
} from './table-extensions';

interface ListState {
  density: DensityState;
  columnPinning: ColumnPinningState;
  summaryRow: SummaryRowState;
  fitWidth?: boolean;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- Generic params in TanStack declaration merging are required by upstream types. */
declare module '@tanstack/react-table' {
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue,
  > {
    width: string;
    title: string;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

interface ListActions {
  setSorting: (updater: Updater<SortingState>) => void;
  setColumnVisibility: (updater: Updater<ColumnVisibilityState>) => void;
  setDensity: (updater: Updater<DensityState>) => void;
  setColumnPinning: (updater: Updater<ColumnPinningState>) => void;
  setSummaryRow: (updater: Updater<SummaryRowState>) => void;
  setFitWidth?: (updater: Updater<boolean>) => void;
}

interface DataTableProps<TData extends RowData> extends ListState, ListActions {
  columns: ColumnDef<Features, TData>[];
  data: TData[];
  className?: string;
  columnVisibility: ColumnVisibilityState;
  sorting: SortingState;
  paginationControl?: boolean;
  selected: number[];
  setSelected: (updater: Updater<number[]>) => void;
  columnFilters: ColumnFiltersState;
  activeId?: number;
  headerClassName?: string;
  cellClassName?: string;
  onRowClick?: (row: Row<Features, TData>) => void;
  renderInlineDetails?: (row: Row<Features, TData>) => React.ReactNode;
  renderSingleDetails?: (row: Row<Features, TData>) => React.ReactNode;
  /** Fade the bottom edge while more rows are hidden below the fold. */
  scrollHint?: boolean;
}

interface RowWithId {
  id: number;
}

export const DataTable = React.memo(function DataTable<
  TData extends RowWithId & RowData,
>({
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
  activeId,
  headerClassName,
  cellClassName,
  onRowClick,
  renderInlineDetails,
  renderSingleDetails,
  scrollHint = false,
  setSorting,
  setColumnVisibility,
  setSelected,
  setDensity,
  setColumnPinning,
  setSummaryRow,
  fitWidth = false,
  setFitWidth,
}: DataTableProps<TData>) {
  const table = useTable({
    features,
    data,
    columns,
    getRowId: (row) => row.id.toString(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const selection =
        typeof updater === 'function'
          ? updater(Object.fromEntries(selected.map((id) => [id, true])))
          : updater;
      setSelected(Object.keys(selection).map(Number));
    },
    getRowCanExpand: () => Boolean(renderInlineDetails),
    getIsRowExpanded: (row) => Number(row.id) === activeId,
    onDensityChange: setDensity,
    onSummaryRowChange: setSummaryRow,
    onFitWidthChange: setFitWidth,
    onColumnPinningChange: setColumnPinning,
    initialState: {
      // Without pagination controls every row must be reachable.
      pagination: {
        pageIndex: 0,
        pageSize: paginationControl ? 200 : Number.MAX_SAFE_INTEGER,
      },
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
      fitWidth,
      rowSelection: Object.fromEntries(selected.map((id) => [id, true])),
      expanded: activeId ? { [activeId]: true } : {},
    },
  });

  const containerRef = React.useRef<HTMLDivElement>(null);

  // With fitWidth, keep pinned columns plus as many following columns as fit
  // at their natural width, instead of scrolling sideways. Natural widths come
  // from a hidden sizing row (header and summary at max-content), so they
  // follow each column's real content rather than a guessed minimum.
  const [availableWidth, setAvailableWidth] = React.useState(0);
  React.useEffect(() => {
    const scroller =
      containerRef.current?.querySelector('#table-main')?.parentElement;
    if (!fitWidth || !scroller) return;
    const observer = new ResizeObserver(() =>
      setAvailableWidth(scroller.clientWidth),
    );
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [fitWidth]);
  const visibleColumns = table.getVisibleFlatColumns();
  const sizerRef = React.useRef<HTMLTableRowElement>(null);
  const [naturalWidths, setNaturalWidths] = React.useState<
    Record<string, number>
  >({});
  React.useLayoutEffect(() => {
    const cells = sizerRef.current?.children;
    if (!fitWidth || !cells) return;
    // The observer below only reports later resizes; read the current width
    // too, since the table can mount before it has its final layout.
    const scroller =
      containerRef.current?.querySelector('#table-main')?.parentElement;
    if (scroller) setAvailableWidth(scroller.clientWidth);
    const measured: Record<string, number> = {};
    visibleColumns.forEach((column, index) => {
      const cell = cells[index];
      if (cell)
        measured[column.id] = Math.ceil(cell.getBoundingClientRect().width);
    });
    setNaturalWidths((current) =>
      JSON.stringify(current) === JSON.stringify(measured) ? current : measured,
    );
    // Summary values (data) and density change what the sizer renders.
  }, [fitWidth, visibleColumns, data, summaryRow, density]);
  const fallbackWidth = (width?: string) =>
    Number(/(\d+)px/.exec(width ?? '')?.[1] ?? 80);
  const widthOf = (column: (typeof visibleColumns)[number]) =>
    naturalWidths[column.id] ?? fallbackWidth(column.columnDef.meta?.width);
  const shownColumnIds = React.useMemo(() => {
    const ids = visibleColumns.map((column) => column.id);
    if (!fitWidth || availableWidth === 0) return new Set(ids);
    const pinned = visibleColumns.filter((column) => column.getIsPinned());
    let used = pinned.reduce((sum, column) => sum + widthOf(column), 0);
    const shown = new Set(pinned.map((column) => column.id));
    for (const column of visibleColumns) {
      if (column.getIsPinned()) continue;
      used += widthOf(column);
      // Stop at the first column that overflows so the order stays intact.
      if (used > availableWidth) break;
      shown.add(column.id);
    }
    return shown;
    // widthOf only reads naturalWidths and the columns' declared widths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleColumns, fitWidth, availableWidth, naturalWidths]);
  const hiddenByFit = React.useMemo(
    () =>
      new Set(
        visibleColumns
          .filter((column) => !shownColumnIds.has(column.id))
          .map((column) => column.id),
      ),
    [visibleColumns, shownColumnIds],
  );
  /** In fit mode, a column may shrink to its natural width, not its default. */
  const trackWidth = (column: (typeof visibleColumns)[number]) => {
    const width = column.columnDef.meta?.width;
    if (!fitWidth || naturalWidths[column.id] === undefined) return width;
    const grow = /([\d.]+fr)/.exec(width ?? '')?.[1] ?? '1fr';
    return `minmax(${naturalWidths[column.id]}px, ${grow})`;
  };
  const isShown = (columnId: string) => shownColumnIds.has(columnId);
  const [moreBelow, setMoreBelow] = React.useState(false);
  const updateMoreBelow = React.useCallback(() => {
    const scroller =
      containerRef.current?.querySelector('#table-main')?.parentElement;
    if (!scroller) return;
    setMoreBelow(
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 4,
    );
  }, []);

  // Bring a newly opened card into view below the sticky header, but only
  // when part of it is hidden, so opening a visible row doesn't jump.
  React.useEffect(() => {
    const container = containerRef.current;
    const scroller = container?.querySelector('#table-main')?.parentElement;
    const active = container?.querySelector('[data-active-row]');
    if (!scroller || !active) return;
    const header = container?.querySelector('thead');
    const view = scroller.getBoundingClientRect();
    const top = view.top + (header?.getBoundingClientRect().height ?? 0);
    const card = active.getBoundingClientRect();
    if (card.top >= top && card.bottom <= view.bottom) return;
    scroller.scrollTo({ top: scroller.scrollTop + card.top - top });
  }, [activeId, sorting]);

  React.useEffect(() => {
    if (!scrollHint) return;
    updateMoreBelow();
    const scroller =
      containerRef.current?.querySelector('#table-main')?.parentElement;
    if (!scroller) return;
    const observer = new ResizeObserver(updateMoreBelow);
    observer.observe(scroller);
    observer.observe(scroller.firstElementChild ?? scroller);
    return () => observer.disconnect();
  }, [scrollHint, updateMoreBelow, data.length, activeId]);

  const singleRow = table.getRowModel().rows[0];
  if (data.length === 1 && singleRow && renderSingleDetails) {
    return (
      <div className={cn('overflow-y-auto', className)}>
        {renderSingleDetails(singleRow)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative flex flex-col', className)}
      onScrollCapture={scrollHint ? updateMoreBelow : undefined}
    >
      <Table
        id="table-main"
        className="text-xs grid"
        // An inline-size container lets expanded cards match the visible
        // width (100cqw) instead of the full, horizontally scrolling table.
        wrapperClassName={cn(
          'overflow-scroll min-h-0 w-full flex-1 [container-type:inline-size]',
          fitWidth && 'overflow-x-hidden',
        )}
        style={{
          gridTemplateColumns: visibleColumns
            .filter((column) => isShown(column.id))
            .map(trackWidth)
            .join(' '),
        }}
      >
        <TableHeader
          className={cn(
            'sticky [&_tr]:border-b-0 grid grid-cols-subgrid col-span-full',
            headerClassName,
          )}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="border-b-0 grid grid-cols-subgrid col-span-full"
            >
              {headerGroup.headers
                .filter((header) => isShown(header.column.id))
                .map((header) => {
                  return (
                    <TableHead
                      className={cn(
                        'py-0 flex items-center',
                        header.column.getIsPinned() == 'start' &&
                          'sticky left-0 bg-muted border-border border-r',
                        header.column.getIsPinned() == 'end' &&
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
              {footerGroup.headers
                .filter((footer) => isShown(footer.column.id))
                .map((footer) => {
                  return (
                    <TableHead
                      key={footer.id}
                      className={cn(
                        'h-8 border-b border-t border-border text-xs font-bold flex items-center',
                        footer.column.getIsPinned() == 'start' &&
                          'sticky left-0 bg-muted border-r border-border',
                        footer.column.getIsPinned() == 'end' &&
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
              <React.Fragment key={row.id}>
                {row.getIsExpanded() && renderInlineDetails ? (
                  // The expanded card replaces its row rather than repeating it.
                  <TableRow
                    data-active-row
                    className="grid grid-cols-subgrid col-span-full ring-1 ring-inset ring-orange-500"
                  >
                    <TableCell
                      colSpan={row.getVisibleCells().length}
                      className="col-span-full p-0 bg-background"
                    >
                      <div className="sticky left-0 w-[100cqw]">
                        {renderInlineDetails(row)}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow
                    data-state={row.getIsSelected() && 'selected'}
                    className={cn(
                      'group grid grid-cols-subgrid col-span-full',
                      onRowClick && 'cursor-pointer',
                    )}
                    {...(onRowClick && {
                      tabIndex: 0,
                      onClick: (event: React.MouseEvent) => {
                        const target = event.target as Element;
                        // Ignore clicks bubbling up from portals (e.g. the edit
                        // dialog) and from controls inside the row.
                        if (
                          !event.currentTarget.contains(target) ||
                          target.closest(
                            'button, a, input, select, textarea, [role="menuitem"]',
                          )
                        )
                          return;
                        onRowClick(row);
                      },
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      },
                    })}
                  >
                    {row
                      .getVisibleCells()
                      .filter((cell) => isShown(cell.column.id))
                      .map((cell) => (
                        <TableCell
                          className={cn(
                            'bg-background group-data-[state=selected]:bg-muted flex items-center',
                            cell.column.getIsPinned() == 'start' &&
                              'sticky left-0 border-border border-r',
                            cell.column.getIsPinned() == 'end' &&
                              'sticky right-0 border-border border-l',
                            density == 'sm'
                              ? 'py-1 px-1'
                              : density == 'md'
                                ? 'p-2'
                                : 'py-3 px-2 text-sm',
                            cellClassName,
                          )}
                          key={cell.id}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                  </TableRow>
                )}
              </React.Fragment>
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
      {fitWidth && (
        <table
          aria-hidden
          inert
          className="pointer-events-none invisible absolute left-0 top-0 grid h-0 overflow-hidden text-xs"
          style={{
            gridTemplateColumns: `repeat(${visibleColumns.length}, max-content)`,
          }}
        >
          <TableHeader className="grid grid-cols-subgrid col-span-full">
            <TableRow
              ref={sizerRef}
              className="grid grid-cols-subgrid col-span-full"
            >
              {visibleColumns.map((column) => {
                const header = table
                  .getFlatHeaders()
                  .find((entry) => entry.column.id === column.id);
                return (
                  <TableHead key={column.id} className="py-0 flex items-center">
                    {header &&
                      flexRender(column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
            <TableRow className="grid grid-cols-subgrid col-span-full">
              {visibleColumns.map((column) => {
                const footer = table
                  .getFooterGroups()[0]
                  ?.headers.find((entry) => entry.column.id === column.id);
                return (
                  <TableHead
                    key={column.id}
                    className="h-8 text-xs font-bold flex items-center"
                  >
                    {summaryRow &&
                      footer &&
                      flexRender(column.columnDef.footer, footer.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
        </table>
      )}
      {scrollHint && moreBelow && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />
      )}
      {paginationControl && (
        <DataTablePagination table={table} hiddenByFit={hiddenByFit} />
      )}
    </div>
  );
}) as <TData extends RowWithId & RowData>(
  props: DataTableProps<TData>,
) => React.ReactElement;
