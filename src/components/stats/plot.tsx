"use client";

import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { useStore } from "~/contexts/Zustand";
import { useShallow } from "zustand/shallow";

import { useContext } from "react";
import { StatsContext } from "~/app/stats/[name]/StatsContext";
import statsPlots, {
  type StatsSetter,
  type StatsSetting,
  type StatsSettings,
} from "~/stats";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { Slider } from "~/components/ui/slider";

import { type Activity } from "~/server/db/schema";
import { Button } from "~/components/ui/button";
import { Plot } from "@observablehq/plot";

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
  }) => Plot.Plot & HTMLElement;
  legend: (
    setting: StatsSetting[K],
  ) => (plot: Plot.Plot) => Plot.Plot & HTMLElement;
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
  const setter = (value: StatsSetting[T]) => stat.setter(propName, value);

  switch (setting.type) {
    case "categorical":
      return (
        <SelectFormElement
          key={propName}
          setting={setting}
          value={value}
          setter={setter}
        />
      );
    case "number":
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
  type: "categorical";
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
  if (Object.keys(setting.options).length == 1) return null;
  return (
    <Select value={value} onValueChange={(val) => setter(val as K)}>
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
  type: "value";
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
        onClick={() => setter(value.domain[0])}
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
          if (v && v[0]) setter(v[0]);
        }}
      />
      <Button
        onClick={() => setter(value.domain[1])}
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
  const {
    loaded,
    statsSettings,
    activityDict,
    setStats,
    filterIDs,
    selected,
    setSelected,
  } = useStore(
    useShallow((state) => ({
      loaded: state.loaded,
      activityDict: state.activityDict,
      filterIDs: state.filterIDs,
      statsSettings: state.statsSettings,
      setStats: state.setStatsSettings,
      selected: state.selected,
      setSelected: state.setSelected,
    })),
  );
  const { theme } = useTheme();

  const figureRef = useRef<HTMLDivElement>(null);
  const { width, height, settingsRef } = useContext(StatsContext);

  const stats = (Object.keys(statsPlots) as (keyof StatsSetting)[]).reduce(
    (acc, key) => ({
      ...acc,
      [key]: {
        plot: statsPlots[key].plot,
        legend: statsPlots[key].legend,
        setting: statsSettings[key],
        settings: statsPlots[key].settings,
        kind: key,
        setter: setStats[key],
      },
    }),
    {} as Record<keyof StatsSetting, Stats<keyof StatsSetting>>,
  );

  useEffect(() => {
    if (!loaded) return;
    if (!figureRef.current) return;
    if (!settingsRef.current) return;

    const plot = makePlot(stats[name])({
      activities: filterIDs.map((id) => activityDict[id]!),
      selected: selected,
      setSelected: setSelected,
      height,
      width,
      theme,
    });

    Object.assign(plot, {
      style: `margin: 0;`,
    });

    figureRef.current.append(plot as Node);
    const legend = makeLegend(stats[name])(plot);
    if (legend) {
      Object.assign(legend, {
        style: `min-height: 0; display: block; margin-bottom: 0 !important;`,
      });
      settingsRef.current.append(legend);
    }

    return () => {
      plot.remove();
      if (legend) legend.remove();
    };
  }, [
    width,
    height,
    activityDict,
    statsSettings[name],
    filterIDs,
    selected,
    theme,
  ]);

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
      {settingsRef.current &&
        createPortal(Form<typeof name>(stats[name]), settingsRef.current)}
    </>
  );
}
