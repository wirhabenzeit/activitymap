'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type ColumnVisibilityState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type TableFeatures,
  type Updater,
  flexRender,
  useTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import {
  useBrowsingState,
  useRetainedScroll,
} from '~/hooks/use-browsing-context';
import {
  useDateFormat,
  useDisplayUnits,
} from '~/hooks/use-display-preferences';
import { useElementSize } from '~/hooks/use-element-size';
import { sortActivities } from '~/lib/activity-presentation';
import { speedDisplayForSports } from '~/lib/speed-display';
import { cn } from '~/lib/utils';

import { DataTablePagination } from './data-table-pagination';
import { type DetailPresentation, inspectionStep } from './inspection';
import { ListDetailTransition } from './list-detail-transition';
import { SpeedDisplayContext } from './speed-display-context';
import {
  type DensityState,
  type Features,
  type SummaryRowState,
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
    minWidth?: number;
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
  browsingKey?: 'list';
  browsingDataReady?: boolean;
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
  /** Map emphasis is independent of whether a detail is open. */
  highlightedId?: number;
  headerClassName?: string;
  cellClassName?: string;
  onRowClick?: (row: Row<Features, TData>) => void;
  /** An adaptive detail view; the table stays mounted throughout inspection. */
  renderDetails?: (row: Row<Features, TData>) => React.ReactNode;
  onDetailBack?: () => void;
  detailBackLabel?: string;
  detailNavigation?: React.ReactNode;
  /** A host can put Back in its persistent toolbar instead of a second header. */
  detailBackButtonRef?: React.RefObject<HTMLButtonElement | null>;
  detailPresentation?: DetailPresentation;
  /** Browse the complete filtered/sorted order, including other pages. */
  detailStepping?: boolean;
  /** Travels with the retained list during the detail transition. */
  listHeader?: React.ReactNode;
  /** Fade the bottom edge while more rows are hidden below the fold. */
  scrollHint?: boolean;
  /** Report whether the list has hidden rows, independent of its scroll position. */
  onOverflowChange?: (overflow: boolean) => void;
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
  highlightedId,
  headerClassName,
  cellClassName,
  onRowClick,
  renderDetails,
  onDetailBack,
  detailBackLabel = 'Back to activities',
  detailNavigation,
  detailBackButtonRef,
  detailPresentation = 'push',
  detailStepping = false,
  listHeader,
  scrollHint = false,
  onOverflowChange,
  setSorting,
  setColumnVisibility,
  setSelected,
  setDensity,
  setColumnPinning,
  setSummaryRow,
  fitWidth = false,
  setFitWidth,
  browsingKey,
  browsingDataReady = true,
}: DataTableProps<TData>) {
  const [pagination, setPagination] = useBrowsingState(
    browsingKey && `${browsingKey}:pagination`,
    {
      pageIndex: 0,
      pageSize: paginationControl ? 200 : Number.MAX_SAFE_INTEGER,
    },
  );
  const units = useDisplayUnits();
  const dateFormat = useDateFormat();
  const panelOpen = !!(
    renderDetails &&
    activeId &&
    detailPresentation === 'panel'
  );
  // Inspection reserves name/date without changing the chosen width mode.
  // Width controls use the saved fitWidth and pinning state in both layouts.
  const layoutVisibility = React.useMemo(
    () =>
      panelOpen
        ? { ...columnVisibility, name: true, date: true }
        : columnVisibility,
    [panelOpen, columnVisibility],
  );
  const speedDisplay = React.useMemo(() => {
    const ids = columnFilters.find((filter) => filter.id === 'id')?.value as
      ReadonlySet<number> | undefined;
    const included = ids;
    return speedDisplayForSports(
      data
        .filter((activity) => !included || included.has(activity.id))
        .map((activity) => (activity as { sport_type?: string }).sport_type),
    );
  }, [data, columnFilters]);
  const sortedData = React.useMemo(
    () => sortActivities(data, sorting, speedDisplay),
    [data, sorting, speedDisplay],
  );
  const table = useTable({
    manualSorting: true,
    enableMultiSort: false,
    // Stream/photo updates must not undo inspection's page navigation. The
    // inspected index below keeps its page aligned with sort/filter changes.
    autoResetPageIndex: !browsingKey && !(detailStepping && activeId),
    features,
    data: sortedData,
    columns,
    getRowId: (row) => row.id.toString(),
    onSortingChange: setSorting,
    ...(browsingKey && { onPaginationChange: setPagination }),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const selection =
        typeof updater === 'function'
          ? updater(Object.fromEntries(selected.map((id) => [id, true])))
          : updater;
      setSelected((previous) => {
        const requested = new Set(
          Object.keys(selection)
            .filter((id) => selection[id])
            .map(Number),
        );
        // A filtered/page toggle cannot silently discard hidden selection.
        const dataIDs = new Set(data.map((row) => row.id));
        return [
          ...new Set([
            ...previous.filter((id) => !dataIDs.has(id)),
            ...requested,
          ]),
        ];
      });
    },
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
      columnVisibility: layoutVisibility,
      sorting,
      columnFilters,
      columnPinning,
    },
    state: {
      ...(browsingKey && { pagination }),
      columnVisibility: layoutVisibility,
      sorting,
      columnFilters,
      columnPinning,
      density,
      summaryRow,
      fitWidth,
      rowSelection: Object.fromEntries(selected.map((id) => [id, true])),
    },
  });

  const containerRef = React.useRef<HTMLDivElement>(null);
  useRetainedScroll(
    containerRef,
    browsingKey && `${browsingKey}:scroll`,
    '#table-main',
  );
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const lastInspectionRef = React.useRef(0);
  const pendingFocusRef = React.useRef(0);

  // With fitWidth, keep pinned columns plus as many following columns as fit
  // at their natural width, instead of scrolling sideways. Natural widths come
  // from a hidden sizing row (header and summary at max-content), so they
  // follow each column's real content rather than a guessed minimum.
  const [measureScroller, { width: availableWidth }] =
    useElementSize<HTMLElement>({
      box: 'client',
    });
  const measureTable = React.useCallback(
    (element: HTMLTableElement | null) =>
      measureScroller(element?.parentElement ?? null),
    [measureScroller],
  );
  const visibleColumns = table.getVisibleFlatColumns();
  const sizerRef = React.useRef<HTMLTableRowElement>(null);
  const [naturalWidths, setNaturalWidths] = React.useState<
    Record<string, number>
  >({});
  React.useLayoutEffect(() => {
    const cells = sizerRef.current?.children;
    if (!fitWidth || !cells) return;
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
  }, [fitWidth, visibleColumns, data, summaryRow, density, units, dateFormat]);
  const fallbackWidth = (width?: string) =>
    Number(/(\d+)px/.exec(width ?? '')?.[1] ?? 80);
  const widthOf = (column: (typeof visibleColumns)[number]) =>
    Math.max(
      column.columnDef.meta?.minWidth ?? 0,
      panelOpen
        ? column.id === 'name'
          ? 200
          : column.id === 'date'
            ? 96
            : 0
        : 0,
      naturalWidths[column.id] ?? fallbackWidth(column.columnDef.meta?.width),
    );
  const shownColumnIds = React.useMemo(() => {
    const ids = visibleColumns.map((column) => column.id);
    if (!fitWidth || availableWidth === 0) return new Set(ids);
    const pinned = visibleColumns.filter((column) =>
      panelOpen
        ? column.id === 'name' || column.id === 'date'
        : column.getIsPinned(),
    );
    let used = pinned.reduce((sum, column) => sum + widthOf(column), 0);
    const shown = new Set(pinned.map((column) => column.id));
    for (const column of visibleColumns) {
      if (shown.has(column.id)) continue;
      used += widthOf(column);
      // Stop at the first column that overflows so the order stays intact.
      if (used > availableWidth) break;
      shown.add(column.id);
    }
    return shown;
    // widthOf only reads naturalWidths and the columns' declared widths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleColumns, fitWidth, panelOpen, availableWidth, naturalWidths]);
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
    return `minmax(${widthOf(column)}px, ${grow})`;
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
    onOverflowChange?.(scroller.scrollHeight - scroller.clientHeight > 4);
  }, [onOverflowChange]);

  React.useEffect(() => {
    if (!scrollHint && !onOverflowChange) return;
    updateMoreBelow();
    const scroller =
      containerRef.current?.querySelector('#table-main')?.parentElement;
    if (!scroller) return;
    const observer = new ResizeObserver(updateMoreBelow);
    observer.observe(scroller);
    observer.observe(scroller.firstElementChild ?? scroller);
    return () => observer.disconnect();
  }, [scrollHint, onOverflowChange, updateMoreBelow, data.length, activeId]);

  const inspectionRows = table.getFilteredRowModel().rows;
  React.useEffect(() => {
    if (!browsingKey || !browsingDataReady) return;
    const lastPage = Math.max(
      0,
      Math.ceil(inspectionRows.length / pagination.pageSize) - 1,
    );
    if (pagination.pageIndex > lastPage)
      setPagination((previous) => ({ ...previous, pageIndex: lastPage }));
  }, [
    browsingKey,
    browsingDataReady,
    data.length,
    inspectionRows.length,
    pagination.pageSize,
    pagination.pageIndex,
    setPagination,
  ]);
  const inspectionIndex = inspectionRows.findIndex(
    (row) => Number(row.id) === activeId,
  );
  const detailRow = renderDetails ? inspectionRows[inspectionIndex] : undefined;
  const pageIndex = table.store.state.pagination.pageIndex;
  // TanStack v9 returns a new React wrapper each render. Depend on its stable
  // APIs so ordinary pagination does not reset back to the inspected row.
  const {
    setPageIndex,
    getFilteredRowModel,
    getRowModel,
    store: tableStore,
  } = table;
  const step = (direction: -1 | 1) => {
    const next = inspectionStep(
      inspectionRows,
      activeId ?? 0,
      direction,
      table.store.state.pagination.pageSize,
    );
    if (!next || !onRowClick) return;
    table.setPageIndex(next.pageIndex);
    onRowClick(next.row);
  };

  React.useLayoutEffect(() => {
    if (!detailStepping) return;
    if (activeId && inspectionIndex >= 0) {
      lastInspectionRef.current = activeId;
      setPageIndex(
        Math.floor(inspectionIndex / tableStore.state.pagination.pageSize),
      );
    } else if (!activeId && lastInspectionRef.current) {
      // The table remains interactive, so it may have been paged away from the
      // inspected row. Browser Back and Close both return to that row's page.
      const previousIndex = getFilteredRowModel().rows.findIndex(
        (row) => Number(row.id) === lastInspectionRef.current,
      );
      pendingFocusRef.current =
        previousIndex >= 0
          ? lastInspectionRef.current
          : Number(getRowModel().rows[0]?.id ?? 0);
      lastInspectionRef.current = 0;
      if (previousIndex >= 0)
        setPageIndex(
          Math.floor(previousIndex / tableStore.state.pagination.pageSize),
        );
    }
  }, [
    activeId,
    inspectionIndex,
    detailStepping,
    setPageIndex,
    getFilteredRowModel,
    getRowModel,
    tableStore,
  ]);

  React.useLayoutEffect(() => {
    const focusId =
      activeId !== undefined && activeId > 0
        ? activeId
        : pendingFocusRef.current;
    if (!detailStepping || !focusId) return;
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-activity-id="${focusId}"]`,
    );
    if (!row) return;
    returnFocusRef.current = row;
    if (!activeId) {
      row.focus({ preventScroll: true });
      pendingFocusRef.current = 0;
      return;
    }
    // Scroll only the table, never its ancestors or the detail. Instant scrolling
    // also respects reduced motion, including when stepping across pages.
    const scroller =
      containerRef.current?.querySelector('#table-main')?.parentElement;
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const headerHeight =
      scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    if (rowBounds.top < bounds.top + headerHeight)
      scroller.scrollTop += rowBounds.top - bounds.top - headerHeight;
    else if (rowBounds.bottom > bounds.bottom)
      scroller.scrollTop += rowBounds.bottom - bounds.bottom;
  }, [activeId, pageIndex, detailStepping]);

  const content = (
    <div
      ref={containerRef}
      className={cn('relative flex flex-col', className)}
      onScrollCapture={
        scrollHint || onOverflowChange ? updateMoreBelow : undefined
      }
    >
      <ListDetailTransition
        detailId={activeId ?? 0}
        detail={detailRow && renderDetails?.(detailRow)}
        onBack={onDetailBack ?? (() => undefined)}
        backLabel={detailBackLabel}
        externalBackRef={detailBackButtonRef}
        returnFocus={returnFocusRef}
        presentation={detailPresentation}
        onStep={detailStepping ? step : undefined}
        navigation={
          detailStepping ? (
            <div className="flex min-w-0 items-center gap-1 text-xs tabular-nums">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Previous activity"
                disabled={inspectionIndex <= 0}
                onClick={() => step(-1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span
                className="whitespace-nowrap"
                aria-label={`Activity ${inspectionIndex + 1} of ${inspectionRows.length}`}
              >
                {inspectionIndex + 1}/{inspectionRows.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Next activity"
                disabled={
                  inspectionIndex < 0 ||
                  inspectionIndex >= inspectionRows.length - 1
                }
                onClick={() => step(1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            detailNavigation
          )
        }
      >
        {listHeader}
        <Table
          ref={fitWidth ? measureTable : undefined}
          id="table-main"
          className="grid text-xs"
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
              'sticky col-span-full grid grid-cols-subgrid [&_tr]:border-b-0',
              headerClassName,
            )}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="col-span-full grid grid-cols-subgrid border-b-0"
              >
                {headerGroup.headers
                  .filter((header) => isShown(header.column.id))
                  .map((header) => {
                    return (
                      <TableHead
                        className={cn(
                          'flex items-center py-0',
                          header.column.getIsPinned() == 'start' &&
                            'sticky left-0 z-1 border-r border-border bg-muted',
                          header.column.getIsPinned() == 'end' &&
                            'sticky right-0 z-1 border-l border-border bg-muted',
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
                  'col-span-full grid grid-cols-subgrid border-b',
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
                          'flex h-8 items-center border-t border-b border-border text-xs font-bold',
                          footer.column.getIsPinned() == 'start' &&
                            'sticky left-0 z-1 border-r border-border bg-muted',
                          footer.column.getIsPinned() == 'end' &&
                            'sticky right-0 z-1 border-l border-border bg-muted',
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
          <TableBody className="col-span-full grid grid-cols-subgrid">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-activity-id={row.id}
                  data-detail-origin={Number(row.id) === activeId || undefined}
                  data-map-highlighted={
                    Number(row.id) === highlightedId || undefined
                  }
                  aria-current={
                    (detailStepping && Number(row.id) === activeId) ||
                    Number(row.id) === highlightedId
                      ? 'true'
                      : undefined
                  }
                  data-state={row.getIsSelected() && 'selected'}
                  className={cn(
                    'group col-span-full grid grid-cols-subgrid',
                    onRowClick && 'cursor-pointer',
                  )}
                  {...(onRowClick && {
                    tabIndex: 0,
                    onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
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
                      returnFocusRef.current = event.currentTarget;
                      onRowClick(row);
                    },
                    onKeyDown: (
                      event: React.KeyboardEvent<HTMLTableRowElement>,
                    ) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        returnFocusRef.current = event.currentTarget;
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
                          'flex items-center bg-background group-data-[state=selected]:bg-muted',
                          // Blend into an opaque surface so pinned cells cover
                          // scrolling content even when inspected or selected.
                          ((detailStepping && Number(row.id) === activeId) ||
                            Number(row.id) === highlightedId) &&
                            'bg-[color:color-mix(in_srgb,var(--color-header-background)_10%,var(--color-background))] group-data-[state=selected]:bg-[color:color-mix(in_srgb,var(--color-header-background)_10%,var(--color-muted))]',
                          detailStepping &&
                            Number(row.id) === activeId &&
                            'border-y border-header-background/40',
                          ((detailStepping && Number(row.id) === activeId) ||
                            Number(row.id) === highlightedId) &&
                            cell.column.id === 'name' &&
                            'shadow-[inset_3px_0_0_var(--color-header-background)]',
                          cell.column.getIsPinned() == 'start' &&
                            'sticky left-0 z-1 border-r border-border',
                          cell.column.getIsPinned() == 'end' &&
                            'sticky right-0 z-1 border-l border-border',
                          density == 'sm'
                            ? 'px-1 py-1'
                            : density == 'md'
                              ? 'p-2'
                              : 'px-2 py-3 text-sm',
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
        {fitWidth && (
          <table
            aria-hidden
            inert
            className="pointer-events-none invisible absolute top-0 left-0 grid h-0 overflow-hidden text-xs"
            style={{
              gridTemplateColumns: `repeat(${visibleColumns.length}, max-content)`,
            }}
          >
            <TableHeader className="col-span-full grid grid-cols-subgrid">
              <TableRow
                ref={sizerRef}
                className="col-span-full grid grid-cols-subgrid"
              >
                {visibleColumns.map((column) => {
                  const header = table
                    .getFlatHeaders()
                    .find((entry) => entry.column.id === column.id);
                  return (
                    <TableHead
                      key={column.id}
                      className="flex items-center py-0"
                    >
                      {header &&
                        flexRender(
                          column.columnDef.header,
                          header.getContext(),
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
              <TableRow className="col-span-full grid grid-cols-subgrid">
                {visibleColumns.map((column) => {
                  const footer = table
                    .getFooterGroups()[0]
                    ?.headers.find((entry) => entry.column.id === column.id);
                  return (
                    <TableHead
                      key={column.id}
                      className="flex h-8 items-center text-xs font-bold"
                    >
                      {summaryRow &&
                        footer &&
                        flexRender(
                          column.columnDef.footer,
                          footer.getContext(),
                        )}
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
      </ListDetailTransition>
      {paginationControl && (
        <DataTablePagination table={table} hiddenByFit={hiddenByFit} />
      )}
    </div>
  );
  return (
    <SpeedDisplayContext value={speedDisplay}>{content}</SpeedDisplayContext>
  );
}) as <TData extends RowWithId & RowData>(
  props: DataTableProps<TData>,
) => React.ReactElement;
