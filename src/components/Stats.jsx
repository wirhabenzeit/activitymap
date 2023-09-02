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

const selectedBrushStyle = {
  fill: `url(#brush_pattern)`,
  stroke: "#1976d2",
};

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
import { LinearGradient, GradientTealBlue } from "@visx/gradient";
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
import { useTheme, styled } from "@mui/material/styles";

const Slider = styled(MuiSlider)(({ theme }) => ({
  "& .MuiSlider-markLabel": {
    //transform: "translateY(0.5rem)",
    fontSize: "0.7rem",
    top: "20px",
  },
  "& .MuiSlider-active": {
    marginBottom: "0px !important",
    marginTop: "20px",
    cursor: "crosshair",
    color: "green",
  },
}));

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

import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3sc from "d3-scale-chromatic";
import * as d3s from "d3-scale";

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

function BrushHandle({ x, height, isBrushActive }) {
  const pathWidth = 8;
  const pathHeight = 15;
  if (!isBrushActive) {
    return null;
  }
  return (
    <Group left={x + pathWidth / 2} top={(height - pathHeight) / 2}>
      <path
        fill="#f2f2f2"
        d="M -4.5 0.5 L 3.5 0.5 L 3.5 15.5 L -4.5 15.5 L -4.5 0.5 M -1.5 4 L -1.5 12 M 0.5 4 L 0.5 12"
        stroke="#999999"
        strokeWidth="1"
        style={{ cursor: "ew-resize" }}
      />
    </Group>
  );
}

const TimelineVisx = withTooltip(
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
    const theme = useTheme();

    const groups = timelineSettingsVisx.groups;
    const values = timelineSettingsVisx.values;
    const stats = timelineSettingsVisx.stats;
    const averages = timelineSettingsVisx.averages;

    const groupNames = statsContext.timelineVisx.groups;
    const data = statsContext.timelineVisx.data;
    const color = statsContext.timelineVisx.group.color;

    const svgRef = useRef(null);
    const brushRef = useRef(null);
    const [filteredData, setFilteredData] = useState(data);

    const getCurrentExtent = useCallback(() => {
      if (brushRef.current && brushRef.current.state.extent.x1 !== -1) {
        const currentExtent = brushRef.current.state.extent;
        return [
          brushXScale.invert(currentExtent.x0).getTime(),
          brushXScale.invert(currentExtent.x1).getTime(),
        ];
      } else {
        return statsContext.extent;
      }
    });

    const filterData = useMemo(
      () =>
        ([x0, x1]) =>
          setFilteredData(
            data.filter(
              ({ date }) => date.getTime() >= x0 && date.getTime() <= x1
            )
          ),
      [data]
    );

    useEffect(() => {
      //onBrushChange(getCurrentExtent());
      filterData(getCurrentExtent());
    }, [data]);

    const [window, setWindow] = useState(
      statsContext.timelineVisx.averaging.window
    );

    const onBrushChange = (domain) => {
      if (!domain) return;
      const [x0, x1] = [new Date(domain.x0), new Date(domain.x1)];
      filterData([x0, x1]);
      xScale.domain([x0, x1]);
    };

    const margin = useMemo(
      () => ({
        top: 100,
        left: 60,
        right: 30,
        bottom: 50,
      }),
      []
    );

    const innerHeight = height - margin.top - margin.bottom;

    const innerWidth = width - margin.left - margin.right;

    const topChartHeight = 0.85 * innerHeight;
    const separatorHeight = 15;
    const bottomChartHeight = innerHeight - topChartHeight - separatorHeight;

    const brushXScale = useMemo(
      () => scaleTime().domain(statsContext.extent).range([0, innerWidth]),
      [statsContext.extent, width, height, margin]
    );

    useEffect(() => {
      console.log("env change");
    }, [statsContext.extent, width, height, margin]);

    const initialBrushPosition = useMemo(
      () => ({
        start: { x: -1 },
        end: { x: -1 },
      }),
      [brushXScale]
    );

    useEffect(() => {
      const movingAvg = new d3.InternMap(
        groupNames.map((g) => [
          g,
          timelineSettingsVisx.averages
            .movingAvg(window)
            .fun(data.map((d) => d.values.get(g))),
        ])
      );
      data.forEach((d, i) => {
        const iMovingAvg = new d3.InternMap(
          d3.map(movingAvg, ([k, g]) => [k, g[i]])
        );
        d.movingAvg = iMovingAvg;
      });
    }, [data, window]);

    const yScale = useMemo(
      () =>
        scaleLinear({
          range: [topChartHeight, 0],
          domain: [
            0,
            Math.max(
              ...data.map(({ date, movingAvg }) => d3.sum(movingAvg.values()))
            ),
          ],
          nice: true,
        }),
      [data, width, height, margin]
    );

    const brushYScale = useMemo(
      () =>
        scaleLinear({
          range: [bottomChartHeight, 0],
          domain: [
            0,
            Math.max(
              ...data.map(({ date, movingAvg }) => d3.sum(movingAvg.values()))
            ),
          ],
          nice: true,
        }),
      [data, width, height, margin]
    );

    const xScale = useMemo(() => {
      console.log(
        "xScale change",
        getCurrentExtent().map((d) => new Date(d))
      );

      return scaleTime().domain(getCurrentExtent()).range([0, innerWidth]);
    }, [statsContext.extent, width, height, margin]);

    return (
      data.length > 0 && (
        <>
          <svg width="100%" height="100%" ref={svgRef} position="relative">
            <LinearGradient from="#f5f2e3" to="#ecf4f3" id="timeline" />
            <rect
              x={0}
              y={0}
              width={width}
              height={height}
              fill="url(#timeline)"
              rx={14}
            />
            <foreignObject
              width={width}
              height={height}
              x={10}
              y={10}
              position="absolute"
            >
              <TitleBox sx={{ position: "absolute", top: 0, left: 0 }}>
                <Typography variant="h6" key="heading">
                  Timeline
                </Typography>
                <CustomSelect
                  key="group"
                  propName="group"
                  value={statsContext.timelineVisx.group}
                  name="Sport"
                  options={groups}
                  setState={statsContext.setTimelineVisx}
                />
                <CustomSelect
                  key="value"
                  propName="value"
                  value={statsContext.timelineVisx.value}
                  name="Y"
                  options={values}
                  setState={statsContext.setTimelineVisx}
                />
                <CustomSelect
                  key="timePeriod"
                  propName="timePeriod"
                  value={statsContext.timelineVisx.timePeriod}
                  name="X"
                  options={timelineSettingsVisx.timePeriods}
                  setState={statsContext.setTimelineVisx}
                />
                <Box width="150px" key="windowSize">
                  <Slider
                    {...statsContext.timelineVisx.timePeriod.averaging}
                    slotProps={{ markLabel: { fontSize: "0.8rem" } }}
                    sx={{ mb: 1 }}
                    size="small"
                    valueLabelDisplay="off"
                    value={window} //{statsContext.timelineVisx.averaging.window}
                    onChange={
                      (e, v) => setWindow(v) //statsContext.setTimelineVisx({averaging: averages.movingAvg(v),})
                    }
                    onChangeCommitted={(e, v) =>
                      statsContext.setTimelineVisx({
                        averaging: averages.movingAvg(v),
                      })
                    }
                  />
                </Box>
              </TitleBox>
            </foreignObject>
            <style>{`
        .visx-axis-tick svg {
          user-select: none;
        }
      `}</style>
            <Group key="lines" left={margin.left} top={margin.top}>
              <Axis
                orientation="top"
                scale={xScale}
                hideAxisLine={true}
                tickStroke="#ddd"
              />
              <AnimatedAxis
                orientation="left"
                scale={yScale}
                top={0}
                tickFormat={statsContext.timelineVisx.value.format}
                hideAxisLine={true}
                tickStroke="#ddd"
              />
              <AnimatedGridRows
                scale={yScale}
                width={innerWidth}
                stroke="#ddd"
              />
              <GridColumns
                scale={xScale}
                height={topChartHeight}
                stroke="#ddd"
              />
              <AreaStack
                data={filteredData}
                keys={groupNames}
                value={(d, key) => d.movingAvg.get(key)}
                x={(d) => xScale(d.data.date)}
                y0={(d) => yScale(d[0])}
                y1={(d) => yScale(d[1])}
                strokeWidth={2}
                strokeOpacity={1}
                color={(key, i) => color(key)}
                fillOpacity={0.3}
              />
            </Group>
            <Group
              key="brush"
              top={topChartHeight + margin.top + 30}
              left={margin.left}
            >
              <AnimatedAxis
                orientation="bottom"
                scale={brushXScale}
                top={bottomChartHeight}
                hideAxisLine={true}
                tickStroke="#ddd"
              />
              <PatternLines
                id="brush_pattern"
                height={8}
                width={8}
                stroke="#1976d2"
                strokeWidth={1}
                orientation={["diagonal"]}
              />
              {groupNames.map((groupName) => (
                <AreaClosed
                  key={groupName}
                  curve={curveMonotoneX}
                  data={data}
                  x={(d) => brushXScale(d.date)}
                  y={(d) => brushYScale(d.movingAvg.get(groupName))}
                  yScale={brushYScale}
                  stroke="#000"
                  strokeWidth={1}
                  strokeOpacity={0.2}
                  fill="#000"
                  fillOpacity={0.2}
                />
              ))}
              <Brush
                xScale={brushXScale}
                yScale={brushYScale}
                width={innerWidth}
                height={bottomChartHeight}
                handleSize={8}
                margin={{ top: 0, left: margin.left, right: 0, bottom: 0 }}
                innerRef={brushRef}
                resizeTriggerAreas={["left", "right"]}
                brushDirection="horizontal"
                initialBrushPosition={initialBrushPosition}
                onChange={onBrushChange}
                onClick={() => {
                  filterData(statsContext.extent);
                  xScale.domain(statsContext.extent);
                }}
                selectedBoxStyle={selectedBrushStyle}
                useWindowMoveEvents
                //renderBrushHandle={(props) => <BrushHandle {...props} />}
              />
            </Group>
          </svg>
          {tooltipOpen &&
            tooltipData &&
            tooltipLeft != null &&
            tooltipTop != null && (
              <IconTooltip
                left={tooltipLeft}
                top={tooltipTop}
                {...tooltipData}
              />
            )}
        </>
      )
    );
  }
);

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
    const margin = { top: 30, left: 60, right: 30, bottom: 90 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const color = (d) =>
      statsContext.scatter.group.color(statsContext.scatter.group.fun(d));

    const xScale = scaleLinear({
      range: [margin.left, innerWidth + margin.left],
      domain: d3.extent(data, statsContext.scatter.xValue.fun),
    });

    const yScale = scaleLinear({
      range: [innerHeight + margin.top, margin.top],
      domain: d3.extent(data, statsContext.scatter.yValue.fun),
      nice: true,
    });

    const rScale = scaleSqrt({
      range: [0, 5],
      domain: d3.extent(data, statsContext.scatter.size.fun),
    });

    const colorScale = scaleOrdinal({
      range: [...new Set(data.map(color))],
      domain: [...new Set(data.map(color))],
    });

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
              left={tooltipLeft + 5}
              top={tooltipTop + 5}
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
              <TimelineVisx width={width} height={height} />
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
      {/*<Grid xs={12}>
        <Paper sx={{ height: 400 }}>
          <ViolinPlotNivo />
        </Paper>
            </Grid>*/}
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
