import React, { useContext, useRef, useMemo, useState } from "react";
import { Box } from "@mui/material";
import * as d3t from "d3-time";
import * as d3 from "d3-array";

import * as Plot from "@observablehq/plot";
import PlotFigure from "./../PlotFigure.jsx";
//import "./styles.css";
import { TitleBox, useDimensions } from "../StatsUtilities.jsx";

import { StatsContext } from "../../contexts/StatsContext.jsx";

export default function Test() {
  const statsContext = useContext(StatsContext);
  const ref = useRef(null);
  const { width, height } = useDimensions(ref);

  return (
    statsContext.calendar.loaded && (
      <Box
        sx={{
          height: 200,
          width: "100%",
          position: "relative",
          borderRadius: "20px",
        }}
        ref={ref}
      >
        <PlotFigure
          options={{
            padding: 0,
            x: { axis: null },
            y: { tickFormat: Plot.formatWeekday("en", "narrow"), tickSize: 0 },
            fy: { tickFormat: "" },
            color: {
              scheme: "reds",
              type: "sqrt",
              legend: true,
              label: statsContext.calendar.value.label,
              tickFormat: statsContext.calendar.value.format,
              ticks: 3,
              width: 400,
            },
            marks: [
              Plot.cell(statsContext.calendar.dayTotals, {
                x: (d) => d3t.utcWeek.count(d3t.utcYear(d.date), d.date),
                y: (d) => (d.date.getUTCDay() + 1) % 7,
                fy: (d) => d.date.getUTCFullYear(),
                fill: (d) => d.value,
                inset: 0.5,
                channels: {
                  Date: (d) => d.date.toDateString(),
                  Activities: (d) =>
                    statsContext.calendar.activitiesByDate
                      .get(d.date)
                      .map((d) => d.name)
                      .join(",\n"),
                },
                tip: {
                  format: {
                    fill: statsContext.calendar.value.format,
                    x: null,
                    y: null,
                    fx: null,
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
