import * as d3 from 'd3';

import { type Activity } from '~/server/db/schema';
import { categorySettings, aliasMap } from '~/settings/category';
import { resolveChartCategoryColors } from './chart-colors';

type SportGroup = keyof typeof categorySettings;
export type CalendarTypeValue = SportGroup | 'Multiple';

type NumericValueOption = {
  id: 'distance' | 'elevation' | 'time';
  fun: (d: Activity) => number;
  format: (v: number) => string;
  label: string;
  unit: string;
  reduce: (v: Activity[]) => number;
};

type TypeValueOption = {
  id: 'type';
  fun: (d: Activity) => SportGroup;
  format: (groupName: CalendarTypeValue) => string;
  label: string;
  unit: '';
  reduce: (v: Activity[]) => CalendarTypeValue;
  colorDomain: () => { domain: CalendarTypeValue[]; range: string[] };
};

export const settings = {
  value: {
    type: 'categorical',
    label: 'Value',
    options: {
      distance: {
        id: 'distance',
        fun: (d: Activity) => d.distance ?? 0,
        format: (v: number) => (v / 1000).toFixed() + 'km',
        label: 'Distance',
        unit: 'km',
        reduce: (v: Activity[]): number => d3.sum(v, (d) => d.distance ?? 0),
      },
      elevation: {
        id: 'elevation',
        fun: (d: Activity) => d.total_elevation_gain ?? 0,
        format: (v: number) => v.toFixed() + 'm',
        label: 'Elevation',
        unit: 'm',
        reduce: (v: Activity[]): number =>
          d3.sum(v, (d) => d.total_elevation_gain ?? 0),
      },
      time: {
        id: 'time',
        fun: (d: Activity) => d.elapsed_time ?? 0,
        format: (v: number) => (v / 3600).toFixed(1) + 'h',
        label: 'Duration',
        unit: 'h',
        reduce: (v: Activity[]): number => d3.sum(v, (d) => d.elapsed_time ?? 0),
      },
      type: {
        id: 'type',
        fun: (d: Activity) => aliasMap[d.sport_type] ?? 'misc',
        format: (groupName: CalendarTypeValue) => {
          if (groupName === 'Multiple') {
            return 'Multiple';
          }
          return categorySettings[groupName].name;
        },
        label: 'Sport Type',
        unit: '',
        reduce: (v: Activity[]): CalendarTypeValue => {
          const set = new Set(v.map((d) => aliasMap[d.sport_type] ?? 'misc'));
          if (set.size !== 1) {
            return 'Multiple';
          }
          return set.values().next().value!;
        },
        colorDomain: () => {
          const colors = resolveChartCategoryColors();
          const groups = Object.keys(categorySettings) as SportGroup[];
          return {
            domain: [...groups, 'Multiple'] as CalendarTypeValue[],
            range: [...groups.map((g) => colors[g]), '#aaa'],
          };
        },
      },
    },
  },
} as const satisfies {
  value: {
    type: 'categorical';
    label: string;
    options: {
      distance: NumericValueOption;
      elevation: NumericValueOption;
      time: NumericValueOption;
      type: TypeValueOption;
    };
  };
};

export type CalendarSetting = {
  value: keyof typeof settings.value.options;
};

export const defaultSettings: CalendarSetting = {
  value: 'type',
};

export type CalendarSpec = {
  value: (typeof settings.value.options)[keyof typeof settings.value.options];
};

export const getter = (setting: CalendarSetting): CalendarSpec => ({
  value: settings.value.options[setting.value],
});

export const setter =
  (calendar: CalendarSetting) =>
  <K extends keyof CalendarSetting>(name: K, value: CalendarSetting[K]) => {
    return { ...calendar, [name]: value };
  };

export const isTypeValueOption = (
  value: CalendarSpec['value'],
): value is (typeof settings.value.options)['type'] => value.id === 'type';

const calendarSettings = {
  settings,
  defaultSettings,
  getter,
  setter,
};

export default calendarSettings;
