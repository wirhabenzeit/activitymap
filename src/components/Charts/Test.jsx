import React, { useContext, useRef } from "react";
import * as d3t from "d3-time";
import { Typography, Box } from "@mui/material";
import * as Plot from "@observablehq/plot";
import PlotFigure from "./../PlotFigure.jsx";
import { TitleBox, useDimensions, CustomSelect } from "../StatsUtilities.jsx";
import { calendarSettings } from "../../settings";

import { StatsContext } from "../../contexts/StatsContext.jsx";

export default function Test() {
  const statsContext = useContext(StatsContext);
  const ref = useRef(null);
  const { width, height } = useDimensions(ref);

  return (
    statsContext.calendar.loaded && (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          margin: 0,
          padding: 0,
          overflowY: "scroll",
          borderRadius: 5,
        }}
        ref={ref}
      >
        <TitleBox>
          <Typography variant="h6" key="heading">
            Calendar
          </Typography>
          <CustomSelect
            key="value"
            propName="value"
            value={statsContext.calendar.value}
            name="Value"
            options={calendarSettings.values}
            setState={statsContext.setCalendar}
          />
        </TitleBox>
        <PlotFigure
          options={{
            height:
              ((7 *
                (statsContext.calendar.extent[1].getUTCFullYear() -
                  statsContext.calendar.extent[0].getUTCFullYear() +
                  1)) /
                52) *
              width,
            width: width,
            padding: 0,
            marginLeft: 0,
            marginRight: 40,
            x: { axis: null },
            y: {
              tickFormat: (d) =>
                Plot.formatWeekday("en", "narrow")((d + 1) % 7),
              tickSize: 0,
            },
            fy: { tickFormat: "" },
            color: {
              scheme: "reds",
              type: "sqrt",
              legend: true,
              label: statsContext.calendar.value.label,
              tickFormat: statsContext.calendar.value.format,
              ticks: 3,
              width: width,
            },
            marks: [
              Plot.cell(statsContext.calendar.dayTotals, {
                x: (d) => d3t.utcWeek.count(d3t.utcYear(d.date), d.date),
                y: (d) => d.date.getUTCDay(),
                fy: (d) => d.date.getUTCFullYear(),
                fill: (d) => d.value,
                inset: 1,
                channels: {
                  Date: (d) => d.date.toDateString(),
                  Activities: (d) =>
                    statsContext.calendar.activitiesByDate
                      .get(d.date)
                      .map((d) => d.name)
                      .join("&"),
                },
                tip: {
                  format: {
                    fill: statsContext.calendar.value.format,
                    x: null,
                    y: null,
                    fx: null,
                    fy: null,
                  },
                },
              }),
            ],
          }}
        />
      </Box>
    )
  );
}
