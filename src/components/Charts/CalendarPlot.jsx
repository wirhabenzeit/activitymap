import React, { useContext, useRef, useEffect } from "react";
import * as d3 from "d3";
import { Typography, Box } from "@mui/material";
import * as Plot from "@observablehq/plot";

import { CustomSelect, LegendPlot } from "../StatsUtilities.jsx";
import { calendarSettings } from "../../settings.jsx";
import * as htl from "htl";

import { StatsContext } from "../../contexts/StatsContext.jsx";

function calendar({ date = Plot.identity, inset = 1, ...options } = {}) {
  let D;
  return {
    fy: {
      transform: (data) =>
        (D = Plot.valueof(data, date, Array)).map((d) => d.getUTCFullYear()),
    },
    x: {
      transform: () => D.map((d) => d3.utcMonday.count(d3.utcYear(d), d)),
    },
    y: { transform: () => D.map((d) => (d.getUTCDay() + 6) % 7) },
    inset,
    ...options,
  };
}

class MonthLine extends Plot.Mark {
  static defaults = { stroke: "currentColor", strokeWidth: 1 };
  constructor(data, options = {}) {
    const { x, y } = options;
    super(
      data,
      { x: { value: x, scale: "x" }, y: { value: y, scale: "y" } },
      options,
      MonthLine.defaults
    );
  }
  render(index, { x, y }, { x: X, y: Y }, dimensions) {
    const { marginTop, marginBottom, height } = dimensions;
    const dx = x.bandwidth(),
      dy = y.bandwidth();
    return htl.svg`<path fill=none stroke=${this.stroke} stroke-width=${
      this.strokeWidth
    } d=${Array.from(
      index,
      (i) =>
        `${
          Y[i] > marginTop + dy * 1.5 // is the first day a Monday?
            ? `M${X[i] + dx},${marginTop}V${Y[i]}h${-dx}`
            : `M${X[i]},${marginTop}`
        }V${height - marginBottom}`
    ).join("")}>`;
  }
}

function CalendarSettings() {
  const statsContext = useContext(StatsContext);

  return (
    <CustomSelect
      key="value"
      propName="value"
      value={statsContext.calendar.value}
      name="Value"
      options={calendarSettings.values}
      setState={statsContext.setCalendar}
    />
  );
}

function CalendarPlot({ width, height, legendRef }) {
  const statsContext = useContext(StatsContext);
  const figureRef = useRef(null);

  const start = d3.min(statsContext.calendar.dayTotals, (d) => d.date); // exclusive
  const end = d3.utcDay.offset(
    d3.max(statsContext.calendar.dayTotals, (d) => d.date)
  );

  const widthPlot = 1200;

  useEffect(() => {
    if (!statsContext.calendar.loaded) return;
    const plot = Plot.plot({
      style: { maxWidth: "1200px" },
      marginRight: 0,
      width: widthPlot,
      height: (d3.utcYear.count(start, end) * widthPlot) / 7.2,
      axis: null,
      padding: 0,
      x: {
        domain: d3.range(54),
      },
      y: {
        axis: "left",
        domain: [-1, 0, 1, 2, 3, 4, 5, 6], // hide 0 and 6 (weekends); use -1 for labels
        ticks: [0, 1, 2, 3, 4, 5, 6], // don’t draw a tick for -1
        tickSize: 0,
        tickFormat: (day) => Plot.formatWeekday()((day + 1) % 7),
      },
      fy: {
        padding: 0.1,
        reverse: true,
      },
      color: {
        scheme: "reds",
        type: "sqrt",
      },
      marks: [
        Plot.text(
          d3.utcYears(d3.utcYear(start), end),
          calendar({
            text: d3.utcFormat("%Y"),
            frameAnchor: "right",
            x: 0,
            y: -1,
            dx: -20,
          })
        ),

        Plot.text(
          d3.utcMonths(d3.utcMonth(start), end).map(d3.utcMonday.ceil),
          calendar({
            text: d3.utcFormat("%b"),
            frameAnchor: "left",
            y: -1,
            dx: -5,
          })
        ),
        new MonthLine(
          d3.utcMonths(d3.utcMonth(start), end),
          calendar({ stroke: "gray", strokeWidth: 1 })
        ),
        Plot.cell(
          statsContext.calendar.dayTotals,
          calendar({
            date: "date",
            fill: "value",
            channels: {
              title: (d) =>
                `${d.date.toDateString()}\n\n${
                  statsContext.calendar.activitiesByDate
                    .get(d.date)
                    .map(
                      (a) =>
                        a.name +
                        ": " +
                        statsContext.calendar.value.format(
                          statsContext.calendar.value.fun(a)
                        )
                    )
                    ?.join("\n") ?? ""
                }`,
            },
            opacity: 0.5,
            tip: {
              fontSize: 12,
            },
          })
        ),

        Plot.text(
          d3.utcDays(start, end),
          calendar({ text: d3.utcFormat("%-d") })
        ),
      ],
    });
    Object.assign(plot, {
      style: `width: 1200px; overflow: scroll; margin: 0;`,
    });
    const legend = plot.legend("color", {
      ticks: 3,
      tickFormat: statsContext.calendar.value.format,
      label: statsContext.calendar.value.label,
      width: 300,
      marginLeft: 20,
      marginBottom: 30,
      marginTop: 10,
    });
    figureRef.current.append(plot);
    legendRef.current.append(legend);
    return () => {
      plot.remove();
      legend.remove();
    };
  }, [statsContext.calendar]);

  return (
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
  );
}

export default function Calendar({ settingsOpen }) {
  const legendRef = useRef(null);

  return (
    <LegendPlot
      settingsOpen={settingsOpen}
      settings={<CalendarSettings />}
      plot={<CalendarPlot legendRef={legendRef} />}
      legendRef={legendRef}
    />
  );
}
