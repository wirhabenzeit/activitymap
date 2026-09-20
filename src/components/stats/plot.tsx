'use client';

import { useMemo, useState, useEffect, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import { useShallowStore } from '~/store';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';

import { useContext } from 'react';
import { StatsContext } from '~/app/(app)/stats/[name]/StatsContext';
import {
  chartPlots,
  type ChartPlotName,
  type StatsSetting,
  type StatsSettings,
} from './index';

import * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

import { Slider } from '~/components/ui/slider';

import { type Activity } from '~/server/db/schema';
import { Button } from '~/components/ui/button';
import { Chart } from '@tanstack/charts/react';
import { type DomChartDefinition } from '@tanstack/charts';

type ChartTheme = 'light' | 'dark';

type ChartArgs = {
  activities: Activity[];
  width: number;
  height: number;
  theme: ChartTheme;
  selected: number[];
  setSelected: (ids: number[]) => void;
};

// Define a union type for all possible setting keys
type SettingKey = ChartPlotName;

type LegendProps<K extends SettingKey> = {
  setting: StatsSetting[K];
  activities: Activity[];
  theme: ChartTheme;
};

type Stats<K extends SettingKey> = {
  settings: StatsSettings[K];
  setting: StatsSetting[K];
  setter: (updater: (prev: StatsSetting[K]) => StatsSetting[K]) => void;
  chart: (
    setting: StatsSetting[K],
  ) => (args: ChartArgs) => DomChartDefinition | null;
  Legend: (props: LegendProps<K>) => JSX.Element | null;
  kind: K;
};

function makeChart<K extends SettingKey>(stat: Stats<K>) {
  return stat.chart(stat.setting);
}

// Define a base setting type that captures common properties
type BaseSetting = {
  type: string;
  [key: string]: unknown;
};

// Define a generic stats type for FormElement
type GenericStats = {
  settings: Record<string, BaseSetting>;
  setting: Record<string, unknown>;
  setter: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  kind: SettingKey;
};

type FormElementProps = {
  propName: string;
  stat: GenericStats;
};

function FormElement({
  propName,
  stat,
}: FormElementProps) {
  const setting = stat.settings[propName];
  if (!setting) return null;

  const value = stat.setting[propName];
  const setter = (valueFn: (val: unknown) => unknown) =>
    stat.setter((s) => ({ ...s, [propName]: valueFn(s[propName]) }));

  switch (setting.type) {
    case 'categorical':
      return (
        <SelectFormElement
          key={propName}
          setting={setting as CategoricalSetting<string, unknown>}
          value={value as string}
          setter={setter}
        />
      );
    case 'number':
      return (
        <SliderFormElement
          key={propName}
          setting={setting as ValueSetting}
          value={value as SliderValue}
          setter={setter as unknown as (value: (val: SliderValue) => SliderValue) => void}
        />
      );
    default:
      return null;
  }
}

function FormComponent<T extends SettingKey>({ stat }: { stat: Stats<T> }) {
  return (
    <>
      {Object.keys(stat.settings).map((propName) => (
        <FormElement key={propName} propName={propName} stat={stat as unknown as GenericStats} />
      ))}
    </>
  );
}

type CategoricalSetting<K extends string, T> = {
  type: 'categorical';
  label: string;
  options: Record<
    K,
    {
      label: string;
      [key: string]: unknown;
    } & T
  >;
};

export const SelectFormElement = <K extends string, T>({
  setting,
  value,
  setter,
}: {
  setting: CategoricalSetting<K, T>;
  value: K;
  setter: (value: (val: unknown) => unknown) => void;
}) => {
  if (Object.keys(setting.options).length == 1) return null;
  return (
    <Select value={value} onValueChange={(val) => setter(() => val)}>
      <SelectTrigger className="w-[140px]">
        <SelectValue placeholder="Theme" />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(setting.options) as K[]).map((key) => (
          <SelectItem value={key} key={key}>
            {setting.options[key].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

type ValueSetting = {
  type: 'value';
  domain: [number, number];
  label: string;
  minIcon: JSX.Element;
  maxIcon: JSX.Element;
};

type SliderValue = { value: number; domain: [number, number] };

export const SliderFormElement = ({
  setting,
  value,
  setter,
}: {
  setting: ValueSetting;
  value: SliderValue;
  setter: (value: (val: SliderValue) => SliderValue) => void;
}) => {
  return (
    <div className="flex items-center space-x-1">
      <Button
        onClick={() =>
          setter((val) => ({ value: val.domain[0], domain: val.domain }))
        }
        disabled={value.value == value.domain[0]}
        variant="ghost"
        className="p-2"
      >
        {setting.minIcon}
      </Button>
      <Slider
        className="w-20"
        value={[value.value]}
        min={value.domain[0]}
        max={value.domain[1]}
        onValueChange={(v) => {
          const newValue = v?.[0];
          if (typeof newValue === 'number') {
            setter((val) => ({ value: newValue, domain: val.domain }));
          }
        }}
      />
      <Button
        onClick={() =>
          setter((val) => ({ value: val.domain[1], domain: val.domain }))
        }
        disabled={value.value == value.domain[1]}
        variant="ghost"
        className="p-2"
      >
        {setting.maxIcon}
      </Button>
    </div>
  );
};

export default function StatsChart({ name }: { name: ChartPlotName }) {
  const { settings, setSettings, selected, setSelected } = useShallowStore(
    (state) => ({
      settings: state.settings,
      setSettings: state.setSettings,
      selected: state.selected,
      setSelected: state.setSelected,
    }),
  );

  const { filteredActivities } = useFilteredActivities();
  const { theme } = useTheme();
  const resolvedTheme: ChartTheme = theme === 'dark' ? 'dark' : 'light';

  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const { width, height, settingsRef } = useContext(StatsContext);

  const stats = useMemo(
    () => ({
      chart: chartPlots[name].chart,
      Legend: chartPlots[name].Legend,
      setting: settings[name],
      kind: name,
      settings: chartPlots[name].settings,
      setter: (value: (prev: StatsSetting[typeof name]) => StatsSetting[typeof name]) =>
        setSettings((setting) => ({
          ...setting,
          [name]: value(setting[name]),
        })),
    }),
    [settings, name, setSettings],
  );

  useEffect(() => {
    setPortalTarget(settingsRef.current);
  }, [settingsRef]);

  const definition = useMemo(() => {
    if (width <= 0 || height <= 0) return null;
    const chartFn = makeChart(stats as unknown as Stats<typeof name>);
    return chartFn({
      activities: filteredActivities,
      width,
      height,
      theme: resolvedTheme,
      selected,
      setSelected,
    });
  }, [stats, filteredActivities, width, height, resolvedTheme, selected, setSelected]);

  const Legend = stats.Legend as (props: LegendProps<typeof name>) => JSX.Element | null;

  return (
    <>
      <div
        className="flex justify-evenly overflow-scroll"
        style={{
          height: height,
          width: width,
        }}
      >
        {definition && (
          <Chart
            definition={definition}
            width={width}
            height={height}
            ariaLabel={`${String(name)} chart`}
          />
        )}
      </div>
      {portalTarget && createPortal(
        <>
          <Legend
            setting={stats.setting}
            activities={filteredActivities}
            theme={resolvedTheme}
          />
          <FormComponent stat={stats as unknown as Stats<typeof name>} />
        </>,
        portalTarget,
      )}
    </>
  );
}
