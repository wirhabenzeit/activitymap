"use client";

import {useEffect, useRef} from "react";
import {createPortal} from "react-dom";

import {useStore} from "~/contexts/Zustand";
import {useContext} from "react";
import {StatsContext} from "~/app/stats/[name]/layout";
import statsPlots, {
  type StatsSetter,
  type StatsSetting,
  type StatsSettings,
} from "~/stats";

import * as React from "react";

import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Slider,
  IconButton,
  Stack,
  type SelectChangeEvent,
} from "@mui/material";
import {Activity} from "~/server/db/schema";
import Plot from "@observablehq/plot";

type Stats<K extends keyof StatsSetting> = {
  settings: StatsSettings[K];
  setting: StatsSetting[K];
  setter: StatsSetter[K];
  plot: (
    setting: StatsSetting[K]
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
    setting: StatsSetting[K]
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
  const setter = (value: StatsSetting[T]) =>
    stat.setter(propName, value);

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

function Form<T extends keyof StatsSetting>(
  stat: Stats<T>
) {
  return (
    <>
      {(Object.keys(stat.settings) as T[]).map(
        (propName) => (
          <FormElement
            key={propName}
            propName={propName}
            stat={stat}
          />
        )
      )}
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
  setting: CategoricalSetting<K, T>;
  value: K;
  setter: (value: K) => void;
}) => {
  if (Object.keys(setting.options).length == 1) return null;
  return (
    <FormControl>
      <InputLabel>{setting.label}</InputLabel>
      <Select
        size="small"
        autoWidth
        value={value}
        onChange={(event: SelectChangeEvent) =>
          setter(event.target.value as K)
        }
      >
        {(Object.keys(setting.options) as K[]).map(
          (key) => (
            <MenuItem value={key} key={key}>
              {setting.options[key].label}
            </MenuItem>
          )
        )}
      </Select>
    </FormControl>
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
  value: {value: number; domain: [number, number]};
  setter: (value: number) => void;
}) => {
  //console.log(setting, value);
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <IconButton
        onClick={() => setter(value.domain[0])}
        disabled={value.value == value.domain[0]}
      >
        {setting.minIcon}
      </IconButton>
      <Box sx={{width: 100}}>
        <Slider
          disabled={value.domain[0] == value.domain[1]}
          marks={true}
          min={value.domain[0]}
          max={value.domain[1]}
          size="small"
          value={value.value}
          onChange={(e, v) => setter(v as number)}
        />
      </Box>
      <IconButton
        onClick={() => setter(value.domain[1])}
        disabled={value.value == value.domain[1]}
      >
        {setting.maxIcon}
      </IconButton>
    </Stack>
  );
};

type Setting = CategoricalSetting<any, any> | ValueSetting;

export default function ObsPlot({
  name,
}: {
  name: keyof StatsSetting;
}) {
  const {
    loaded,
    statsSettings,
    activityDict,
    setStats,
    filterIDs,
  } = useStore((state) => ({
    loaded: state.loaded,
    activityDict: state.activityDict,
    filterIDs: state.filterIDs,
    statsSettings: state.statsSettings,
    setStats: state.setStatsSettings,
  }));

  const figureRef = useRef<HTMLDivElement>(null);
  const {width, height, settingsRef} =
    useContext(StatsContext);

  const stats = (
    Object.keys(statsPlots) as (keyof StatsSetting)[]
  ).reduce(
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
    {} as Record<
      keyof StatsSetting,
      Stats<keyof StatsSetting>
    >
  );

  useEffect(() => {
    if (!loaded) return;
    if (!figureRef.current) return;
    if (!settingsRef.current) return;

    const plot = makePlot(stats[name])({
      activities: filterIDs.map((id) => activityDict[id]!),
      height,
      width,
    });

    Object.assign(plot, {
      style: `margin: 0;`,
    });

    figureRef.current.append(plot as Node);
    const legend = makeLegend(stats[name])(plot);
    if (legend) {
      Object.assign(legend, {
        style: `min-height: 0; display: block;`,
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
  ]);

  return (
    <>
      <Box
        /*sx={{
          height: height,
          width: width,
          overflow: "hidden",
        }}*/
        sx={{
          height: height,
          width: width,
          overflow: "scroll",
          display: "flex",
          justifyContent: "center",
        }}
        ref={figureRef}
      />
      {settingsRef.current &&
        createPortal(
          Form<typeof name>(stats[name]),
          settingsRef.current
        )}
    </>
  );
}
