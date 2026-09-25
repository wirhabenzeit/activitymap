'use client';

import {
  type TableFeature,
  type OnChangeFn,
  type Updater,
  type RowData,
  type TableFeatures,
  assignTableAPIs,
  makeStateUpdater,
  setStateSlice,
  tableFeatures,
  rowSortingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  columnPinningFeature,
  rowSelectionFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  createSortedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  createExpandedRowModel,
} from '@tanstack/react-table';

// Density Feature
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

/* eslint-disable @typescript-eslint/no-unused-vars -- Generic params in TanStack declaration merging are required by upstream types. */
declare module '@tanstack/react-table' {
  interface Plugins {
    densityFeature: TableFeature;
  }
  interface TableState_FeatureMap {
    densityFeature: DensityTableState;
  }
  interface TableOptions_FeatureMap<
    TFeatures extends TableFeatures,
    TData extends RowData,
  > {
    densityFeature: DensityOptions;
  }
  interface Table_FeatureMap<
    TFeatures extends TableFeatures,
    TData extends RowData,
  > {
    densityFeature: DensityInstance;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export const densityFeature: TableFeature = {
  getInitialState: (state) => {
    return {
      density: 'md',
      ...state,
    };
  },
  getDefaultTableOptions: (table) => {
    return {
      enableDensity: true,
      onDensityChange: makeStateUpdater('density', table),
    };
  },
  constructTableAPIs: (table) => {
    assignTableAPIs('densityFeature', table, {
      table_setDensity: {
        fn: (updater: Updater<DensityState>) => {
          setStateSlice(table, 'density', updater);
        },
      },
      table_toggleDensity: {
        fn: (value?: DensityState) => {
          setStateSlice(table, 'density', (old) => {
            if (value) return value;
            return old === 'lg' ? 'md' : old === 'md' ? 'sm' : 'lg'; //cycle through the 3 options
          });
        },
      },
    });
  },
};

// Summary Row Feature
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

/* eslint-disable @typescript-eslint/no-unused-vars -- Generic params in TanStack declaration merging are required by upstream types. */
declare module '@tanstack/react-table' {
  interface Plugins {
    summaryRowFeature: TableFeature;
  }
  interface TableState_FeatureMap {
    summaryRowFeature: SummaryRowTableState;
  }
  interface TableOptions_FeatureMap<
    TFeatures extends TableFeatures,
    TData extends RowData,
  > {
    summaryRowFeature: SummaryRowOptions;
  }
  interface Table_FeatureMap<
    TFeatures extends TableFeatures,
    TData extends RowData,
  > {
    summaryRowFeature: SummaryRowInstance;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export const summaryRowFeature: TableFeature = {
  getInitialState: (state) => {
    return {
      summaryRow: 'page',
      ...state,
    };
  },
  getDefaultTableOptions: (table) => {
    return {
      enableSummaryRow: true,
      onSummaryRowChange: makeStateUpdater('summaryRow', table),
    };
  },
  constructTableAPIs: (table) => {
    assignTableAPIs('summaryRowFeature', table, {
      table_setSummaryRow: {
        fn: (updater: Updater<SummaryRowState>) => {
          setStateSlice(table, 'summaryRow', updater);
        },
      },
    });
  },
};

// Table feature composition, kept static/module-scope per TanStack's guidance.
export const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  columnPinningFeature,
  rowSelectionFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  densityFeature,
  summaryRowFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  expandedRowModel: createExpandedRowModel(),
});

export type Features = typeof features;
