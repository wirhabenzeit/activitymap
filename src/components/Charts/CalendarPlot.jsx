import React, { useContext, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import { Box } from "@mui/material";
import * as Plot from "@observablehq/plot";

import { CustomSelect } from "../Stats.jsx";
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

const computeCalendar = (activities, calendar) => {
  const activitiesByDate = d3.group(activities, (f) => d3.utcDay(f.date));

  const dayTotals = d3.map(
    d3.rollup(
      activities,
      (v) => d3.sum(v, calendar.value.fun),
      (d) => d3.utcDay(d.date)
    ),
    ([key, value]) => ({ date: key, value })
  );

  const start = d3.min(dayTotals, (d) => d.date);

  const end = d3.utcDay.offset(d3.max(dayTotals, (d) => d.date));

  return { activitiesByDate, dayTotals, start, end };
};

export default function CalendarPlot({ width, height, settingsRef }) {
  const statsContext = useContext(StatsContext);
  const figureRef = useRef(null);

  const widthPlot = 1200;

  useEffect(() => {
    if (!statsContext.loaded) return;

    const { activitiesByDate, dayTotals, start, end } = computeCalendar(
      statsContext.data,
      statsContext.calendar
    );

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
        domain: [-1, 0, 1, 2, 3, 4, 5, 6],
        ticks: [0, 1, 2, 3, 4, 5, 6],
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
          dayTotals,
          calendar({
            date: "date",
            fill: "value",
            channels: {
              title: (d) =>
                `${d.date.toDateString()}\n\n${
                  activitiesByDate
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
      height: 40,
      marginLeft: 10,
      marginRight: 10,
      marginBottom: 20,
      marginTop: 15,
    });
    Object.assign(legend, {
      style: `height: 40px; overflow: scroll; min-width: 300px; margin: 0px;`,
    });
    figureRef.current.append(plot);
    settingsRef.current.append(legend);
    return () => {
      plot.remove();
      legend.remove();
    };
  }, [statsContext.calendar, statsContext.data]);

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
          <CustomSelect
            key="value"
            propName="value"
            value={statsContext.calendar.value}
            name="Value"
            options={calendarSettings.values}
            setState={statsContext.setCalendar}
          />,
          settingsRef.current
        )}
    </>
  );
}
