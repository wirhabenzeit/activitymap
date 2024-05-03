"use client";
import React, {useEffect, useContext, useRef} from "react";
import {StatsContext} from "../layout";
import {createPortal} from "react-dom";
import * as d3 from "d3";
import {Box} from "@mui/material";
import * as Plot from "@observablehq/plot";

import {CustomSelect} from "~/app/stats/ChartHelpers";
import {calendarSettings} from "~/settings/stats";
import * as htl from "htl";
import {useStore} from "~/contexts/Zustand";

function makeCalendar({
  date = Plot.identity,
  inset = 1.5,
  ...options
} = {}) {
  let D;
  return {
    fy: {
      transform: (data) =>
        (D = Plot.valueof(data, date, Array)).map((d) =>
          d.getUTCFullYear()
        ),
    },
    x: {
      transform: () =>
        D.map((d) => d3.utcMonday.count(d3.utcYear(d), d)),
    },
    y: {
      transform: () =>
        D.map((d) => (d.getUTCDay() + 6) % 7),
    },
    inset,
    ...options,
  };
}

class MonthLine extends Plot.Mark {
  static defaults = {
    stroke: "black",
    strokeWidth: 1,
  };
  constructor(data, options = {}) {
    const {x, y} = options;
    super(
      data,
      {
        x: {value: x, scale: "x"},
        y: {value: y, scale: "y"},
      },
      options,
      MonthLine.defaults
    );
  }
  render(index, {x, y}, {x: X, y: Y}, dimensions) {
    const {marginTop, marginBottom, height} = dimensions;
    const dx = x.bandwidth(),
      dy = y.bandwidth();
    return htl.svg`<path opacity=${
      this.opacity
    } fill=none stroke=${
      this.stroke
    } stroke-width=1 d=${Array.from(
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
  const activitiesByDate = d3.group(activities, (f) =>
    d3.utcDay(new Date(f.start_date_local))
  );

  const dayTotals = d3.map(
    d3.rollup(
      activities,
      (v) => calendar.value.reducer(v, calendar.value.fun),
      (d) => d3.utcDay(new Date(d.start_date_local))
    ),
    ([key, value]) => ({date: key, value})
  );

  const start = d3.min(dayTotals, (d) => d.date);

  const end = d3.utcDay.offset(
    d3.max(dayTotals, (d) => d.date)
  );
  return {activitiesByDate, dayTotals, start, end};
};

export default function CalendarPlot() {
  const {width, height, settingsRef} =
    useContext(StatsContext);

  const {
    loaded,
    filterIDs,
    activityDict,
    calendar,
    setCalendar,
  } = useStore((state) => ({
    loaded: state.loaded,
    filterIDs: state.filterIDs,
    activityDict: state.activityDict,
    calendar: state.calendar,
    setCalendar: state.setCalendar,
  }));

  const data = filterIDs.map((id) => activityDict[id]);
  const figureRef = useRef(null);
  const widthPlot = 1000;

  useEffect(() => {
    if (!loaded) return;

    const {activitiesByDate, dayTotals, start, end} =
      computeCalendar(data, calendar);

    const heightPlot =
      start == undefined || end == undefined
        ? 800
        : ((end.getFullYear() - start.getFullYear() + 1) *
            widthPlot) /
          5.8;

    const plot = Plot.plot({
      style: {maxWidth: "1100px"},
      marginRight: 0,
      width: widthPlot,
      height: heightPlot,
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
        tickFormat: (day) =>
          Plot.formatWeekday()((day + 1) % 7),
      },
      fy: {
        padding: 0.1,
        reverse: true,
      },
      color: calendar.value.color,
      marks: [
        Plot.text(
          d3.utcYears(d3.utcYear(start), end),
          makeCalendar({
            text: d3.utcFormat("%Y"),
            frameAnchor: "right",
            x: 0,
            y: -1,
            dx: -20,
          })
        ),

        Plot.text(
          d3
            .utcMonths(d3.utcMonth(start), end)
            .map(d3.utcMonday.ceil),
          makeCalendar({
            text: d3.utcFormat("%b"),
            frameAnchor: "left",
            y: -1,
            dx: -5,
          })
        ),
        new MonthLine(
          d3.utcMonths(d3.utcMonth(start), end),
          makeCalendar({opacity: 0.3, strokeWidth: 1})
        ),
        Plot.cell(
          dayTotals,
          makeCalendar({
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
                        (calendar.value.format == null
                          ? ""
                          : ": " +
                            calendar.value.format(
                              calendar.value.fun(a)
                            ))
                    )
                    ?.join("\n") ?? ""
                }`,
            },
            opacity: 0.5,
            tip: {
              fontSize: 12,
            },
            rx: 2,
          })
        ),

        Plot.text(
          d3.utcDays(start, end),
          makeCalendar({text: d3.utcFormat("%-d")})
        ),
      ],
    });
    Object.assign(plot, {
      style: `width: 1200px; overflow: scroll; margin: 0;`,
    });
    const legend = plot.legend("color", {
      ...calendar.value.color,
      tickFormat: calendar.value.format,
      label: calendar.value.label,
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
  }, [calendar, data]);

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
            value={calendar.value}
            name="Value"
            options={calendarSettings.values}
            setState={setCalendar}
          />,
          settingsRef.current
        )}
    </>
  );
}
