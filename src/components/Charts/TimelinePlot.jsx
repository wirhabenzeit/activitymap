import React, { useContext, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import { BarChart, ShowChart } from "@mui/icons-material";

import { Slider, Box, Stack, IconButton } from "@mui/material";

import { StatsContext } from "../../contexts/StatsContext.jsx";
import { CustomSelect } from "../StatsUtilities.jsx";
import { timelineSettings } from "../../settings.jsx";
import { a } from "@react-spring/web";

export function TimelinePlot({ width, height, settingsRef }) {
  const statsContext = useContext(StatsContext);
  const [averaging, setAveraging] = React.useState(
    statsContext.timeline.averaging
  );
  const figureRef = useRef(null);
  const timeline = statsContext.timeline;

  useEffect(() => {
    setAveraging(statsContext.timeline.averaging);
  }, [statsContext.timeline.averaging]);

  useEffect(() => {
    if (!statsContext.loaded || statsContext.data.length == 0) return;

    const extent = d3.extent(statsContext.data, (d) =>
      timeline.timePeriod.tick(d.date)
    );

    const groupExtent = Array.from(
      new Set(statsContext.data.map(timeline.group.fun))
    );

    const range = timeline.timePeriod.tick.range(
      extent[0],
      timeline.timePeriod.tick.ceil(extent[1])
    );

    const groups = d3.group(
      statsContext.data,
      (d) => timeline.timePeriod.tick(d.date),
      timeline.group.fun
    );

    const timeMap = d3.map(range, (date) => {
      return groupExtent.map((type) => ({
        date,
        type,
        value:
          groups.get(date)?.get(type) != undefined
            ? d3.sum(groups.get(date)?.get(type), timeline.value.fun)
            : 0,
      }));
    });

    const data = timeMap.flat().sort((a, b) => a.date - b.date);

    const map = new d3.InternMap(
      timeMap.map((arr) => [
        arr[0].date,
        new d3.InternMap(arr.map(({ value, type }) => [type, value])),
      ])
    );

    const plot = Plot.plot({
      grid: true,
      style: {
        fontSize: 14,
      },
      y: {
        tickFormat: timeline.value.format,
        label: `${timeline.value.label} (${timeline.value.unit})`,
        ticks: 6,
        ...timeline.yScale.prop,
      },
      x: {},
      height: Math.max(height, 100),
      width: Math.max(width, 100),
      marginRight: 50,
      marginLeft: 50,
      marginBottom: 50,
      marginTop: 20,
      marks: [
        Plot.frame(),
        Plot.ruleY([0]),
        ...[
          groupExtent.flatMap((type) => [
            Plot.text(
              range,
              Plot.pointerX({
                px: (d) => d,
                y: (d) => map.get(d).get(type),
                dx: 40,
                frameAnchor: "right",
                text: (d) => timeline.value.format(map.get(d).get(type)),
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
              range,
              Plot.pointerX({
                x: (d) => d,
                y: (d) => map.get(d).get(type),
                opacity: 0.5,
                fill: timeline.group.color(type),
              })
            ),
          ]),
        ],
        Plot.ruleX(range, Plot.pointerX()),
        Plot.text(
          range,
          Plot.pointerX({
            text: (d) => d3.timeFormat(timeline.timePeriod.tickFormat)(d),
            x: (d) => d,
            frameAnchor: "top",
            dy: -16,
          })
        ),
        Plot.lineY(
          data,
          Plot.windowY({
            x: "date",
            y: "value",
            k: averaging + 1,
            reduce: "mean",
            stroke: (x) => timeline.group.color(x.type),
            channels: {
              Date: (d) =>
                `${d3.timeFormat(timeline.timePeriod.tickFormat)(
                  d.date
                )} ± ${averaging} ${timeline.timePeriod.id}s`,
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
        Plot.lineY(data, {
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
  }, [
    statsContext.loaded,
    statsContext.data,
    statsContext.timeline,
    width,
    height,
    averaging,
  ]);

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
              key="yScale"
              propName="yScale"
              value={statsContext.timeline.yScale}
              name="Scale"
              options={timelineSettings.yScales}
              setState={statsContext.setTimeline}
            />

            <Stack direction="row" spacing={2} alignItems="center">
              <CustomSelect
                key="timePeriod"
                propName="timePeriod"
                value={statsContext.timeline.timePeriod}
                name="X"
                options={timelineSettings.timePeriods}
                setState={statsContext.setTimeline}
              />
              <IconButton
                onClick={() =>
                  setAveraging(statsContext.timeline.timePeriod.averaging.min)
                }
                disabled={
                  averaging == statsContext.timeline.timePeriod.averaging.min
                }
              >
                <BarChart fontSize="small" />
              </IconButton>
              <Box sx={{ width: 100 }}>
                <Slider
                  disabled={
                    statsContext.timeline.timePeriod.averaging.min ==
                    statsContext.timeline.timePeriod.averaging.max
                  }
                  marks={true}
                  min={statsContext.timeline.timePeriod.averaging.min}
                  max={statsContext.timeline.timePeriod.averaging.max}
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
              </Box>
              <IconButton
                onClick={() =>
                  setAveraging(statsContext.timeline.timePeriod.averaging.max)
                }
                disabled={
                  averaging == statsContext.timeline.timePeriod.averaging.max
                }
              >
                <ShowChart fontSize="small" />
              </IconButton>
            </Stack>
          </>,
          settingsRef.current
        )}
    </>
  );
}
