"use client";

import React, {useContext, useRef, useEffect} from "react";
import {createPortal} from "react-dom";
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";

import {BarChart, ShowChart} from "@mui/icons-material";

import {
  Slider,
  Box,
  Stack,
  IconButton,
} from "@mui/material";

import {StatsContext} from "../layout";
import {CustomSelect} from "~/app/stats/ChartHelpers";
import {timelineSettings} from "~/settings/stats";
import {useStore} from "~/contexts/Zustand";
import type {Activity} from "~/server/db/schema";

function computeTimeline(activities: Activity[], timeline) {
  const extent = d3.extent(activities, (d) =>
    timeline.timePeriod.tick(new Date(d.start_date_local))
  );

  const groupExtent = Array.from(
    new Set(activities.map(timeline.group.fun))
  );

  const range = timeline.timePeriod.tick.range(
    extent[0],
    timeline.timePeriod.tick.ceil(extent[1])
  );

  const groups = d3.group(
    activities,
    (d) =>
      timeline.timePeriod.tick(
        new Date(d.start_date_local)
      ),
    timeline.group.fun
  );

  const timeMap = d3.map(range, (date) => {
    return groupExtent.map((type) => ({
      date,
      type,
      value:
        groups.get(date)?.get(type) != undefined
          ? d3.sum(
              groups.get(date)?.get(type),
              timeline.value.fun
            )
          : 0,
    }));
  });

  const data = timeMap
    .flat()
    .sort(
      (a, b) =>
        a.start_date_local_timestamp -
        b.start_date_local_timestamp
    );

  const map = new d3.InternMap(
    timeMap.map((arr) => [
      arr[0].date,
      new d3.InternMap(
        arr.map(({value, type}) => [type, value])
      ),
    ])
  );

  return {extent, groupExtent, range, data, map};
}

export default function TimelinePlot() {
  const {width, height, settingsRef} =
    useContext(StatsContext);
  const {timeline, setTimeline, loaded, activityDict} =
    useStore((state) => ({
      timeline: state.timeline,
      setTimeline: state.setTimeline,
      loaded: state.loaded,
      activityDict: state.activityDict,
    }));
  const activities = Object.values(activityDict);

  const [averaging, setAveraging] = React.useState(
    timeline.averaging
  );
  const figureRef = useRef(null);

  useEffect(() => {
    setAveraging(timeline.averaging);
  }, [timeline.averaging]);

  useEffect(() => {
    if (!loaded || activities.length == 0) return;

    const {extent, groupExtent, range, data, map} =
      computeTimeline(activities, timeline);

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
                text: (d) =>
                  timeline.value.format(
                    map.get(d).get(type)
                  ),
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
            text: (d) =>
              d3.timeFormat(timeline.timePeriod.tickFormat)(
                d
              ),
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
            curve: "monotone-x",
            reduce: "mean",
            stroke: (x) => timeline.group.color(x.type),
            channels: {
              Date: (d) =>
                `${d3.timeFormat(
                  timeline.timePeriod.tickFormat
                )(d.date)} ± ${averaging} ${
                  timeline.timePeriod.id
                }s`,
            },
            tip: {
              format: {
                x: null,
                stroke: null,
                z: null,
                y: (x) =>
                  timeline.value.format(x) +
                  timeline.value.unit,
              },
            },
          })
        ),
        Plot.areaY(data, {
          x: "date",
          //x: "type",
          y2: "value",
          y1: 0,
          fill: (x) => timeline.group.color(x.type),
          opacity: 0.1,
          //interval: timeline.timePeriod.tick,
          //transform
          curve: "step",
        }),
      ],
    });

    figureRef.current.append(plot);

    return () => {
      plot.remove();
    };
  }, [
    loaded,
    activityDict,
    timeline,
    width,
    height,
    averaging,
  ]);

  return (
    <>
      <div
        ref={figureRef}
        style={{height: height, width: width}}
      />
      {settingsRef.current &&
        createPortal(
          <>
            <CustomSelect
              key="group"
              propName="group"
              value={timeline.group}
              name="Group"
              options={timelineSettings.groups}
              setState={(x) => setTimeline({group: x})}
            />
            <CustomSelect
              key="value"
              propName="value"
              value={timeline.value}
              name="Y"
              options={timelineSettings.values}
              setState={(x) => setTimeline({value: x})}
            />
            <CustomSelect
              key="yScale"
              propName="yScale"
              value={timeline.yScale}
              name="Scale"
              options={timelineSettings.yScales}
              setState={(x) => setTimeline({yScale: x})}
            />

            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
            >
              <CustomSelect
                key="timePeriod"
                propName="timePeriod"
                value={timeline.timePeriod}
                name="X"
                options={timelineSettings.timePeriods}
                setState={(x) =>
                  setTimeline({timePeriod: x})
                }
              />
              <IconButton
                onClick={() =>
                  setAveraging(
                    timeline.timePeriod.averaging.min
                  )
                }
                disabled={
                  averaging ==
                  timeline.timePeriod.averaging.min
                }
              >
                <BarChart fontSize="small" />
              </IconButton>
              <Box sx={{width: 100}}>
                <Slider
                  disabled={
                    timeline.timePeriod.averaging.min ==
                    timeline.timePeriod.averaging.max
                  }
                  marks={true}
                  min={timeline.timePeriod.averaging.min}
                  max={timeline.timePeriod.averaging.max}
                  size="small"
                  value={averaging}
                  defaultValue={timeline.averaging}
                  onChange={(e, v) => setAveraging(v)}
                  onChangeCommitted={(e, v) => {
                    setTimeline({
                      averaging: v,
                    });
                  }}
                />
              </Box>
              <IconButton
                onClick={() =>
                  setAveraging(
                    timeline.timePeriod.averaging.max
                  )
                }
                disabled={
                  averaging ==
                  timeline.timePeriod.averaging.max
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
