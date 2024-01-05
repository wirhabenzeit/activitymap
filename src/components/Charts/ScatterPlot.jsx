import React, { useContext, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import { StatsContext } from "../../contexts/StatsContext.jsx";
import { CustomSelect } from "../StatsUtilities.jsx";
import { scatterSettings } from "../../settings.jsx";

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
      ? d3.scalePow(scale.domain, scale.range).exponent(scale.exponent)
      : d3.scaleLinear(scale.domain, scale.range);

  const r0 = scale.range[1];
  const shiftY = label ? 10 : 0;

  let h = Infinity;
  const values = s
    .ticks(ticks)
    .reverse()
    .filter((t) => h - s(t) > lineHeight / 2 && (h = s(t)));

  return Plot.plot({
    x: { type: "identity", axis: null },
    r: { type: "identity" },
    y: { type: "identity", axis: null },
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

export default function ScatterPlot({ width, height, settingsRef }) {
  const statsContext = useContext(StatsContext);
  const figureRef = useRef(null);
  const scatterSetting = statsContext.scatter;

  useEffect(() => {
    if (!statsContext.calendar.loaded) return;
    const plot = Plot.plot({
      height: Math.max(height, 100),
      width: Math.max(width, 100),
      padding: 0,
      marginLeft: 60,
      marginRight: 60,
      marginBottom: 30,
      style: {
        fontSize: 12,
      },
      x: {
        tickFormat: scatterSetting.xValue.formatAxis,
        grid: true,
        ticks: 6,
        axis: "top",
      },
      y: {
        tickFormat: scatterSetting.yValue.formatAxis,
        grid: true,
        ticks: 6,
        axis: "right",
      },
      r: {
        range: [0, 10],
        domain: d3.extent(statsContext.data, scatterSetting.size.fun),
      },
      marks: [
        Plot.dot(statsContext.data, {
          x: scatterSetting.xValue.fun,
          y: scatterSetting.yValue.fun,
          r: scatterSetting.size.fun,
          fill: (d) => scatterSetting.group.color(scatterSetting.group.fun(d)),
          fillOpacity: 0.5,
          channels: {
            Activity: (d) => d.name,
            [scatterSetting.size.label]: scatterSetting.size.fun,
            [scatterSetting.xValue.label]: scatterSetting.xValue.fun,
            [scatterSetting.yValue.label]: scatterSetting.yValue.fun,
          },
          tip: {
            format: {
              x: null,
              y: null,
              r: null,
              fill: null,
              Activity: (x) => x,
              [scatterSetting.size.label]: scatterSetting.size.format,
              [scatterSetting.xValue.label]: scatterSetting.xValue.format,
              [scatterSetting.yValue.label]: scatterSetting.yValue.format,
            },
          },
        }),
        Plot.crosshair(statsContext.data, {
          x: scatterSetting.xValue.fun,
          y: scatterSetting.yValue.fun,
          color: (d) => scatterSetting.group.color(scatterSetting.group.fun(d)),
        }),
      ],
    });
    const legend = legendRadius(plot.scale("r"), {
      ticks: 4,
      tickFormat: scatterSetting.size.format,
      label: scatterSetting.size.label,
    });
    Object.assign(legend, {
      style: `height: 40px; overflow: scroll; min-width: 100px; margin: 0px;`,
    });
    figureRef.current.append(plot);
    settingsRef.current.append(legend);
    return () => {
      plot.remove();
      legend.remove();
    };
  }, [statsContext.scatter, width, height]);

  return (
    <>
      <div ref={figureRef} style={{ height: height, width: width }} />
      {settingsRef.current &&
        createPortal(
          <>
            <CustomSelect
              key="xValue"
              propName="xValue"
              value={statsContext.scatter.xValue}
              name="X"
              options={scatterSettings.values}
              setState={statsContext.setScatter}
            />
            <CustomSelect
              key="yValue"
              propName="yValue"
              value={statsContext.scatter.yValue}
              name="Y"
              options={scatterSettings.values}
              setState={statsContext.setScatter}
            />
            <CustomSelect
              key="size"
              propName="size"
              value={statsContext.scatter.size}
              name="Size"
              options={scatterSettings.values}
              setState={statsContext.setScatter}
            />
          </>,
          settingsRef.current
        )}
    </>
  );
}
