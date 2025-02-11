'use client';

import { useEffect, useRef, type JSX, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import { useShallowStore, useStore } from '~/store';

import { useContext } from 'react';
import { StatsContext } from '~/app/stats/[name]/StatsContext';
import statsPlots, {
  type StatsSetter,
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

type Stats<K extends keyof StatsSetting> = {
  settings: StatsSettings[K];
  setting: StatsSetting[K];
  setter: StatsSetter[K];
  plot: (
    setting: StatsSetting[K],
  ) => ({
    activities,
    width,
    height,
  }: {
    activities: Activity[];
    width: number;
    height: number;
  }) => Plot & HTMLElement;
  legend: (setting: StatsSetting[K]) => (plot: Plot) => Plot & HTMLElement;
  kind: K;
};

function makePlot(stat: Stats<keyof StatsSetting>) {
  return stat.plot(stat.setting);
}

function makeLegend(stat: Stats<keyof StatsSetting>) {
  return stat.legend(stat.setting);
}

type FormElementProps<T extends keyof StatsSetting> = {
  propName: T;
  stat: Stats<T>;
};

function FormElement<T extends keyof StatsSetting>({
  propName,
  stat,
}: FormElementProps<T>) {
  const setting = stat.settings[propName];
  const value = stat.setting[propName];
  const setter = (value: StatsSetting[T]) =>
    stat.setter((s) => ({ ...s, [propName]: value(s[propName]) }));

  switch (setting.type) {
    case 'categorical':
      return (
        <SelectFormElement
          key={propName}
          setting={setting}
          value={value}
          setter={setter}
        />
      );
    case 'number':
      return (
        <SliderFormElement
          key={propName}
          setting={setting}
          value={value}
          setter={setter}
        />
      );
    default:
      return null;
  }
}

function Form<T extends keyof StatsSetting>(stat: Stats<T>) {
  return (
    <>
      {(Object.keys(stat.settings) as T[]).map((propName) => (
        <FormElement key={propName} propName={propName} stat={stat} />
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
      [key: string]: any;
    } & T
  >;
};

export const SelectFormElement = <K extends string, T>({
  setting,
  value,
  setter,
}: {
  key: string;
  keyName: string;
  setting: CategoricalSetting<K, T>;
  value: K;
  setter: (value: K) => void;
}) => {
  const ssetting = useStore((state) => state.settings);
  if (Object.keys(setting.options).length == 1) return null;
  console.log(ssetting, setting, value);
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

export const SliderFormElement = ({
  setting,
  value,
  setter,
}: {
  setting: ValueSetting;
  value: { value: number; domain: [number, number] };
  setter: (value: number) => void;
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
          if (v && v[0]) setter((val) => ({ value: v[0], domain: val.domain }));
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

type Setting = CategoricalSetting<any, any> | ValueSetting;

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
      setter: (value) =>
        setSettings((setting) => ({
          ...setting,
          [name]: value(setting[name]),
        })),
    }),
    [settings],
  );

  useEffect(() => {
    if (!figureRef.current || !settingsRef.current) return;

    const plot = makePlot(stats)({
      activities: filterIDs.map((id) => activityDict[id]!),
      width,
      height,
      theme: theme === 'dark' ? 'dark' : 'light',
    });

    if (!plot) return;

    plot.style = 'margin: 0;';
    figureRef.current.append(plot as Node);

    const legend = makeLegend(stats)(plot);
    if (legend) {
      legend.style =
        'min-height: 0; display: block; margin-bottom: 0 !important;';
      settingsRef.current.append(legend);
    }

    return () => {
      plot.remove();
      if (legend) legend.remove();
    };
  }, [width, height, activityDict, settings[name], filterIDs, theme]);

  const form = useMemo(
    () => (settingsRef.current ? Form<typeof name>(stats) : null),
    [stats, name, settingsRef.current],
  );

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
      {settingsRef.current && form && createPortal(form, settingsRef.current)}
    </>
  );
}
