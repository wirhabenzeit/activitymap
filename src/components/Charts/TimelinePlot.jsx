import React, { useContext, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import { BarChart, ShowChart } from "@mui/icons-material";

import { Slider, Box, Stack } from "@mui/material";

import { StatsContext } from "../../contexts/StatsContext.jsx";
import { CustomSelect } from "../StatsUtilities.jsx";
import { timelineSettings } from "../../settings.jsx";

export function TimelinePlot({ width, height, settingsRef }) {
  const statsContext = useContext(StatsContext);
  const [averaging, setAveraging] = React.useState(
    statsContext.timeline.averaging
  );
  const figureRef = useRef(null);
  const timeline = statsContext.timeline;

  useEffect(() => {
    if (!statsContext.timeline.loaded) return;
    const plot = Plot.plot({
      style: {
        fontSize: 12,
      },
      y: {
        tickFormat: timeline.value.format,
        label: `${timeline.value.label} (${timeline.value.unit})`,
        grid: true,
        ticks: 6,
      },
      x: {
        grid: true,
      },
      height: Math.max(height, 100),
      width: Math.max(width, 100),
      marginRight: 50,
      marginLeft: 50,
      marginBottom: 50,
      marginTop: 20,
      marks: [
        Plot.ruleY([0]),
        ...[
          timeline.groupExtent.flatMap((type) => [
            Plot.text(
              timeline.range,
              Plot.pointerX({
                px: (d) => d,
                y: (d) => timeline.map.get(d).get(type),
                dx: 40,
                frameAnchor: "right",
                text: (d) =>
                  timeline.value.format(timeline.map.get(d).get(type)),
                fill: timeline.group.color(type),
                fontSize: 12,
                fontWeight: "bold",
                style: {
                  fontSize: 20,
                  fontWeight: "bold",
                },
              })
            ),
            Plot.dot(
              timeline.range,
              Plot.pointerX({
                x: (d) => d,
                y: (d) => timeline.map.get(d).get(type),
                opacity: 0.5,
                fill: timeline.group.color(type),
              })
            ),
          ]),
        ],
        Plot.ruleX(timeline.range, Plot.pointerX()),
        Plot.text(
          timeline.range,
          Plot.pointerX({
            text: (d) => d3.timeFormat(timeline.timePeriod.tickFormat)(d),
            x: (d) => d,
            frameAnchor: "top",
            dy: -16,
          })
        ),
        Plot.lineY(
          timeline.data,
          Plot.windowY({
            x: "date",
            y: "value",
            k: averaging,
            reduce: "mean",
            stroke: (x) => timeline.group.color(x.type),
            channels: {
              Date: (d) =>
                `${d3.timeFormat(timeline.timePeriod.tickFormat)(d.date)} ± ${
                  averaging - 1
                } ${timeline.timePeriod.id}s`,
            },
            tip: {
              format: {
                x: null,
                stroke: null,
                z: null,
                y: (x) => timeline.value.format(x) + timeline.value.unit,
              },
            },
          })
        ),
        Plot.lineY(timeline.data, {
          x: "date",
          y: "value",
          stroke: (x) => timeline.group.color(x.type),
          opacity: 0.2,
        }),
      ],
    });

    figureRef.current.append(plot);
    return () => {
      plot.remove();
    };
  }, [statsContext.timeline, width, height, averaging]);

  return (
    <>
      <div ref={figureRef} style={{ height: height, width: width }} />
      {settingsRef.current &&
        createPortal(
          <>
            <CustomSelect
              key="group"
              propName="group"
              value={statsContext.timeline.group}
              name="Group"
              options={timelineSettings.groups}
              setState={statsContext.setTimeline}
            />
            <CustomSelect
              key="value"
              propName="value"
              value={statsContext.timeline.value}
              name="Y"
              options={timelineSettings.values}
              setState={statsContext.setTimeline}
            />
            <CustomSelect
              key="timePeriod"
              propName="timePeriod"
              value={statsContext.timeline.timePeriod}
              name="X"
              options={timelineSettings.timePeriods}
              setState={statsContext.setTimeline}
            />

            <Box sx={{ width: 150 }}>
              <Stack direction="row" spacing={1}>
                <BarChart fontSize="small" />
                <Slider
                  marks={false}
                  min={1}
                  max={30}
                  size="small"
                  value={averaging}
                  defaultValue={statsContext.timeline.averaging}
                  onChange={(e, v) => setAveraging(v)}
                  onChangeCommitted={(e, v) => {
                    statsContext.setTimeline({
                      averaging: v,
                    });
                  }}
                />
                <ShowChart fontSize="small" />
              </Stack>
            </Box>
          </>,
          settingsRef.current
        )}
    </>
  );
}
