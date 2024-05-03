"use client";

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

const cumData = ({activities, key, keyName, value}) => {
  const cumulative = d3
    .groups(activities, (x) =>
      key(new Date(x.start_date_local))
    )
    .flatMap(([dateKey, acts]) => {
      acts = acts.sort(
        (a, b) =>
          a.start_date_local_timetamp -
          b.start_date_local_timetamp
      );
      const cumsum = d3.cumsum(acts, value);
      return d3.zip(acts, cumsum).map(([act, sum]) => ({
        ...act,
        [keyName]: dateKey,
        cumsum: sum,
      }));
    })
    .sort(
      (a, b) =>
        a.start_date_local_timestamp -
        b.start_date_local_timestamp
    );
  return cumulative;
};

const progressPlot = ({
  activities,
  width,
  height,
  key = d3.utcYear,
  tick = d3.timeFormat("%b"),
  scaleTick = d3.timeFormat("%Y"),
  scaleTickName = "Year",
  domain = [new Date("2024-01-01"), new Date("2024-12-31")],
  value,
  valueName = "",
  valueFormat = (x) => x,
  unit = "",
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
    marginLeft: 80,
    marginRight: 60,
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
      legend: true,
      tickFormat: scaleTick,
    },
    marks: [
      Plot.frame(),
      Plot.line(domain, {
        x: Plot.identity,
        y: (x) =>
          (x.getTime() - domain[0].getTime()) * reg.slope +
          reg.intercept,
        opacity: 0.1,
        stroke: (x) => key(domain[0]),
        strokeWidth: 5,
      }),
      Plot.line(data, {
        stroke: (x) => key(x.start_date_local),
        ...map,
        curve: "step-after",
      }),
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
  const figureRef2 = useRef(null);

  const plotWidth = 0.9 * width;
  const plotHeight = 0.87 * height;

  useEffect(() => {
    if (!loaded) return;

    const commonSettings = {
      activities: Object.values(activityDict),
      height: plotHeight,
      width: plotWidth,
      value: progress.value.fun,
      valueName: progress.value.label,
      valueFormat: progress.value.format,
      unit: progress.value.unit,
    };

    const yearPlot = progressPlot({
      ...commonSettings,
      scaleTickName: "Year",
      key: d3.utcYear,
      scaleTick: d3.timeFormat("%Y"),
      tick: d3.timeFormat("%b"),
      domain: [
        new Date("2024-01-01"),
        new Date("2024-12-31 23:59:59"),
      ],
      title: "Yearly Progress",
    });

    const monthPlot = progressPlot({
      ...commonSettings,
      scaleTickName: "Month",
      key: d3.utcMonth,
      scaleTick: d3.timeFormat("%b"),
      tick: d3.timeFormat("%d"),
      domain: [
        new Date("2024-01-01"),
        new Date("2024-01-31 23:59:59"),
      ],
      title: "Monthly Progress",
    });

    Object.assign(yearPlot, {
      style: `margin: 0; width: ${plotWidth}px;`,
    });

    Object.assign(monthPlot, {
      style: `margin: 0; width: ${plotWidth}px;`,
    });

    figureRef.current.append(yearPlot);
    figureRef2.current.append(monthPlot);
    return () => {
      yearPlot.remove();
      monthPlot.remove();
    };
  }, [width, height, activityDict, progress]);

  return (
    <>
      <Box
        sx={{
          height: height,
          width: width,
          overflow: "scroll",
        }}
      >
        <div
          ref={figureRef}
          style={{
            display: "flex",
            justifyContent: "center",
            width: "100%",
          }}
        />
        <div
          ref={figureRef2}
          style={{
            display: "flex",
            justifyContent: "center",
            width: "100%",
          }}
        />
      </Box>
      {settingsRef.current &&
        createPortal(
          <CustomSelect
            key="value"
            propName="value"
            value={progress.value}
            name="Value"
            options={progressSettings.values}
            setState={setProgress}
          />,
          settingsRef.current
        )}
    </>
  );
}
