"use client";

import type {Activity} from "~/server/db/schema";
import React, {useRef, useEffect, useContext} from "react";
import {StatsContext} from "../layout";
import {createPortal} from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import {SimpleLinearRegression} from "ml-regression-simple-linear";

import {Box} from "@mui/material";

import {CustomSelect} from "~/app/stats/ChartHelpers";
import {progressSettings} from "~/settings/stats";

import {useStore} from "~/contexts/Zustand";

export default function ProgressPlot() {
  const {width, height, settingsRef} =
    useContext(StatsContext);
  const {loaded, progress, activityDict, setProgress} =
    useStore((state) => ({
      loaded: state.loaded,
      progress: state.progress,
      setProgress: state.setProgress,
      activityDict: state.activityDict,
    }));
  const figureRef = useRef(null);

  const plotWidth = width;
  const plotHeight = height;

  useEffect(() => {
    if (!loaded) return;

    const plot = progressPlot({
      dots: progress.by.dots,
      activities: Object.values(activityDict),
      height: plotHeight,
      width: plotWidth,
      value: progress.value.fun,
      valueName: progress.value.label,
      valueFormat: progress.value.format,
      unit: progress.value.unit,
      scaleTickName: progress.by.label,
      key: progress.by.tick,
      scaleTick: d3.timeFormat(progress.by.legendFormat),
      tick: d3.timeFormat(progress.by.tickFormat),
      domain: progress.by.domain,
      nTicks: progress.by.nTicks,
      curve: progress.by.curve,
    });

    Object.assign(plot, {
      style: `margin: 0; width: ${plotWidth}px;`,
    });

    figureRef.current.append(plot);
    const legend = plot.legend("color", {
      width: 300,
      height: 40,
      marginLeft: 10,
      marginRight: 10,
      marginBottom: 20,
      marginTop: 15,
    });
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
          overflowY: "scroll",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div ref={figureRef} />
      </Box>
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

const cumData = ({
  activities,
  key,
  keyName,
  value,
}: {
  activities: Activity;
  key: unknown;
  keyName: string;
  value: unknown;
}) => {
  const cumulative = d3
    .groups(activities, (x) =>
      key(new Date(x.start_date_local))
    )
    .flatMap(([dateKey, acts]) => {
      acts = acts.sort(
        (a, b) =>
          a.start_date_local_timestamp -
          b.start_date_local_timestamp
      );
      const cumsum = d3.cumsum(acts, value);
      return [
        {
          start_date_local: key(acts[0].start_date_local),
          [keyName]: dateKey,
          cumsum: 0,
        },
        ...d3.zip(acts, cumsum).map(([act, sum]) => ({
          ...act,
          [keyName]: dateKey,
          cumsum: sum,
        })),
      ];
    });
  /*.sort(
      (a, b) =>
        a.start_date_local_timestamp -
        b.start_date_local_timestamp
    );*/
  console.log(cumulative);
  return cumulative;
};

const progressPlot = ({
  activities,
  dots,
  width,
  height,
  key,
  tick,
  scaleTick,
  scaleTickName,
  domain,
  value,
  valueName,
  valueFormat,
  unit,
  nTicks,
  curve,
  ...options
}) => {
  var data = cumData({
    activities: activities,
    key,
    keyName: scaleTickName,
    value,
  }).map((entry) => ({
    ...entry,
    virtualDate: new Date(
      new Date("2024-01-01").getTime() +
        new Date(entry.start_date_local).getTime() -
        key(new Date(entry.start_date_local)).getTime()
    ),
  }));

  const keys = Array.from(
    new d3.InternSet(data.map((x) => key(x[scaleTickName])))
  ).sort((a, b) => a - b);

  data = data.filter((x) =>
    keys
      .slice(-5)
      .map((y) => y.getTime())
      .includes(x[scaleTickName].getTime())
  );

  const current = data.filter(
    (x) =>
      x[scaleTickName].getTime() ==
      keys[keys.length - 1].getTime()
  );

  const reg = new SimpleLinearRegression(
    current.map(
      (d) => d.virtualDate.getTime() - domain[0].getTime()
    ),
    current.map((d) => d.cumsum)
  );

  const map = {
    y: "cumsum",
    x: "virtualDate",
    stroke: scaleTickName,
  };

  return Plot.plot({
    ...options,
    marginRight: 60,
    marginTop: 30,
    width,
    height,
    grid: true,
    style: {
      fontSize: 14,
    },
    x: {
      tickFormat: tick,
      axis: "top",
      domain,
      label: null,
      labelAnchor: "left",
      ticks: nTicks,
    },
    y: {
      axis: "right",
      label: valueName,
      tickFormat: valueFormat,
      ticks: 6,
    },
    color: {
      type: "categorical",
      //scheme: "Blues",
      legend: false,
      tickFormat: scaleTick,
    },
    marks: [
      Plot.frame(),
      /*Plot.line(domain, {
        x: Plot.identity,
        y: (x) =>
          (x.getTime() - domain[0].getTime()) * reg.slope +
          reg.intercept,
        opacity: 0.1,
        stroke: (x) => key(domain[0]),
        strokeWidth: 5,
      }),*/
      Plot.line(data, {
        //stroke: (x) => key(x.start_date_local),
        ...map,
        curve: curve,
      }),
      ...(dots
        ? [
            Plot.dot(data, {
              ...map,
            }),
          ]
        : []),
      Plot.tip(
        data,
        Plot.pointer({
          ...map,
          channels: {Name: "name", [valueName]: value},
          format: {
            x: null,
            stroke: scaleTick,
            y: null,
            [valueName]: (x) => valueFormat(x) + unit,
          },
        })
      ),
      Plot.crosshair(data, {
        ...map,
        textStrokeOpacity: 0,
      }),
      Plot.linearRegressionY(
        data.filter(
          (x) =>
            key(x.start_date_local).getTime() ==
            keys[keys.length - 1].getTime()
        ),
        {...map, fillOpacity: 0}
      ),
    ],
  });
};
