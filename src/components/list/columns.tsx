'use client';

import { type ColumnDef, type Table } from '@tanstack/react-table';
import { useContext } from 'react';

import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import {
  useDateFormat,
  useDisplayUnits,
  useFormattingLocale,
} from '~/hooks/use-display-preferences';
import type { ActivityMapCommand } from '~/hooks/use-show-on-map';
import type { Activity } from '~/lib/activity';
import { aggregateMetric } from '~/lib/activity-presentation';
import { isMissing } from '~/lib/activity-presentation';
import { message } from '~/lib/presentation/messages';
import {
  formatPaceSeconds,
  formatSpeed,
  paceSeconds,
  speedDisplayForSports,
  speedLabel,
} from '~/lib/speed-display';
import type { Photo } from '~/server/db/schema';
import {
  type ActivityField,
  type ActivityValueType,
  activityFields,
} from '~/settings/activity';
import { store, useShallowStore } from '~/store';

import { ActivityCard, DescriptionCard } from './card';
import { DataTableColumnHeader } from './data-table-column-header';
import { EditActivity } from './edit';
import { PhotoLightbox } from './photo';
import { SpeedDisplayContext } from './speed-display-context';
import { type Features } from './table-extensions';
import { getWidthMode, setWidthMode, widthModes } from './width-mode';

function PageSelectionCheckbox({
  table,
}: {
  table: Table<Features, Activity>;
}) {
  const combine = useShallowStore((state) => state.combineSelections);
  const onlySelected = useShallowStore((state) => state.onlySelected);
  if (!combine) return null;
  return (
    <Checkbox
      className="h-6 w-6"
      checked={
        table.getIsAllPageRowsSelected() ||
        (table.getIsSomePageRowsSelected() && 'indeterminate')
      }
      disabled={onlySelected && !table.getIsAllPageRowsSelected()}
      onCheckedChange={(value) => {
        const ids = table.getRowModel().rows.map((row) => row.original.id);
        if (value && !onlySelected) store.getState().addSelectedActivities(ids);
        else if (!value) store.getState().removeSelectedActivities(ids);
      }}
      aria-label={message('list.pageSelection')}
    />
  );
}

/** Rows the summary row describes; none when the summary row is off. */
function summaryRows(table: Table<Features, Activity>) {
  const scope = table.store.state.summaryRow;
  return scope == null
    ? []
    : scope === 'page'
      ? table.getRowModel().rows
      : scope === 'all'
        ? table.getFilteredRowModel().rows
        : table.getSelectedRowModel().rows;
}

const summarized = Object.entries(activityFields)
  .filter(([, spec]) => 'reducer' in spec || 'summary' in spec)
  .map(([id]) => id);

function columnFromField<K extends ActivityValueType>(
  id: keyof typeof activityFields,
  spec: ActivityField<K>,
): ColumnDef<Features, Activity> {
  const Footer = ({ table }: { table: Table<Features, Activity> }) => {
    const units = useDisplayUnits();
    const locale = useFormattingLocale();
    const dateFormat = useDateFormat();
    const display = useContext(SpeedDisplayContext);
    const rows = summaryRows(table);
    const values: K[] = rows.map((row) => row.getValue(id));
    const reducedValue = spec.reducer ? spec.reducer(values) : null;
    // A selected summary can contain filter-hidden sports; keep it comparable.
    const summaryDisplay =
      id === 'average_speed' &&
      display !== 'speed' &&
      speedDisplayForSports(rows.map((row) => row.original.sport_type)) ===
        display
        ? display
        : 'speed';
    const paceSummary =
      id === 'average_speed' && summaryDisplay !== 'speed'
        ? formatPaceSeconds(
            aggregateMetric(
              values.map((value) =>
                paceSeconds(value as number, summaryDisplay, units),
              ),
              'mean',
            ).value,
            summaryDisplay,
            units,
            locale,
          )
        : null;
    const summary =
      paceSummary !== null
        ? `∅${paceSummary}`
        : spec.summary
          ? spec.summary(values, locale)
          : reducedValue != null
            ? `${spec.reducerSymbol ?? ''}${spec.formatter(reducedValue, units, dateFormat, locale)}`
            : '—';
    const known = values.filter((v) =>
      id === 'average_speed' && summaryDisplay !== 'speed'
        ? paceSeconds(v as number, summaryDisplay, units) !== null
        : !isMissing(v),
    ).length;
    return (
      <div
        className="w-full text-right"
        title={message('list.recordedValues', { known, total: values.length })}
        aria-label={message('list.summaryAccessible', {
          summary,
          known,
          total: values.length,
        })}
      >
        {summary}
        {known < values.length && <span aria-hidden="true"> *</span>}
      </div>
    );
  };

  return {
    id,
    cell: function MetricCell({ getValue }) {
      const units = useDisplayUnits();
      const locale = useFormattingLocale();
      const dateFormat = useDateFormat();
      const display = useContext(SpeedDisplayContext);
      return (
        <div className="w-full text-right">
          {id === 'average_speed'
            ? formatSpeed(getValue() as number, display, units, locale)
            : spec.formatter(getValue() as K, units, dateFormat, locale)}
        </div>
      );
    },
    meta: {
      title:
        id === 'average_speed' ? message('list.averageSpeedPace') : spec.title,
      width: 'minmax(70px, 1fr)',
    },
    header: function MetricHeader({ column }) {
      const display = useContext(SpeedDisplayContext);
      return (
        <DataTableColumnHeader
          column={column}
          title={id === 'average_speed' ? speedLabel(display) : undefined}
        >
          <div className="flex w-full justify-end">
            {spec.Icon && <spec.Icon className="h-4 w-4" />}
          </div>
        </DataTableColumnHeader>
      );
    },
    ...(spec.accessorFn && { accessorFn: spec.accessorFn }),
    ...(!spec.accessorFn && { accessorKey: id }),
    ...((spec.reducer ?? spec.summary) && { footer: Footer }),
  };
}

/** Header button that cycles through the width modes. */
function WidthModeToggle({ table }: { table: Table<Features, Activity> }) {
  const mode = getWidthMode(table);
  const { icon: Icon, label, next } = widthModes[mode];
  return (
    <Button
      variant="outline"
      size="sm"
      className="border p-1"
      onClick={() => setWidthMode(table, next)}
      aria-label={message('list.width.switch', {
        current: label,
        next: widthModes[next].label,
      })}
      title={message('list.width.switch', {
        current: label,
        next: widthModes[next].label,
      })}
    >
      <Icon />
    </Button>
  );
}

export const columns: ColumnDef<Features, Activity>[] = [
  {
    id: 'id',
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="ID" />
    ),
    enableHiding: false,
    filterFn: (
      row: { original: Activity },
      _columnId: string,
      filterValue: ReadonlySet<number>,
    ) => filterValue.has(row.original.id),
  },
  {
    id: 'name',
    footer: ({ table }) => {
      const scope = table.store.state.summaryRow;
      const rows = summaryRows(table);
      const gaps = table
        .getAllColumns()
        .some(
          (column) =>
            summarized.includes(column.id) &&
            column.getIsVisible() &&
            rows.some((row) => isMissing(row.getValue(column.id))),
        );
      const hidden =
        table.getSelectedRowModel().rows.length -
        table.getFilteredSelectedRowModel().rows.length;
      return (
        <div className="text-xs">
          {scope === 'page'
            ? message('list.thisPage')
            : scope === 'all'
              ? message('list.filtered')
              : message('list.selected')}{' '}
          · {rows.length}
          {scope === 'selected' && hidden > 0
            ? ` · ${message('list.hidden', { count: hidden })}`
            : ''}
          {gaps && (
            <span className="block text-muted-foreground">
              {message('list.unrecorded')}
            </span>
          )}
        </div>
      );
    },
    accessorKey: 'name',
    meta: { title: message('activity.edit.name'), width: 'minmax(200px, 3fr)' },
    header: ({ column, table }) => (
      <DataTableColumnHeader column={column}>
        <div className="flex items-center space-x-2">
          <PageSelectionCheckbox table={table} />
          <span>{message('activity.edit.name')}</span>
          <div className="flex-1 text-right">
            <WidthModeToggle table={table} />
          </div>
        </div>
      </DataTableColumnHeader>
    ),
    cell: ({ row }) => <ActivityCard row={row} />,
    enableHiding: false,
  },
  ...Object.entries(activityFields).map(([id, spec]) =>
    columnFromField(
      id as keyof typeof activityFields,
      spec as ActivityField<ActivityValueType>,
    ),
  ),
  {
    id: 'description',
    accessorKey: 'description',
    meta: {
      title: message('activity.edit.description'),
      width: 'minmax(200px, 3fr)',
    },
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={message('activity.edit.description')}
      />
    ),
    cell: ({ row }) => <DescriptionCard row={row} />,
  },
  {
    id: 'photos',
    accessorKey: 'photos',
    meta: { title: message('metric.photos'), width: 'minmax(80px, 1fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={message('metric.photos')} />
    ),
    cell: ({ getValue, row }) => {
      const photos = getValue() as Photo[] | undefined;
      return (
        <PhotoLightbox photos={photos ?? []} title={row.getValue('name')} />
      );
    },
  },
  {
    id: 'geometry_state',
    accessorKey: 'geometryState',
    meta: {
      title: message('metric.geometryStatus'),
      width: 'minmax(100px, 1fr)',
    },
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={message('metric.geometryStatus')}
      />
    ),
    cell: ({ getValue }) => {
      const geometryState = getValue() as Activity['geometryState'];
      return (
        <div className="w-full text-right">
          {message(
            geometryState === 'detailed'
              ? 'geometry.detailed'
              : geometryState === 'summary'
                ? 'geometry.summary'
                : 'geometry.refreshRequired',
          )}
        </div>
      );
    },
  },
  {
    id: 'edit',
    enableSorting: false,
    meta: { title: message('action.edit'), width: '40px' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={message('action.edit')} />
    ),
    cell: ({ row }) => <EditActivity activity={row.original} trigger={true} />,
    accessorFn: (row) => row.id,
  },
];

/** Screen-owned commands are captured once, independent of displayed row count. */
export function activityColumns(
  onShowOnMap: ActivityMapCommand,
  eligibleIDs: ReadonlySet<number>,
) {
  return columns.map((column) =>
    column.id === 'name'
      ? {
          ...column,
          cell: ({
            row,
          }: {
            row: Parameters<typeof ActivityCard>[0]['row'];
          }) => (
            <ActivityCard
              row={row}
              onShowOnMap={onShowOnMap}
              mapActionVariant={
                eligibleIDs.has(row.original.id)
                  ? 'show'
                  : 'clear-filters-and-show'
              }
            />
          ),
        }
      : column,
  );
}
