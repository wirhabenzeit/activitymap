// install (please try to align the version of installed @nivo packages)
// yarn add @nivo/bump
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveLine } from "@nivo/line";
import { ResponsiveTimeRange } from "@nivo/calendar";
import {
  ResponsiveScatterPlotCanvas,
  ResponsiveScatterPlot,
} from "@nivo/scatterplot";
import { ResponsiveChoropleth } from "@nivo/geo";
import { ResponsiveBoxPlot } from "@nivo/boxplot";
import {
  ResponsiveSwarmPlot,
  ResponsiveSwarmPlotCanvas,
} from "@nivo/swarmplot";
import React, {
  useContext,
  cloneElement,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";

import { scaleLinear, scaleLog, scaleSqrt, scaleOrdinal } from "@visx/scale";
import { Circle } from "@visx/shape";
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
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { voronoi } from "@visx/voronoi";

import { StatsContext } from "../contexts/StatsContext";
import { ActivityContext } from "../contexts/ActivityContext";
import { SelectionContext } from "../contexts/SelectionContext";

//import { useTooltip } from "@nivo/tooltip";

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
  Divider,
  Tooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

import {
  calendarSettings,
  pieSettings,
  timelineSettings,
  scatterSettings,
  mapStatSettings,
  boxSettings,
  violinSettings,
} from "../settings";

import countries from "../data/world_countries.json";

import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3sc from "d3-scale-chromatic";
import * as d3s from "d3-scale";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

const formProps = { m: 1, display: "inline-flex", verticalAlign: "middle" };

function TitleBox({ children }) {
  return (
    <Box
      sx={{
        height: "60px",
        width: 1,
        mt: 1,
        overflowX: "auto",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "noWrap",
      }}
    >
      {children.map((child) =>
        //<child.type {...child.props} sx={formProps} />
        cloneElement(child, { sx: formProps })
      )}
    </Box>
  );
}

const symmetricDifference = (arrayA, arrayB) => {
  const setA = new Set(arrayA);
  const setB = new Set(arrayB);

  const diffA = Array.from(setA).filter((x) => !setB.has(x));
  const diffB = Array.from(setB).filter((x) => !setA.has(x));

  return [...diffA, ...diffB];
};

function CustomSelect({
  propName,
  name,
  value,
  options,
  setState,
  headers,
  sx,
  disabled,
}) {
  return (
    <FormControl key={propName} sx={sx} disabled={disabled}>
      <InputLabel>{name}</InputLabel>
      <Select
        size="small"
        value={value.id}
        label="Sport"
        onChange={(event) =>
          setState({
            [propName]: options[event.target.value],
          })
        }
      >
        {!headers &&
          Object.entries(options).map(([key, aggregator]) => (
            <MenuItem value={key} key={key}>
              {aggregator.label}
            </MenuItem>
          ))}
        {headers &&
          headers.reduce(
            (prev, header) => [
              ...prev,
              <ListSubheader key={header.title}>{header.title}</ListSubheader>,
              ...Object.entries(options)
                .filter(([key, agg]) => header.filter(agg))
                .map(([key, aggregator]) => (
                  <MenuItem value={key} key={key}>
                    {aggregator.label}
                  </MenuItem>
                )),
            ],
            []
          )}
      </Select>
    </FormControl>
  );
}

function CustomPicker({
  propName,
  options,
  value,
  range,
  disabled,
  setState,
  sx,
}) {
  return (
    <ButtonGroup variant="outlined" key={propName} sx={sx}>
      <Button
        disabled={disabled || !value.highlight || value.selected == range[0]}
        onClick={(e) => {
          setState({
            [propName]: options.byYear(value.selected - 1),
          });
        }}
      >
        -
      </Button>
      <Button
        disabled={disabled}
        onClick={(e) => {
          if (value.highlight)
            setState({
              [propName]: options.all(value.selected),
            });
          else
            setState({
              [propName]: options.byYear(value.selected),
            });
        }}
      >
        {value.label}
      </Button>
      <Button
        disabled={disabled || !value.highlight || value.selected == range[1]}
        onClick={(e) => {
          setState({
            [propName]: options.byYear(value.selected + 1),
          });
        }}
      >
        +
      </Button>
    </ButtonGroup>
  );
}

const IconTooltip = ({
  icon = "child-reaching",
  textLeft,
  textRight,
  color = "#eeeeee",
  left,
  top,
}) => (
  <TooltipWithBounds left={left + 10} top={top + 10}>
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
      }}
    >
      {textLeft && (
        <Typography
          sx={{
            mr: 1,
            fontSize: "small",
          }}
        >
          {textLeft}
        </Typography>
      )}
      {icon && <FontAwesomeIcon fontSize="small" icon={icon} color={color} />}
      {textRight && (
        <Typography
          sx={{
            ml: 1,
            fontSize: "small",
          }}
        >
          {textRight}
        </Typography>
      )}
    </Box>
  </TooltipWithBounds>
);

const ChipTooltip = ({ color = "#eeeeee", icon, textLeft, textRight, sx }) => {
  const theme = useTheme();
  return (
    <Chip
      sx={{
        backgroundColor: theme.palette.background.paper,
        border: 1,
        borderColor: color,
        ...sx,
      }}
      size="small"
      label={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
          }}
        >
          {textLeft && (
            <Typography
              sx={{
                mr: 1,
                fontSize: "small",
              }}
            >
              {textLeft}
            </Typography>
          )}
          {icon && (
            <FontAwesomeIcon fontSize="small" icon={icon} color={color} />
          )}
          {textRight && (
            <Typography
              sx={{
                ml: 1,
                fontSize: "small",
              }}
            >
              {textRight}
            </Typography>
          )}
        </Box>
      }
      variant="filled"
    />
  );
};

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

const Scatter = () => {
  const statsContext = useContext(StatsContext);
  const selectionContext = useContext(SelectionContext);
  const values = scatterSettings.values;

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
      {statsContext.scatter.loaded && statsContext.data.length > 0 && (
        <ResponsiveScatterPlotCanvas
          data={statsContext.scatter.data}
          margin={{ top: 10, right: 40, bottom: 100, left: 60 }}
          xScale={{ type: "linear", min: "auto", max: "auto" }}
          yScale={{ type: "linear", min: "auto", max: "auto" }}
          blendMode="multiply"
          xFormat={statsContext.scatter.xValue.format}
          yFormat={statsContext.scatter.yValue.format}
          nodeSize={(d) => d.data.size}
          colors={(d) => statsContext.scatter.color(d.serieId)}
          axisTop={null}
          axisRight={null}
          /*annotations={selectionContext.selected.map((id) => ({
            type: "circle",
            match: {
              id: id,
            },
            noteX: 0,
            noteY: 0,
            offset: 3,
            noteTextOffset: 0,
            noteWidth: 0,
            note: "test",
          }))}*/
          axisBottom={{
            orient: "bottom",
            tickSize: 5,
            tickPadding: 5,
            tickValues: 3,
            tickRotation: 0,
            format: statsContext.scatter.xValue.formatAxis,
          }}
          axisLeft={{
            orient: "left",
            tickSize: 5,
            tickPadding: 5,
            tickValues: 4,
            tickRotation: 0,
            format: statsContext.scatter.yValue.formatAxis,
          }}
          tooltip={({ node }) => (
            <ChipTooltip
              color={node.data.color}
              icon={node.data.icon}
              textRight={node.data.title}
            />
          )}
          renderNode={(ctx, node) => {
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size / 2, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            if (selectionContext.selected.includes(node.data.id)) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, node.size / 2 + 3, 0, 2 * Math.PI);
              ctx.strokeStyle = "#000000";
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }}
          onClick={(point, event) => {
            if (event.metaKey)
              selectionContext.setSelected((selected) =>
                symmetricDifference(selected, [point.data.id])
              );
            else selectionContext.setSelected([point.data.id]);
          }}
        />
      )}
    </>
  );
};

const ScatterVisx = ({ width, height }) => {
  const statsContext = useContext(StatsContext);
  const selectionContext = useContext(SelectionContext);
  const values = scatterSettings.values;
  const data = statsContext.data;

  const {
    showTooltip,
    hideTooltip,
    tooltipData,
    tooltipOpen,
    tooltipTop = 0,
    tooltipLeft = 0,
  } = useTooltip();

  const svgRef = useRef(null);

  const margin = { top: 30, left: 60, right: 30, bottom: 90 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = (d) => statsContext.scatter.xValue.fun(d);
  const y = (d) => statsContext.scatter.yValue.fun(d);
  const radius = (d) => statsContext.scatter.size.fun(d);
  const color = (d) =>
    statsContext.scatter.group.color(statsContext.scatter.group.fun(d));

  const xScale = scaleLinear({
    range: [margin.left, innerWidth + margin.left],
    domain: d3.extent(data, x),
  });

  const yScale = scaleLinear({
    range: [innerHeight + margin.top, margin.top],
    domain: d3.extent(data, y),
    nice: true,
  });

  const rScale = scaleSqrt({
    range: [0, 5],
    domain: d3.extent(data, radius),
  });

  const colorScale = scaleOrdinal({
    range: [...new Set(data.map(color))],
    domain: [...new Set(data.map(color))],
  });

  const voronoiLayout = useMemo(
    () =>
      voronoi({
        x: (d) => xScale(x(d)) ?? 0,
        y: (d) => yScale(y(d)) ?? 0,
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
          tooltipLeft: xScale(x(closest.data)),
          tooltipTop: yScale(y(closest.data)),
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
      {statsContext.scatter.loaded && statsContext.data.length > 0 && (
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
              <>
                <Circle
                  key={i}
                  cx={xScale(x(point))}
                  cy={yScale(y(point))}
                  r={rScale(radius(point)) * (tooltipData === point ? 1.5 : 1)}
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
                    x={xScale(x(point))}
                    y={yScale(y(point))}
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
              </>
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
};

const ViolinLayer =
  ({ steps, data, tooltip }) =>
  ({ xScale, yScale, innerWidth }) => {
    const { showTooltipFromEvent, hideTooltip } = useTooltip();
    return (
      <>
        {data.map(({ group, quantiles, color }) => {
          const x0 = xScale(group);
          const qs = [0, ...steps, 100]
            .slice(2)
            .reduce(
              (prev, curr) => [...prev, [prev[prev.length - 1][1], curr]],
              [[0, steps[0]]]
            );
          const coordsToPath = (coords, scale) =>
            coords
              .map(([y, x]) => `${x0 + scale * x},${yScale(y)}`)
              .join(" L ");
          return (
            <g key={group}>
              {qs.map(([q0, q1]) => {
                const violinForw = Object.entries(quantiles)
                  .filter(([q, d]) => q >= q0 && q <= q1)
                  .map(([q, d]) => d);
                const violinRev = violinForw.slice().reverse();
                const d =
                  "M " +
                  coordsToPath(violinForw, innerWidth / data.length / 3) +
                  " L " +
                  coordsToPath(violinRev, -innerWidth / data.length / 3) +
                  " Z";
                return (
                  <path
                    key={group + q0}
                    d={d}
                    fill={addAlpha(color, 0.2)}
                    stroke={addAlpha(color, 0.5)}
                    onMouseEnter={(e) =>
                      showTooltipFromEvent(
                        tooltip({
                          group: group,
                          quantiles: {
                            [q0]: quantiles[q0],
                            [q1]: quantiles[q1],
                          },
                        }),
                        e
                      )
                    }
                    onMouseLeave={(e) => hideTooltip()}
                  />
                );
              })}
            </g>
          );
        })}
      </>
    );
  };

const ViolinPlot = () => {
  const statsContext = useContext(StatsContext);
  const activityContext = useContext(ActivityContext);
  const selectionContext = useContext(SelectionContext);

  const [nodeId, setNodeId] = useState(null);
  const handleMouseMove = useCallback(
    (node) => setNodeId(node.id),
    [setNodeId]
  );
  const handleMouseLeave = useCallback(() => setNodeId(null), [setNodeId]);

  const values = violinSettings.values;
  const groups = violinSettings.groups;

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="heading">
          Violin Plot
        </Typography>
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.violin.value}
          name="Value"
          options={values}
          setState={statsContext.setViolin}
        />
        <CustomSelect
          key="group"
          propName="group"
          value={statsContext.violin.group}
          name="Group"
          options={groups}
          setState={statsContext.setViolin}
        />
      </TitleBox>
      {statsContext.violin.loaded && (
        <ResponsiveSwarmPlot
          data={statsContext.violin.outliers}
          groups={statsContext.violin.groups}
          identity="id"
          tooltip={(props) => {
            return (
              <ChipTooltip
                color={props.data.color}
                icon={props.data.icon}
                textRight={
                  activityContext.activityDict[props.id].properties.name
                }
                textLeft=""
              />
            );
          }}
          value="value"
          annotations={selectionContext.selected.map((id) => ({
            type: "circle",
            match: {
              id: id,
            },
            noteX: 50,
            noteY: 10,
            offset: 2,
            noteTextOffset: -3,
            noteWidth: 5,
            note: activityContext.activityDict[id].properties.name,
          }))}
          colors={(d) => addAlpha(d.data.color, nodeId === d.id ? 1 : 0.6)}
          valueFormat={statsContext.violin.value.format}
          //valueScale={{ type: "log", min: 10, max: 9000, reverse: false }}
          forceStrength={4}
          simulationIterations={100}
          margin={{ top: 10, right: 30, bottom: 100, left: 80 }}
          axisBottom={{
            orient: "top",
            tickSize: 10,
            tickPadding: 5,
            tickRotation: 0,
            format: statsContext.violin.group.format,
          }}
          axisLeft={{
            orient: "left",
            tickSize: 10,
            tickPadding: 5,
            tickRotation: 0,
            format: statsContext.violin.value.formatAxis,
            tickValues: 5,
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          axisTop={null}
          axisRight={null}
          onClick={(point, event) => {
            if (event.metaKey)
              selectionContext.setSelected((selected) =>
                symmetricDifference(selected, [point.data.id])
              );
            else selectionContext.setSelected([point.data.id]);
          }}
          layers={[
            "grid",
            "axes",
            ViolinLayer({
              data: statsContext.violin.kdes,
              steps: [25, 50, 75, 90],
              tooltip: ({ group, quantiles }) => {
                const qs = Object.entries(quantiles);
                return (
                  <ChipTooltip
                    textLeft={"Q" + qs[0][0] + "-" + qs[1][0] + "%"}
                    color={statsContext.violin.group.color(group)}
                    icon={statsContext.violin.group.icon(group)}
                    textRight={
                      statsContext.violin.value.format(qs[0][1][0]) +
                      " – " +
                      statsContext.violin.value.format(qs[1][1][0])
                    }
                  />
                );
              },
            }),
            "circles",
            "annotations",
            "mesh",
          ]}
        />
      )}
    </>
  );
};

const SumMap = () => {
  const statsContext = useContext(StatsContext);
  const values = mapStatSettings.values;
  const timeGroups = mapStatSettings.timeGroups;

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="title">
          Summary Map
        </Typography>
        <CustomSelect
          key="value"
          propName="value"
          value={statsContext.map.value}
          name="Value"
          options={values}
          setState={statsContext.setMap}
        />
        <CustomPicker
          key="timeGroup"
          propName="timeGroup"
          options={timeGroups}
          value={statsContext.map.timeGroup}
          range={[2014, 2023]}
          setState={statsContext.setMap}
        />
      </TitleBox>
      {!statsContext.map.loaded && (
        <Skeleton
          variant="rounded"
          width="90%"
          height="80%"
          sx={{ margin: "auto" }}
        />
      )}
      {statsContext.map.loaded && (
        <ResponsiveChoropleth
          data={statsContext.map.data}
          features={countries.features}
          margin={{ top: 0, right: 40, bottom: 100, left: 50 }}
          height={340}
          colors={
            d3s.scaleQuantize().range(d3sc.schemeBuPu[5])[
              statsContext.map.domain
            ]
          }
          domain={statsContext.map.domain}
          unknownColor="#ffffff"
          label="properties.name"
          projectionTranslation={[0.5, 0.5]}
          projectionRotation={[0, 0, 0]}
          enableGraticule={true}
          graticuleLineColor="#dddddd"
          borderWidth={0.5}
          borderColor="#152538"
          valueFormat={statsContext.map.value.format}
        />
      )}
    </>
  );
};

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
        <Paper sx={{ height: 200 }}>
          <ActivityCalendar />
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Paper sx={{ height: 400 }}>
          <Scatter />
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Paper sx={{ height: 500, width: "100%", position: "relative" }}>
          <ParentSize>
            {({ width, height }) => (
              <ScatterVisx width={width} height={height} />
            )}
          </ParentSize>
        </Paper>
      </Grid>
      <Grid xs={12}>
        <Paper sx={{ height: 400 }}>
          <ViolinPlot />
        </Paper>
      </Grid>
    </Grid>
  );
}
