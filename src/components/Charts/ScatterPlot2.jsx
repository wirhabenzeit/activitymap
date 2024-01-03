import React, { useContext, useRef } from "react";
import * as d3 from "d3-array";
import { Typography, Box } from "@mui/material";
import * as Plot from "@observablehq/plot";
import PlotFigure from "./../PlotFigure.jsx";
import { TitleBox, useDimensions, CustomSelect } from "../StatsUtilities.jsx";
import { scatterSettings } from "../../settings";

import { StatsContext } from "../../contexts/StatsContext.jsx";

export default function Test() {
  const statsContext = useContext(StatsContext);
  const ref = useRef(null);
  const { width, height } = useDimensions(ref);

  return (
    statsContext.loaded &&
    statsContext.data.length > 0 && (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          margin: 0,
          padding: 0,
          borderRadius: 5,
        }}
        ref={ref}
      >
        <TitleBox sx={{ pt: 1, pl: 1 }}>
          <Typography variant="h6" key="heading">
            Scatter
          </Typography>
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
        </TitleBox>
        <PlotFigure
          options={{
            height: height,
            width: width,
            padding: 0,
            marginLeft: 50,
            marginRight: 30,
            x: {
              tickFormat: statsContext.scatter.xValue.format,
            },
            y: {
              tickFormat: statsContext.scatter.yValue.format,
            },
            r: {
              range: [0, 10],
              domain: d3.extent(
                statsContext.data,
                statsContext.scatter.size.fun
              ),
              type: "sqrt",
              legend: true,
            },
            marks: [
              Plot.dot(statsContext.data, {
                x: statsContext.scatter.xValue.fun,
                y: statsContext.scatter.yValue.fun,
                r: statsContext.scatter.size.fun,
                fill: (d) =>
                  statsContext.scatter.group.color(
                    statsContext.scatter.group.fun(d)
                  ),
                fillOpacity: 0.5,
                channels: {
                  name: (d) => d.name,
                },
                tip: {
                  format: {
                    x: statsContext.scatter.xValue.format,
                    y: statsContext.scatter.yValue.format,
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
