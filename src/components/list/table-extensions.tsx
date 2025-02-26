'use client';

import {
  type TableFeature,
  type OnChangeFn,
  type Updater,
  type Table,
  type RowData,
  makeStateUpdater,
  functionalUpdate,
} from '@tanstack/react-table';
import type { MapRef } from 'react-map-gl/mapbox';
import { type RefObject } from 'react';

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

declare module '@tanstack/react-table' {
  interface TableState {
    density: DensityState;
  }
  interface TableOptionsResolved<TData extends RowData> {
    enableDensity?: boolean;
    onDensityChange?: OnChangeFn<DensityState>;
  }
  interface Table<TData extends RowData> {
    setDensity: (updater: Updater<DensityState>) => void;
    toggleDensity: (value?: DensityState) => void;
  }
}

export const DensityFeature: TableFeature = {
  getInitialState: (state): DensityTableState => {
    return {
      density: 'md',
      ...state,
    };
  },
  getDefaultOptions: <TData extends RowData>(
    table: Table<TData>,
  ): DensityOptions => {
    return {
      enableDensity: true,
      onDensityChange: makeStateUpdater('density', table),
    } as DensityOptions;
  },
  createTable: <TData extends RowData>(table: Table<TData>): void => {
    table.setDensity = (updater) => {
      const safeUpdater: Updater<DensityState> = (old) => {
        const newState = functionalUpdate(updater, old);
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

// Map Feature
export interface MapTableState {
  map?: RefObject<MapRef | null>;
}

export interface MapOptions {
  onMapChange?: OnChangeFn<RefObject<MapRef | null> | undefined>;
}

export interface MapInstance {
  setMap: (updater: Updater<RefObject<MapRef | null> | undefined>) => void;
}

declare module '@tanstack/react-table' {
  interface TableState {
    map?: RefObject<MapRef | null>;
  }
  interface TableOptionsResolved<TData extends RowData> {
    onMapChange?: OnChangeFn<RefObject<MapRef | null> | undefined>;
  }
  interface Table<TData extends RowData> {
    setMap: (updater: Updater<RefObject<MapRef | null> | undefined>) => void;
  }
}

export const MapFeature: TableFeature = {
  getInitialState: (state): MapTableState => {
    return {
      map: undefined,
      ...state,
    };
  },
  getDefaultOptions: <TData extends RowData>(
    table: Table<TData>,
  ): MapOptions => {
    return {
      onMapChange: makeStateUpdater('map', table),
    };
  },
  createTable: <TData extends RowData>(table: Table<TData>): void => {
    table.setMap = (updater) => {
      const safeUpdater: Updater<RefObject<MapRef | null> | undefined> = (old) => {
        const newState = functionalUpdate(updater, old);
        return newState;
      };
      return table.options.onMapChange?.(safeUpdater);
    };
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

declare module '@tanstack/react-table' {
  interface TableState {
    summaryRow: SummaryRowState;
  }
  interface TableOptionsResolved<TData extends RowData> {
    enableSummaryRow?: boolean;
    onSummaryRowChange?: OnChangeFn<SummaryRowState>;
  }
  interface Table<TData extends RowData> {
    setSummaryRow: (updater: Updater<SummaryRowState>) => void;
  }
}

export const SummaryRowFeature: TableFeature = {
  getInitialState: (state): SummaryRowTableState => {
    return {
      summaryRow: 'page',
      ...state,
    };
  },
  getDefaultOptions: <TData extends RowData>(
    table: Table<TData>,
  ): SummaryRowOptions => {
    return {
      enableSummaryRow: true,
      onSummaryRowChange: makeStateUpdater('summaryRow', table),
    } as SummaryRowOptions;
  },
  createTable: <TData extends RowData>(table: Table<TData>): void => {
    table.setSummaryRow = (updater) => {
      const safeUpdater: Updater<SummaryRowState> = (old) => {
        const newState = functionalUpdate(updater, old);
        return newState;
      };
      return table.options.onSummaryRowChange?.(safeUpdater);
    };
  },
};
