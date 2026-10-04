'use client';

import {
  useDisplayUnits,
  useDateFormat,
} from '~/hooks/use-display-preferences';
import { type ColumnDef, type Table } from '@tanstack/react-table';
import { Checkbox } from '~/components/ui/checkbox';

import { isMissing } from '~/lib/activity-presentation';
import { type Activity, type Photo } from '~/server/db/schema';
import { Button } from '~/components/ui/button';

import { DataTableColumnHeader } from './data-table-column-header';
import {
  activityFields,
  type ActivityField,
  type ActivityValueType,
} from '~/settings/activity';

import { ActivityCard, DescriptionCard } from './card';
import { EditActivity } from './edit';
import { PhotoLightbox } from './photo';
import { type Features } from './table-extensions';
import { getWidthMode, setWidthMode, widthModes } from './width-mode';

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
    const dateFormat = useDateFormat();
    const rows = summaryRows(table);
    const values: K[] = rows.map((row) => row.getValue(id));
    const reducedValue = spec.reducer ? spec.reducer(values) : null;
    const summary = spec.summary
      ? spec.summary(values)
      : reducedValue != null
        ? `${spec.reducerSymbol ?? ''}${spec.formatter(reducedValue, units, dateFormat)}`
        : '—';
    const known = values.filter((v) => !isMissing(v)).length;
    return (
      <div
        className="text-right w-full"
        title={`${known} of ${values.length} activities with a recorded value`}
        aria-label={`${summary}; ${known} of ${values.length} recorded`}
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
      const dateFormat = useDateFormat();
      return (
        <div className="text-right w-full">
          {spec.formatter(getValue() as K, units, dateFormat)}
        </div>
      );
    },
    meta: {
      title: spec.title,
      width: 'minmax(70px, 1fr)',
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column}>
        <div className="w-full justify-end flex">
          {spec.Icon && <spec.Icon className="w-4 h-4" />}
        </div>
      </DataTableColumnHeader>
    ),
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
      className="p-1 border"
      onClick={() => setWidthMode(table, next)}
      aria-label={`${label}. Switch to: ${widthModes[next].label.toLowerCase()}`}
      title={`${label} (click to change)`}
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
      filterValue: number[],
    ) => filterValue.includes(row.original.id),
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
            ? 'This page'
            : scope === 'all'
              ? 'Filtered activities'
              : 'Selected activities'}{' '}
          · {rows.length}
          {scope === 'selected' && hidden > 0
            ? ` · ${hidden} hidden by filters`
            : ''}
          {gaps && (
            <span className="block text-muted-foreground">
              * = unrecorded values
            </span>
          )}
        </div>
      );
    },
    accessorKey: 'name',
    meta: { title: 'Name', width: 'minmax(200px, 3fr)' },
    header: ({ column, table }) => (
      <DataTableColumnHeader column={column}>
        <div className="flex items-center space-x-2">
          <Checkbox
            className="h-6 w-6"
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select this page"
          />
          <span>Name</span>
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
    meta: { title: 'Description', width: 'minmax(200px, 3fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Description" />
    ),
    cell: ({ row }) => <DescriptionCard row={row} />,
  },
  {
    id: 'photos',
    accessorKey: 'photos',
    meta: { title: 'Photos', width: 'minmax(80px, 1fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Photos" />
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
    meta: { title: 'Geometry', width: 'minmax(100px, 1fr)' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Geometry" />
    ),
    cell: ({ getValue }) => {
      const geometryState = getValue() as Activity['geometryState'];
      return <div className="text-right w-full">{geometryState ?? 'Unknown'}</div>;
    },
  },
  {
    id: 'edit',
    enableSorting: false,
    meta: { title: 'Edit', width: '40px' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Edit" />
    ),
    cell: ({ row }) => <EditActivity row={row} trigger={true} />,
    accessorFn: (row) => row.id,
  },
];
