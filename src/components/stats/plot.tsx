'use client';

import { useEffect, useRef, type JSX, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import { useShallowStore, useStore } from '~/store';

import { useContext } from 'react';
import { StatsContext } from '~/app/stats/[name]/StatsContext';
import statsPlots, {
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
import { type Plot } from '@observablehq/plot';

// Define a union type for all possible setting keys
type SettingKey = keyof StatsSetting;

type Stats<K extends SettingKey> = {
  settings: StatsSettings[K];
  setting: StatsSetting[K];
  setter: (updater: (prev: StatsSetting[K]) => StatsSetting[K]) => void;
  plot: (
    setting: StatsSetting[K],
  ) => ({
    activities,
    width,
    height,
    theme,
  }: {
    activities: Activity[];
    width: number;
    height: number;
    theme: "light" | "dark";
  }) => (Plot & HTMLElement) | null;
  legend: (setting: StatsSetting[K]) => (plot: Plot) => (Plot & HTMLElement) | null;
  kind: K;
};

function makePlot<K extends SettingKey>(stat: Stats<K>) {
  return stat.plot(stat.setting);
}

function makeLegend<K extends SettingKey>(stat: Stats<K>) {
  return stat.legend(stat.setting);
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
    <Select value={value} onValueChange={(val) => setter(() => val as K)}>
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


export default function ObsPlot({ name }: { name: keyof StatsSetting }) {
  const { activityDict, filterIDs, settings, setSettings } = useShallowStore(
    (state) => ({
      activityDict: state.activityDict,
      filterIDs: state.filterIDs,
      settings: state.settings,
      setSettings: state.setSettings,
    }),
  );
  const { theme } = useTheme();

  const figureRef = useRef<HTMLDivElement>(null);
  const { width, height, settingsRef } = useContext(StatsContext);

  const stats = useMemo(
    () => ({
      plot: statsPlots[name].plot,
      legend: statsPlots[name].legend,
      setting: settings[name],
      kind: name,
      settings: statsPlots[name].settings,
      setter: (value: (prev: StatsSetting[typeof name]) => StatsSetting[typeof name]) =>
        setSettings((setting) => ({
          ...setting,
          [name]: value(setting[name]),
        })),
    }),
    [settings, name, setSettings],
  );

  useEffect(() => {
    if (!figureRef.current || !settingsRef.current) return;

    // Use type assertion with unknown as intermediate step
    const plotFn = makePlot(stats as unknown as Stats<typeof name>);
    const plot = plotFn({
      activities: filterIDs.map((id) => activityDict[id]!),
      width,
      height,
      theme: theme === 'dark' ? 'dark' : 'light',
    });

    if (!plot) return;

    plot.setAttribute('style', 'margin: 0;');
    figureRef.current.append(plot as Node);

    const legendFn = makeLegend(stats as unknown as Stats<typeof name>);
    const legend = legendFn(plot);
    if (legend) {
      legend.setAttribute('style', 'min-height: 0; display: block; margin-bottom: 0 !important;');
      settingsRef.current.append(legend);
    }

    return () => {
      plot.remove();
      if (legend) legend.remove();
    };
  }, [width, height, activityDict, settings[name], filterIDs, theme, name, stats, settingsRef]);

  return (
    <>
      <div
        className="flex justify-evenly overflow-scroll"
        style={{
          height: height,
          width: width,
        }}
        ref={figureRef}
      />
      {settingsRef.current && createPortal(
        <FormComponent stat={stats as unknown as Stats<typeof name>} />, 
        settingsRef.current
      )}
    </>
  );
}
