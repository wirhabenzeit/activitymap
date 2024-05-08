"use client";

import type {Activity} from "~/server/db/schema";
import React, {useRef, useEffect, useContext} from "react";
import {StatsContext} from "../layout";
import {createPortal} from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import {Box} from "@mui/material";

import {CustomSelect} from "~/app/stats/ChartHelpers";
import {progressSettings} from "~/settings/stats";

import {useStore} from "~/contexts/Zustand";

type ProgressBy = {
  id: string;
  label: string;
  tick: (date: Date) => Date;
  legendFormat: (date: Date) => string;
  tickFormat: (date: Date) => string;
  curve: Plot.Curve;
  dots: boolean;
  nTicks: number;
  domain: [Date, Date];
};

type ProgressValue = {
  id: string;
  fun: (d: Activity) => number;
  format: (v: number) => string;
  label: string;
  unit: string;
};

const progressPlot =
  ({by, value}: {by: ProgressBy; value: ProgressValue}) =>
  ({
    activities,
    width,
    height,
  }: {
    activities: Activity[];
    width: number;
    height: number;
  }) => {
    const showCrosshair = width > 500;

    const cumulative = d3
      .groups(activities, (x) =>
        by.tick(new Date(x.start_date_local))
      )
      .flatMap(([dateKey, acts]) => {
        acts = acts.sort(
          (a, b) =>
            a.start_date_local_timestamp -
            b.start_date_local_timestamp
        );
        const cumsum = d3.cumsum(acts, value.fun);
        return [
          {
            start_date_local: by.tick(
              acts[0].start_date_local
            ),
            [by.label]: dateKey,
            cumsum: 0,
          },
          ...d3.zip(acts, cumsum).map(([act, sum]) => ({
            ...act,
            [by.label]: dateKey,
            cumsum: sum,
          })),
        ];
      });

    let data = cumulative.map((entry) => ({
      ...entry,
      virtualDate: new Date(
        new Date("2024-01-01").getTime() +
          new Date(entry.start_date_local).getTime() -
          by
            .tick(new Date(entry.start_date_local))
            .getTime()
      ),
    }));

    const keys = Array.from(
      new d3.InternSet(
        data.map((x) => by.tick(x[by.label]))
      )
    ).sort((a, b) => a - b);

    data = data.filter((x) =>
      keys
        .slice(-5)
        .map((y) => y.getTime())
        .includes(x[by.label].getTime())
    );

    return Plot.plot({
      marginRight: 70,
      marginTop: 40,
      ...(showCrosshair
        ? {marginBottom: 40, marginLeft: 70}
        : {marginBottom: 20, marginLeft: 30}),
      width,
      height,
      grid: true,
      style: {
        fontSize: "10pt",
      },
      figure: true,
      x: {
        tickFormat: by.tickFormat,
        axis: "top",
        domain: by.domain,
        label: null,
        ticks: by.nTicks,
      },
      y: {
        axis: "right",
        label: null,
        tickFormat: value.format,
        ticks: 6,
      },
      color: {
        type: "categorical",
        legend: false,
        tickFormat: by.legendFormat,
      },
      marks: [
        Plot.frame(),
        Plot.line(data, {
          y: "cumsum",
          x: "virtualDate",
          stroke: by.label,
          curve: by.curve,
        }),
        ...(by.dots
          ? [
              Plot.dot(data, {
                y: "cumsum",
                x: "virtualDate",
                stroke: by.label,
              }),
            ]
          : []),
        Plot.tip(
          data,
          Plot.pointer({
            y: "cumsum",
            x: "virtualDate",
            stroke: by.label,
            channels: {
              Name: "name",
              [value.label]: value.fun,
            },
            format: {
              x: undefined,
              stroke: by.legendFormat,
              y: undefined,
              [value.label]: (x) => value.format(x),
            },
          })
        ),
        ...(showCrosshair
          ? [
              Plot.crosshair(data, {
                y: "cumsum",
                x: "virtualDate",
                color: by.label,
              }),
            ]
          : []),
      ],
    });
  };

export default function ProgressPlot() {
  const {width, height, settingsRef} =
    useContext(StatsContext);
  const {
    loaded,
    progress,
    activityDict,
    setProgress,
    filterIDs,
  } = useStore((state) => ({
    loaded: state.loaded,
    progress: state.progress,
    setProgress: state.setProgress,
    activityDict: state.activityDict,
    filterIDs: state.filterIDs,
  }));
  const figureRef = useRef(null);

  const plotWidth = width;
  const plotHeight = height;

  useEffect(() => {
    if (!loaded) return;

    const plot = progressPlot(progress)({
      activities: filterIDs
        .filter((id) => activityDict[id] != undefined)
        .map((id) => activityDict[id]),
      height: plotHeight,
      width: plotWidth,
    });

    Object.assign(plot, {
      style: `margin: 0;`,
    });

    figureRef.current.append(plot);
    const legend = plot.legend("color");
    Object.assign(legend, {
      style: `min-height: 0; display: block;`,
    });
    settingsRef.current.append(legend);

    return () => {
      plot.remove();
      legend.remove();
    };
  }, [width, height, activityDict, progress]);

  return (
    <>
      <Box
        sx={{
          height: height,
          width: width,
          overflow: "hidden",
        }}
        ref={figureRef}
      />
      {settingsRef.current &&
        createPortal(
          <>
            <CustomSelect
              key="by"
              propName="by"
              value={progress.by}
              name="By"
              options={progressSettings.by}
              setState={(x) =>
                setProgress({...progress, by: x})
              }
            />
            <CustomSelect
              key="value"
              propName="value"
              value={progress.value}
              name="Value"
              options={progressSettings.values}
              setState={(x) =>
                setProgress({...progress, value: x})
              }
            />
          </>,
          settingsRef.current
        )}
    </>
  );
}
