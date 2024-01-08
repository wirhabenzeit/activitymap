import React, { useContext, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import { SimpleLinearRegression } from "ml-regression-simple-linear";

import { Box } from "@mui/material";

import { StatsContext } from "../../contexts/StatsContext.jsx";
import { CustomSelect } from "../Stats.jsx";

const cumData = ({
  activities,
  key = d3.utcYear,
  keyName = "Year",
  value = (x) => x.total_elevation_gain,
}) => {
  return d3
    .groups(activities, (x) => key(x.date))
    .flatMap(([dateKey, acts]) => {
      acts = acts.sort((a, b) => a.date - b.date);
      const cumsum = d3.cumsum(acts, value);
      return d3.zip(acts, cumsum).map(([act, sum]) => ({
        ...act,
        [keyName]: dateKey,
        cumsum: sum,
      }));
    })
    .sort((a, b) => a.date - b.date);
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
  value = (x) => x.total_elevation_gain,
  valueName = "Elevation",
  valueFormat = (x) => x.toFixed(0) + "m",
  ...options
}) => {
  console.log(activities);
  var data = cumData({
    activities: activities,
    key,
    keyName: scaleTickName,
  }).map((entry) => ({
    ...entry,
    virtualDate: new Date(
      new Date("2024-01-01").getTime() +
        entry.date.getTime() -
        key(entry.date).getTime()
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
    (x) => x[scaleTickName].getTime() == keys[keys.length - 1].getTime()
  );

  console.log(current);

  const reg = new SimpleLinearRegression(
    current.map((d) => d.virtualDate.getTime() - domain[0].getTime()),
    current.map((d) => d.cumsum)
  );

  console.log(reg);
  const map = { y: "cumsum", x: "virtualDate", stroke: scaleTickName };

  return Plot.plot({
    ...options,
    marginLeft: 60,
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
    y: { axis: "right", label: valueName, tickFormat: valueFormat, ticks: 6 },
    color: {
      type: "categorical",
      scheme: "Blues",
      legend: true,
      tickFormat: scaleTick,
    },
    marks: [
      Plot.frame(),
      Plot.line(domain, {
        x: Plot.identity,
        y: (x) =>
          (x.getTime() - domain[0].getTime()) * reg.slope + reg.intercept,
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
          channels: { Name: "name", [valueName]: value },
          format: {
            x: null,
            stroke: scaleTick,
            y: null,
            [valueName]: valueFormat,
          },
        })
      ),
      Plot.crosshair(data, map),
      Plot.linearRegressionY(
        data.filter(
          (x) =>
            key(x.start_date_local).getTime() == keys[keys.length - 1].getTime()
        ),
        { ...map, fillOpacity: 0 }
      ),
    ],
  });
};

export default function ProgressPlot({ width, height, settingsRef }) {
  const statsContext = useContext(StatsContext);
  const figureRef = useRef(null);
  const figureRef2 = useRef(null);

  const plotWidth = Math.min(Math.max(width, 100), 1600);
  const plotHeight = Math.max(height, 100);

  useEffect(() => {
    console.log(statsContext.data);
    if (!statsContext.loaded) return;

    const scaleTick = d3.timeFormat("%Y");

    const yearPlot = progressPlot({
      activities: statsContext.data,
      height: height / 3,
      width: width,
      scaleTick,
      title: "Yearly Progress",
    });

    const monthPlot = progressPlot({
      activities: statsContext.data,
      height: height / 3,
      width: width,
      scaleTickName: "Month",
      key: d3.utcMonth,
      scaleTick: d3.timeFormat("%b"),
      tick: d3.timeFormat("%d"),
      domain: [new Date("2024-01-01"), new Date("2024-01-31 23:59:59")],
      title: "Monthly Progress",
    });

    figureRef.current.append(yearPlot);
    figureRef2.current.append(monthPlot);
    return () => {
      yearPlot.remove();
      monthPlot.remove();
    };
  }, [width, height, statsContext.data]);

  return (
    <>
      <Box
        sx={{
          height: height,
          width: width,
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
          overflow: "scroll",
        }}
      >
        <div ref={figureRef} />
        <div ref={figureRef2} />
      </Box>
      {settingsRef.current && createPortal(<></>, settingsRef.current)}
    </>
  );
}
