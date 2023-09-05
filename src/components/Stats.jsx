// install (please try to align the version of installed @nivo packages)
// yarn add @nivo/bump
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveLine } from "@nivo/line";
import { ResponsiveTimeRange } from "@nivo/calendar";
import React, {
  useContext,
  cloneElement,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import {
  scaleLinear,
  scaleLog,
  scaleSqrt,
  scaleOrdinal,
  scaleBand,
  scaleTime,
} from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
//import { ViolinPlot, BoxPlot } from "@visx/stats";
import { PatternLines } from "@visx/pattern";
import {
  LinearGradient,
  GradientTealBlue,
  GradientOrangeRed,
} from "@visx/gradient";
import { Circle, LinePath, AreaClosed, AreaStack } from "@visx/shape";
import { Group } from "@visx/group";
import { Axis, AxisLeft } from "@visx/axis";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { GridColumns, GridRows } from "@visx/grid";
import { GlyphStar } from "@visx/glyph";
import {
  AnimatedAxis,
  AnimatedGridRows,
  AnimatedGridColumns,
} from "@visx/react-spring";
import {
  Annotation,
  HtmlLabel,
  Label,
  Connector,
  CircleSubject,
  LineSubject,
} from "@visx/annotation";
import { useTooltip, TooltipWithBounds, withTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { voronoi } from "@visx/voronoi";
import { Brush } from "@visx/brush";
import BaseBrush, {
  BaseBrushState,
  UpdateBrush,
} from "@visx/brush/lib/BaseBrush";

import { StatsContext } from "../contexts/StatsContext";
import { ActivityContext } from "../contexts/ActivityContext";
import { SelectionContext } from "../contexts/SelectionContext";

function addAlpha(color, opacity) {
  const _opacity = Math.round(Math.min(Math.max(opacity || 1, 0), 1) * 255);
  return color + _opacity.toString(16).toUpperCase();
}
import {
  ListSubheader,
  Paper,
  ButtonGroup,
  Button,
  Skeleton,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Box,
  Unstable_Grid2 as Grid,
  Chip,
  Typography,
  Slider as MuiSlider,
} from "@mui/material";
import {
  useTheme,
  styled,
  ThemeProvider,
  createTheme,
} from "@mui/material/styles";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

import {
  calendarSettings,
  pieSettings,
  timelineSettings,
  scatterSettings,
  mapStatSettings,
  boxSettings,
  violinSettings,
  timelineSettingsVisx,
} from "../settings";

import {
  TitleBox,
  CustomSelect,
  CustomPicker,
  symmetricDifference,
  ChipTooltip,
  IconTooltip,
} from "./StatsUtilities.jsx";

import ViolinPlot from "./Charts/ViolinPlot.jsx";
import TimelinePlot from "./Charts/TimelinePlot.jsx";

import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3sc from "d3-scale-chromatic";
import * as d3s from "d3-scale";
import { ThemeContext } from "@emotion/react";

function YearlySummary() {
  const statsContext = useContext(StatsContext);
  const theme = useTheme();

  const lineDict = d3.rollup(
    statsContext.timeline.data,
    (v) => v[0],
    (d) => d.id
  );
  const groups = timelineSettings.groups;
  const timePeriods = timelineSettings.timePeriods;
  const timeGroups = timelineSettings.timeGroups;
  const values = timelineSettings.values;
  const stats = timelineSettings.stats(statsContext.timeline);
  const years =
    statsContext.data && statsContext.data.length > 0
      ? d3.extent(statsContext.data, (d) => d.date).map((d) => d.getFullYear())
      : [undefined, undefined];

  const LineTooltip = ({ point }) => {
    const lineProps = lineDict.get(point.serieId);
    return (
      <ChipTooltip
        color={lineProps.color}
        icon={lineProps.icon}
        textRight={lineProps.yLabel(point.data.yFormatted)}
        textLeft={lineProps.xLabel(point.data.xFormatted)}
      />
    );
  };

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="heading">
          Timeline
        </Typography>
        <CustomSelect
          key="timePeriod"
          propName="timePeriod"
          value={statsContext.timeline.timePeriod}
          name="Axis"
          options={timePeriods}
          setState={statsContext.setTimeline}
          headers={[
            { title: "Absolute", filter: (opt) => !opt.relative },
            { title: "Relative", filter: (opt) => opt.relative },
          ]}
        />
        <CustomSelect
          key="group"
          propName="group"
          value={statsContext.timeline.group}
          name="Sport"
          options={groups}
          setState={statsContext.setTimeline}
        />
        <CustomPicker
          key="timeGroup"
          propName="timeGroup"
          options={timeGroups}
          value={statsContext.timeline.timeGroup}
          range={years}
          disabled={!statsContext.timeline.timePeriod.relative}
          setState={statsContext.setTimeline}
        />
        <CustomSelect
          key="stat"
          propName="stat"
          value={statsContext.timeline.stat}
          name="Stat"
          options={stats}
          setState={statsContext.setTimeline}
        />
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.timeline.value}
          name="Value"
          options={values}
          setState={statsContext.setTimeline}
          disabled={["count", "cumCount"].includes(
            statsContext.timeline.stat.id
          )}
        />
      </TitleBox>
      {!statsContext.timeline.loaded && (
        <Skeleton
          variant="rounded"
          width="90%"
          height="80%"
          sx={{ margin: "auto" }}
        />
      )}
      {statsContext.timeline.loaded && (
        <ResponsiveLine
          animate
          margin={{ top: 10, right: 20, bottom: 100, left: 40 }}
          curve="monotoneX"
          useMesh={true}
          isInteractive={true}
          data={statsContext.timeline.data}
          tooltip={({ point }) => <LineTooltip point={point} />}
          enablePoints={statsContext.timeline.timePeriod.enablePoints}
          yFormat={statsContext.timeline.stat.format}
          xScale={{
            type: "time",
            format: "%Y-%m-%d",
            useUTC: false,
            precision: "day",
          }}
          xFormat="time:%Y-%m-%d"
          axisBottom={{
            tickPadding: 5,
            tickRotation: 0,
            format: statsContext.timeline.timePeriod.format,
            tickValues: 6,
          }}
          axisLeft={{
            tickPadding: 5,
            tickRotation: 0,
            legend: statsContext.timeline.stat.unit,
            format: statsContext.timeline.stat.format,
            tickValues: 5,
          }}
          colors={(d) => addAlpha(d.color, lineDict.get(d.id).alpha)}
          onClick={(d) => lineDict.get(d.serieId).onClick()}
        />
      )}
    </>
  );
}

const ActivityCalendar = () => {
  const statsContext = useContext(StatsContext);
  const values = calendarSettings.values;
  const theme = useTheme();

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="heading">
          Calendar
        </Typography>
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.calendar.value}
          name="Value"
          options={values}
          setState={statsContext.setCalendar}
        />
      </TitleBox>
      {statsContext.calendar.data && statsContext.calendar.data.length > 0 && (
        <Box
          sx={{
            height: 140,
            width: 1,
            overflowX: "auto",
            overflowY: "hidden",
            whiteSpace: "noWrap",
          }}
        >
          <ResponsiveTimeRange
            margin={{ top: 40, right: 10, bottom: 10, left: 30 }}
            data={statsContext.calendar.data}
            from={statsContext.calendar.extent[0].toISOString().slice(0, 10)}
            to={statsContext.calendar.extent[1].toISOString().slice(0, 10)}
            emptyColor="#eeeeee"
            colorScale={statsContext.calendar.colorScaleFn([
              "#eeeeee",
              "#61cdbb",
              "#97e3d5",
              "#e8c1a0",
              "#f47560",
              "#000000",
            ])}
            width={
              d3t.timeDay.count(...statsContext.calendar.extent) * 1.8 + 100
            }
            yearSpacing={40}
            dayRadius={4}
            weekdayTicks={[0, 2, 4, 6]}
            monthLegend={(year, month, date) =>
              date.getMonth() % 3 == 0 ? d3tf.timeFormat("%b %Y")(date) : ""
            }
            monthBorderColor="#ffffff"
            dayBorderWidth={2}
            dayBorderColor="#ffffff"
            onClick={statsContext.calendar.onClick}
            tooltip={({ day, color, value }) => (
              <ChipTooltip
                color={color}
                icon="calendar-days"
                textRight={
                  value !== "selected"
                    ? statsContext.calendar.value.format(value)
                    : statsContext.calendar.activitiesByDate
                        .get(day)
                        .map((act) => act.name)
                        .join(", ")
                }
                textLeft={d3tf.timeFormat("%a, %b %d")(new Date(day))}
              />
            )}
          />
        </Box>
      )}
    </>
  );
};

const ScatterVisx = withTooltip(
  ({
    width,
    height,
    hideTooltip,
    showTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
  }) => {
    const statsContext = useContext(StatsContext);
    const selectionContext = useContext(SelectionContext);
    const values = scatterSettings.values;
    const data = statsContext.data;

    const svgRef = useRef(null);
    const margin = useMemo(
      () => ({ top: 30, left: 60, right: 30, bottom: 90 }),
      []
    );
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const color = (d) =>
      statsContext.scatter.group.color(statsContext.scatter.group.fun(d));

    const xScale = useMemo(
      () =>
        scaleLinear({
          range: [margin.left, innerWidth + margin.left],
          domain: d3.extent(data, statsContext.scatter.xValue.fun),
        }),
      [data, statsContext.scatter.xValue, width]
    );

    const yScale = useMemo(
      () =>
        scaleLinear({
          range: [innerHeight + margin.top, margin.top],
          domain: d3.extent(data, statsContext.scatter.yValue.fun),
          nice: true,
        }),
      [data, statsContext.scatter.yValue, height]
    );

    const rScale = useMemo(
      () =>
        scaleSqrt({
          range: [0, 5],
          domain: d3.extent(data, statsContext.scatter.size.fun),
        }),
      [data, statsContext.scatter.size]
    );

    const colorScale = useMemo(
      () =>
        scaleOrdinal({
          range: [...new Set(data.map(color))],
          domain: [...new Set(data.map(color))],
        }),
      [data]
    );

    const voronoiLayout = useMemo(
      () =>
        voronoi({
          x: (d) => xScale(statsContext.scatter.xValue.fun(d)) ?? 0,
          y: (d) => yScale(statsContext.scatter.yValue.fun(d)) ?? 0,
          width,
          height,
        })(data),
      [data, width, height, xScale, yScale]
    );

    let tooltipTimeout;

    const handleMouseMove = useCallback(
      (event) => {
        if (tooltipTimeout) clearTimeout(tooltipTimeout);
        if (!svgRef.current) return;

        const point = localPoint(svgRef.current, event);
        if (!point) return;
        const neighborRadius = 100;
        const closest = voronoiLayout.find(point.x, point.y, neighborRadius);
        if (closest) {
          showTooltip({
            tooltipLeft: xScale(statsContext.scatter.xValue.fun(closest.data)),
            tooltipTop: yScale(statsContext.scatter.yValue.fun(closest.data)),
            tooltipData: closest.data,
          });
        }
      },
      [xScale, yScale, showTooltip, voronoiLayout]
    );

    const handleMouseLeave = useCallback(() => {
      tooltipTimeout = window.setTimeout(() => {
        hideTooltip();
      }, 300);
    }, [hideTooltip]);

    const handleClick = useCallback(
      (event) => {
        if (!svgRef.current) return;

        if (tooltipData) {
          if (event.metaKey)
            selectionContext.setSelected((selected) => {
              return symmetricDifference(selected, [tooltipData.id]);
            });
          else selectionContext.setSelected([tooltipData.id]);
        }
      },
      [tooltipData]
    );

    return (
      <>
        <TitleBox>
          <Typography variant="h6" key="heading">
            Scatter
          </Typography>
          <CustomSelect
            key="xValue"
            propName="xValue"
            value={statsContext.scatter.xValue}
            name="X"
            options={values}
            setState={statsContext.setScatter}
          />
          <CustomSelect
            key="yValue"
            propName="yValue"
            value={statsContext.scatter.yValue}
            name="Y"
            options={values}
            setState={statsContext.setScatter}
          />
          <CustomSelect
            key="size"
            propName="size"
            value={statsContext.scatter.size}
            name="Size"
            options={values}
            setState={statsContext.setScatter}
          />
        </TitleBox>
        {statsContext.loaded && statsContext.data.length > 0 && (
          <svg width="100%" height="100%" ref={svgRef} position="relative">
            <rect
              x={margin.left}
              y={margin.top}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseLeave}
              onClick={handleClick}
            />
            <AxisLeft
              scale={yScale}
              left={margin.left}
              numTicks={5}
              tickFormat={statsContext.scatter.yValue.formatAxis}
            />
            <AnimatedAxis
              orientation="bottom"
              scale={xScale}
              top={innerHeight + margin.top}
              tickFormat={statsContext.scatter.xValue.formatAxis}
              numTicks={4}
            />
            <AnimatedGridColumns
              top={margin.top}
              scale={xScale}
              height={innerHeight}
              strokeOpacity={0.1}
              stroke="#000"
              pointerEvents="none"
              numTicks={5}
            />
            <AnimatedGridRows
              left={margin.left}
              scale={yScale}
              width={innerWidth}
              strokeOpacity={0.1}
              stroke="#000"
              pointerEvents="none"
              numTicks={5}
            />
            <Group pointerEvents="none">
              {data.map((point, i) => (
                <g key={i}>
                  <Circle
                    cx={xScale(statsContext.scatter.xValue.fun(point))}
                    cy={yScale(statsContext.scatter.yValue.fun(point))}
                    r={
                      rScale(statsContext.scatter.size.fun(point)) *
                      (tooltipData === point ? 1.5 : 1)
                    }
                    fill={colorScale(color(point))}
                    fillOpacity={tooltipData === point ? 1 : 0.8}
                    stroke={
                      selectionContext.selected.includes(point.id)
                        ? "black"
                        : colorScale(color(point))
                    }
                  />
                  {selectionContext.selected.includes(point.id) && (
                    <Annotation
                      x={xScale(statsContext.scatter.xValue.fun(point))}
                      y={yScale(statsContext.scatter.yValue.fun(point))}
                      dx={-20}
                      dy={-5}
                    >
                      <Connector />
                      <HtmlLabel
                        showAnchorLine={false}
                        containerStyle={{
                          fontSize: "8pt",
                          width: "200px",
                          height: "28px",
                          padding: "2px",
                          textAlign: "right",
                        }}
                        verticalAnchor="middle"
                      >
                        <span>{point.name}</span>
                      </HtmlLabel>
                    </Annotation>
                  )}
                </g>
              ))}
            </Group>
          </svg>
        )}
        {tooltipOpen &&
          tooltipData &&
          tooltipLeft != null &&
          tooltipTop != null && (
            <IconTooltip
              left={tooltipLeft}
              top={tooltipTop}
              color={color(tooltipData)}
              textLeft=""
              textRight={tooltipData.name}
            />
          )}
      </>
    );
  }
);

const TypePie = () => {
  const statsContext = useContext(StatsContext);
  const values = pieSettings.values;
  const groups = pieSettings.groups;
  const timeGroups = pieSettings.timeGroups;

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="title">
          Sport
        </Typography>
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.pie.value}
          name="Value"
          options={values}
          setState={statsContext.setPie}
        />
        <CustomSelect
          key="group"
          propName="group"
          value={statsContext.pie.group}
          name="Sport"
          options={groups}
          setState={statsContext.setPie}
        />
        <CustomPicker
          key="timeGroup"
          propName="timeGroup"
          options={timeGroups}
          value={statsContext.pie.timeGroup}
          range={[2014, 2023]}
          setState={statsContext.setPie}
        />
      </TitleBox>
      {!statsContext.pie.loaded && (
        <Skeleton
          variant="rounded"
          width="90%"
          height="80%"
          sx={{ margin: "auto" }}
        />
      )}
      {statsContext.pie.loaded && (
        <ResponsivePie
          data={statsContext.pie.data}
          margin={{ top: 40, right: 120, bottom: 100, left: 120 }}
          innerRadius={0.6}
          padAngle={0.7}
          cornerRadius={5}
          activeOuterRadiusOffset={8}
          borderWidth={0}
          arcLinkLabelsSkipAngle={10}
          arcLinkLabelsThickness={2}
          arcLinkLabelsColor={{ from: "color" }}
          arcLabelsSkipAngle={20}
          tooltip={({ datum }) => (
            <ChipTooltip
              color={datum.color}
              textRight={datum.formattedValue}
              textLeft={datum.label}
              icon="hiking"
            />
          )}
          colors={(d) => d.data.color}
          valueFormat={statsContext.pie.value.format}
        />
      )}
    </>
  );
};

export default function StatsView() {
  return (
    <Grid container>
      <Grid xs={12} lg={8}>
        <Paper sx={{ height: 400 }}>
          <YearlySummary />
        </Paper>
      </Grid>
      <Grid xs={12} lg={4}>
        <Paper sx={{ height: 400 }}>
          <TypePie />
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Paper sx={{ height: 400, width: "100%", position: "relative" }}>
          <ParentSize>
            {({ width, height }) => (
              <ThemeProvider theme={darkTheme}>
                <TimelinePlot width={width} height={height} />
              </ThemeProvider>
            )}
          </ParentSize>
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Paper sx={{ height: 200 }}>
          <ActivityCalendar />
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Paper sx={{ height: 400, width: "100%", position: "relative" }}>
          <ParentSize>
            {({ width, height }) => (
              <ScatterVisx width={width} height={height} />
            )}
          </ParentSize>
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Box sx={{ height: "400px", width: "100%", position: "relative" }}>
          <ParentSize>
            {({ width, height }) => (
              <ViolinPlot width={width} height={height} />
            )}
          </ParentSize>
        </Box>
      </Grid>
    </Grid>
  );
}
