import { type SetStateAction } from 'react';
import { type StateCreator } from 'zustand';

import { categorySettings, type CategorySetting } from '~/settings/category';
import { type inequalityFilters } from '~/settings/filter';
import { type Activity, type SportType } from '~/server/db/schema';
import { type RootState } from './index';

export type CategoryGroup = keyof CategorySetting;
export type CategoryGroupState = boolean | 'mixed';
export type ValueColumn = keyof typeof inequalityFilters;

export type BinaryColumn = keyof Pick<
  Activity,
  'commute' | 'private' | 'flagged'
>;
export type BinaryFilterMode = 'any' | 'yes' | 'no';

/** A calendar day without a timezone, encoded as YYYY-MM-DD. */
export type CalendarDate = string;

export type DateRange = {
  start: CalendarDate;
  end: CalendarDate;
};

export type ValueFilter = {
  value: number;
  operator: '>=' | '<=';
  /** Raw UI text retained while editing decimals. */
  displayValue?: string;
};

export type FilterState = {
  sportType: Record<SportType, boolean>;
  sportGroup: Record<CategoryGroup, CategoryGroupState>;
  dateRange: DateRange | undefined;
  values: Record<ValueColumn, ValueFilter | undefined>;
  search: string;
  binary: Record<BinaryColumn, BinaryFilterMode>;
};

export type FilterActions = {
  setSportGroup: (
    update: SetStateAction<Record<CategoryGroup, CategoryGroupState>>,
  ) => void;
  setSportType: (update: SetStateAction<Record<SportType, boolean>>) => void;
  setDateRange: (update: SetStateAction<DateRange | undefined>) => void;
  setValues: (
    update: SetStateAction<Record<ValueColumn, ValueFilter | undefined>>,
  ) => void;
  setValueOperator: (
    name: ValueColumn,
    operator: ValueFilter['operator'],
  ) => void;
  setSearch: (update: SetStateAction<string>) => void;
  setBinary: (
    update: SetStateAction<Record<BinaryColumn, BinaryFilterMode>>,
  ) => void;
  resetFilters: () => void;
};

export type FilterSlice = FilterState & FilterActions;

export type FilterableActivity = Pick<
  Activity,
  | 'sport_type'
  | 'distance'
  | 'elapsed_time'
  | 'total_elevation_gain'
  | 'commute'
  | 'private'
  | 'flagged'
  | 'name'
> & {
  start_date_local: Date | string;
};

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isCalendarDate = (value: unknown): value is CalendarDate => {
  if (typeof value !== 'string') return false;
  const match = calendarDatePattern.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(0, 0, 0, 0);

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
};

const padCalendarPart = (value: number) => value.toString().padStart(2, '0');

/** Convert a date-picker value to the calendar day the user selected. */
export const calendarDateFromLocalDate = (
  value: Date,
): CalendarDate | undefined => {
  if (Number.isNaN(value.getTime())) return undefined;
  return `${value.getFullYear().toString().padStart(4, '0')}-${padCalendarPart(
    value.getMonth() + 1,
  )}-${padCalendarPart(value.getDate())}`;
};

/** Convert a calendar key to a Date only for display in local date controls. */
export const calendarDateToLocalDate = (
  value: CalendarDate,
): Date | undefined => {
  if (!isCalendarDate(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day);
};

export const normalizeDateRange = (
  start: unknown,
  end: unknown,
): DateRange | undefined => {
  if (!isCalendarDate(start) || !isCalendarDate(end) || start > end) {
    return undefined;
  }
  return { start, end };
};

/** Mixed and unselected groups become fully selected; selected becomes none. */
export const toggleSportGroupState = (current: CategoryGroupState): boolean =>
  current !== true;

export type ParsedValueFilter =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'valid'; filter: ValueFilter };

const plainDecimalPattern = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

export const parseValueFilterInput = (
  input: string,
  operator: ValueFilter['operator'],
  toCanonical: (value: number) => number,
): ParsedValueFilter => {
  const displayValue = input.trim();
  if (displayValue === '') return { status: 'empty' };
  if (!plainDecimalPattern.test(displayValue)) return { status: 'invalid' };

  const value = toCanonical(Number(displayValue));
  if (!Number.isFinite(value)) return { status: 'invalid' };

  return {
    status: 'valid',
    filter: { value, operator, displayValue },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const sanitizePersistedDateRange = (
  value: unknown,
): DateRange | undefined => {
  if (!isRecord(value)) return undefined;

  const canonical = normalizeDateRange(value.start, value.end);
  if (canonical) return canonical;

  // Version 1 persisted picker Dates as UTC ISO strings. Recover the local
  // calendar components so an upgrade on the same device retains the days
  // the user selected without applying another timezone conversion.
  const legacyDatePattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  const parseLegacyDate = (candidate: unknown): Date | undefined => {
    if (candidate instanceof Date) {
      return Number.isNaN(candidate.getTime()) ? undefined : candidate;
    }
    if (typeof candidate !== 'string' || !legacyDatePattern.test(candidate)) {
      return undefined;
    }
    const date = new Date(candidate);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const start = parseLegacyDate(value.start);
  const end = parseLegacyDate(value.end);
  if (!start || !end) return undefined;

  return normalizeDateRange(
    calendarDateFromLocalDate(start),
    calendarDateFromLocalDate(end),
  );
};

const activityLocalCalendarDate = (
  value: Date | string,
): CalendarDate | undefined => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const calendarDate = date.toISOString().slice(0, 10);
  return isCalendarDate(calendarDate) ? calendarDate : undefined;
};

export const initializeSportType = (): Record<SportType, boolean> =>
  Object.fromEntries(
    Object.values(categorySettings).flatMap(({ alias }) =>
      alias.map((sportType) => [sportType, true]),
    ),
  ) as Record<SportType, boolean>;

export const deriveSportGroups = (
  sportTypes: Record<SportType, boolean>,
): Record<CategoryGroup, CategoryGroupState> =>
  Object.fromEntries(
    Object.entries(categorySettings).map(([group, { alias }]) => {
      const selectedCount = alias.filter(
        (sportType) => sportTypes[sportType],
      ).length;
      const state =
        selectedCount === alias.length
          ? true
          : selectedCount === 0
            ? false
            : 'mixed';
      return [group, state];
    }),
  ) as Record<CategoryGroup, CategoryGroupState>;

export const initializeSportGroup = (): Record<
  CategoryGroup,
  CategoryGroupState
> => deriveSportGroups(initializeSportType());

export const initializeValues = (): Record<
  ValueColumn,
  ValueFilter | undefined
> => ({
  distance: undefined,
  elapsed_time: undefined,
  total_elevation_gain: undefined,
});

export const toPersistedValues = (
  values: FilterState['values'],
): FilterState['values'] =>
  Object.fromEntries(
    Object.entries(values).map(([key, filter]) => [
      key,
      filter ? { value: filter.value, operator: filter.operator } : undefined,
    ]),
  ) as FilterState['values'];

export const initializeBinary = (): Record<BinaryColumn, BinaryFilterMode> => ({
  commute: 'any',
  private: 'any',
  flagged: 'any',
});

const binaryModes = new Set<BinaryFilterMode>(['any', 'yes', 'no']);

export const sanitizePersistedBinary = (
  value: unknown,
): Record<BinaryColumn, BinaryFilterMode> => {
  const binary = initializeBinary();
  if (!isRecord(value)) return binary;

  for (const key of Object.keys(binary) as BinaryColumn[]) {
    const candidate = value[key];
    if (
      typeof candidate === 'string' &&
      binaryModes.has(candidate as BinaryFilterMode)
    ) {
      binary[key] = candidate as BinaryFilterMode;
    }
  }
  return binary;
};

const matchesBinaryFilter = (mode: BinaryFilterMode, value: boolean | null) =>
  mode === 'any' || (mode === 'yes' ? value === true : value === false);

const normalizeSearch = (value: string) => value.normalize('NFC').toLowerCase();

export const applyFilters = (
  state: FilterState,
  activity: FilterableActivity,
): boolean => {
  if (!state.sportType[activity.sport_type]) return false;

  if (state.dateRange) {
    const range = normalizeDateRange(
      state.dateRange.start,
      state.dateRange.end,
    );
    const activityDate = activityLocalCalendarDate(activity.start_date_local);
    if (
      range &&
      (!activityDate || activityDate < range.start || activityDate > range.end)
    ) {
      return false;
    }
  }

  for (const [key, filter] of Object.entries(state.values) as [
    ValueColumn,
    ValueFilter | undefined,
  ][]) {
    if (!filter || !Number.isFinite(filter.value)) continue;
    const value = activity[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (filter.operator === '>=' && value < filter.value) return false;
    if (filter.operator === '<=' && value > filter.value) return false;
  }

  for (const [key, mode] of Object.entries(state.binary) as [
    BinaryColumn,
    BinaryFilterMode,
  ][]) {
    if (!matchesBinaryFilter(mode, activity[key])) return false;
  }

  const search = normalizeSearch(state.search.trim());
  if (search && !normalizeSearch(activity.name).includes(search)) return false;

  return true;
};

export const createFilterSlice: StateCreator<
  RootState,
  [['zustand/immer', never], never],
  [],
  FilterSlice
> = (set, _get, _store) => {
  const slices: FilterSlice = {
    sportType: initializeSportType(),
    sportGroup: initializeSportGroup(),
    dateRange: undefined,
    values: initializeValues(),
    search: '',
    binary: initializeBinary(),

    setSportGroup: (update) => {
      set((state) => {
        const nextGroups =
          typeof update === 'function' ? update(state.sportGroup) : update;

        for (const group of Object.keys(categorySettings) as CategoryGroup[]) {
          const currentGroup = state.sportGroup[group];
          const nextGroup = nextGroups[group];
          if (currentGroup === nextGroup) continue;

          const select = nextGroup === true;
          for (const sportType of categorySettings[group].alias) {
            state.sportType[sportType] = select;
          }
        }
        state.sportGroup = deriveSportGroups(state.sportType);
      });
    },

    setSportType: (update) => {
      set((state) => {
        state.sportType =
          typeof update === 'function' ? update(state.sportType) : update;
        state.sportGroup = deriveSportGroups(state.sportType);
      });
    },

    setDateRange: (update) => {
      set((state) => {
        const next =
          typeof update === 'function' ? update(state.dateRange) : update;
        if (!next) {
          state.dateRange = undefined;
          return;
        }

        const normalized = normalizeDateRange(next.start, next.end);
        if (normalized) state.dateRange = normalized;
      });
    },

    setValues: (update) => {
      set((state) => {
        state.values =
          typeof update === 'function' ? update(state.values) : update;
      });
    },

    setValueOperator: (name, operator) => {
      set((state) => {
        const filter = state.values[name];
        if (filter) filter.operator = operator;
      });
    },

    setSearch: (update) => {
      set((state) => {
        state.search =
          typeof update === 'function' ? update(state.search) : update;
      });
    },

    setBinary: (update) => {
      set((state) => {
        state.binary =
          typeof update === 'function' ? update(state.binary) : update;
      });
    },

    resetFilters: () => {
      set((state) => {
        state.sportType = initializeSportType();
        state.sportGroup = initializeSportGroup();
        state.dateRange = undefined;
        state.values = initializeValues();
        state.search = '';
        state.binary = initializeBinary();
      });
    },
  };

  return slices;
};
