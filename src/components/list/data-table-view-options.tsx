'use client';

import { MixerHorizontalIcon } from '@radix-ui/react-icons';
import { type RowData, type Table as TableType } from '@tanstack/react-table';
import {
  Columns,
  FileSpreadsheet,
  FileStack,
  LineChart,
  MoveHorizontal,
} from 'lucide-react';

import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
  PreferenceMenuSubContent,
} from '~/components/preference-menu';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { useShallowStore } from '~/store';

import {
  type DensityState,
  type Features,
  type SummaryRowState,
} from './table-extensions';
import {
  type WidthMode,
  getWidthMode,
  setWidthMode,
  widthModes,
} from './width-mode';

interface DataTableViewOptionsProps<TData extends RowData> {
  table: TableType<Features, TData>;
  hiddenByFit?: Set<string>;
}

export function DataTableViewOptions<TData extends RowData>({
  table,
  hiddenByFit,
}: DataTableViewOptionsProps<TData>) {
  const { combine, onlySelected, add, remove } = useShallowStore((state) => ({
    combine: state.combineSelections,
    onlySelected: state.onlySelected,
    add: state.addSelectedActivities,
    remove: state.removeSelectedActivities,
  }));
  return (
    <div className="flex shrink-0 items-center space-x-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 px-0 @xl/list-pagination:w-auto @xl/list-pagination:px-3"
            aria-label="View"
          >
            <MixerHorizontalIcon className="h-4 w-4 @xl/list-pagination:mr-2" />
            <span className="hidden @xl/list-pagination:inline">View</span>
          </Button>
        </DropdownMenuTrigger>
        <PreferenceMenuContent className="w-56">
          {combine && (
            <>
              <DropdownMenuItem
                disabled={onlySelected}
                onSelect={() =>
                  add(
                    table
                      .getFilteredRowModel()
                      .rows.map((row) => Number(row.id)),
                  )
                }
              >
                Select all filtered activities
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  remove(
                    table
                      .getFilteredRowModel()
                      .rows.map((row) => Number(row.id)),
                  )
                }
              >
                Deselect all filtered activities
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Columns className="size-4" />
              <span>Columns</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <PreferenceMenuSubContent>
                {table
                  .getAllColumns()
                  .filter(
                    (column) =>
                      typeof column.accessorFn !== 'undefined' &&
                      column.getCanHide(),
                  )
                  .map((column) => {
                    return (
                      <PreferenceMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(checked) =>
                          column.toggleVisibility(checked === true)
                        }
                      >
                        {column.columnDef.meta?.title ?? column.id}
                        {hiddenByFit?.has(column.id) && (
                          <span className="ml-auto pl-2 text-xs text-muted-foreground normal-case">
                            no room
                          </span>
                        )}
                      </PreferenceMenuCheckboxItem>
                    );
                  })}
              </PreferenceMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <MoveHorizontal className="size-4" />
              <span>Scrolling</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <PreferenceMenuSubContent>
                <DropdownMenuRadioGroup
                  value={getWidthMode(table)}
                  onValueChange={(value) =>
                    setWidthMode(table, value as WidthMode)
                  }
                >
                  {(['fit', 'pinned', 'free'] as const).map((mode) => (
                    <DropdownMenuRadioItem key={mode} value={mode}>
                      {widthModes[mode].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </PreferenceMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <FileStack className="size-4" />
              <span>{`${table.store.state.pagination.pageSize} per page`}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <PreferenceMenuSubContent>
                <DropdownMenuRadioGroup
                  value={String(table.store.state.pagination.pageSize)}
                  onValueChange={(value) => table.setPageSize(Number(value))}
                >
                  {[50, 100, 200, 500].map((pageSize) => (
                    <DropdownMenuRadioItem
                      key={pageSize}
                      value={String(pageSize)}
                    >
                      {pageSize}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </PreferenceMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <LineChart className="size-4" />
              <span>Summary row</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <PreferenceMenuSubContent>
                <DropdownMenuRadioGroup
                  value={table.store.state.summaryRow ?? 'off'}
                  onValueChange={(value) =>
                    table.setSummaryRow(() =>
                      value === 'off' ? null : (value as SummaryRowState),
                    )
                  }
                >
                  {(['off', 'page', 'all', 'selected'] as const).map(
                    (value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {value === 'off'
                          ? 'Off'
                          : value === 'page'
                            ? 'This page'
                            : value === 'all'
                              ? 'Filtered activities'
                              : 'Selected activities'}
                      </DropdownMenuRadioItem>
                    ),
                  )}
                </DropdownMenuRadioGroup>
              </PreferenceMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <FileSpreadsheet className="size-4" />
              <span>Table density</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <PreferenceMenuSubContent>
                <DropdownMenuRadioGroup
                  value={table.store.state.density}
                  onValueChange={(value) =>
                    table.setDensity(() => value as DensityState)
                  }
                >
                  {(['sm', 'md', 'lg'] as const).map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {value === 'sm'
                        ? 'Dense'
                        : value === 'md'
                          ? 'Normal'
                          : 'Loose'}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </PreferenceMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </PreferenceMenuContent>
      </DropdownMenu>
    </div>
  );
}
