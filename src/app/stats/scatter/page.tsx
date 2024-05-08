"use client";

import React, {useContext, useRef, useEffect} from "react";
import {createPortal} from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import {Box} from "@mui/material";

import {StatsContext} from "../layout";
import {CustomSelect} from "~/app/stats/ChartHelpers";
import {scatterSettings} from "~/settings/stats";
import {useStore} from "~/contexts/Zustand";

function legendRadius(
  scale,
  {
    label = scale.label,
    ticks = 5,
    tickFormat = (d) => d,
    strokeWidth = 0.5,
    strokeDasharray = [5, 4],
    lineHeight = 8,
    gap = 20,
    style,
  } = {}
) {
  // const s = scale.scale;
  const s =
    scale.type === "pow"
      ? d3
          .scalePow(scale.domain, scale.range)
          .exponent(scale.exponent)
      : d3.scaleLinear(scale.domain, scale.range);

  const r0 = scale.range[1];
  const shiftY = label ? 10 : 0;

  let h = Infinity;
  const values = s
    .ticks(ticks)
    .reverse()
    .filter((t) => h - s(t) > lineHeight / 2 && (h = s(t)));

  return Plot.plot({
    x: {type: "identity", axis: null},
    r: {type: "identity"},
    y: {type: "identity", axis: null},
    caption: "",
    marks: [
      Plot.link(values, {
        x1: r0 + 2,
        y1: (d) => 8 + 2 * r0 - 2 * s(d) + shiftY,
        x2: 2 * r0 + 2 + gap,
        y2: (d) => 8 + 2 * r0 - 2 * s(d) + shiftY,
        strokeWidth: strokeWidth / 2,
        strokeDasharray,
      }),
      Plot.dot(values, {
        r: s,
        x: r0 + 2,
        y: (d) => 8 + 2 * r0 - s(d) + shiftY,
        strokeWidth,
      }),
      Plot.text(values, {
        x: 2 * r0 + 2 + gap,
        y: (d) => 8 + 2 * r0 - 2 * s(d) + shiftY,
        textAnchor: "start",
        dx: 4,
        text: tickFormat,
      }),
      Plot.text(label ? [label] : [], {
        x: 0,
        y: 6,
        textAnchor: "start",
        fontWeight: "bold",
      }),
    ],
    width: 100,
    height: 40,
    style,
  });
}

export default function ScatterPlot() {
  const {width, height, settingsRef} =
    useContext(StatsContext);
  const {
    scatter,
    setScatter,
    activityDict,
    loaded,
    filterIDs,
  } = useStore((state) => ({
    scatter: state.scatter,
    setScatter: state.setScatter,
    activityDict: state.activityDict,
    loaded: state.loaded,
    filterIDs: state.filterIDs,
  }));
  const figureRef = useRef(null);
  const plotWidth = Math.min(Math.max(width, 100), 1600);
  const plotHeight = Math.max(height, 100);

  useEffect(() => {
    if (!loaded) return;
    const data = filterIDs.map((id) => activityDict[id]);
    const plot = Plot.plot({
      //background: "#eee",
      grid: true,
      height: plotHeight,
      width: plotWidth,
      //padding: 20,
      marginLeft: 50,
      marginRight: 60,
      marginBottom: 30,
      figure: true,
      style: {
        fontSize: "10pt",
      },
      x: {
        tickFormat: scatter.xValue.formatAxis,
        axis: "top",
        ticks: width > 800 ? 8 : 5,
        label: `${scatter.xValue.label} ${
          scatter.xValue.unit != ""
            ? `(${scatter.xValue.unit})`
            : ""
        }`,
        labelAnchor: "left",
      },
      y: {
        tickFormat: scatter.yValue.formatAxis,
        axis: "right",
        ticks: 6,
        label: `${scatter.yValue.label} (${scatter.yValue.unit})`,
        labelAnchor: "bottom",
      },
      r: {
        range: [0, 10],
        domain: d3.extent(data, scatter.size.fun),
      },
      marks: [
        Plot.frame(),
        Plot.dot(data, {
          x: scatter.xValue.fun,
          y: scatter.yValue.fun,
          r: scatter.size.fun,
          stroke: (d) =>
            scatter.group.color(scatter.group.fun(d)),
          //fillOpacity: 0.5,
          channels: {
            Activity: (d) => d.name,
            [scatter.size.label]: scatter.size.fun,
            [scatter.xValue.label]: scatter.xValue.fun,
            [scatter.yValue.label]: scatter.yValue.fun,
          },
          tip: {
            format: {
              x: null,
              y: null,
              r: null,
              stroke: null,
              Activity: (x) => x,
              [scatter.size.label]: scatter.size.format,
              [scatter.xValue.label]: scatter.xValue.format,
              [scatter.yValue.label]: scatter.yValue.format,
            },
          },
        }),
        Plot.crosshair(data, {
          x: scatter.xValue.fun,
          y: scatter.yValue.fun,
          color: (d) =>
            scatter.group.color(scatter.group.fun(d)),
          //textStrokeOpacity: 1,
        }),
      ],
    });
    Object.assign(plot, {
      style: `width: ${plotWidth}px; overflow: scroll; margin: 0; min-width: 100px; display:block`,
    });
    const legend = legendRadius(plot.scale("r"), {
      ticks: 4,
      tickFormat: scatter.size.format,
      label: scatter.size.label,
    });
    Object.assign(legend, {
      style: `display: block; `,
    });
    figureRef.current.append(plot);
    settingsRef.current.append(legend);
    return () => {
      plot.remove();
      legend.remove();
    };
  }, [scatter, width, height, activityDict, filterIDs]);

  return (
    <>
      <Box
        sx={{
          height: height,
          width: width,
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
              key="xValue"
              propName="xValue"
              value={scatter.xValue}
              name="X"
              options={scatterSettings.values}
              setState={(x) => setScatter({xValue: x})}
            />
            <CustomSelect
              key="yValue"
              propName="yValue"
              value={scatter.yValue}
              name="Y"
              options={scatterSettings.values}
              setState={(x) => setScatter({yValue: x})}
            />
            <CustomSelect
              key="size"
              propName="size"
              value={scatter.size}
              name="Size"
              options={scatterSettings.values}
              setState={(x) => setScatter({size: x})}
            />
          </>,
          settingsRef.current
        )}
    </>
  );
}
