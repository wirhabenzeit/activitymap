// install (please try to align the version of installed @nivo packages)
// yarn add @nivo/bump
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveLine } from "@nivo/line";
import { ResponsiveTimeRange } from "@nivo/calendar";
import { ResponsiveScatterPlotCanvas } from "@nivo/scatterplot";
import React, { useContext, cloneElement } from "react";
import { StatsContext } from "../contexts/StatsContext";
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
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

import {
  calendarSettings,
  pieSettings,
  timelineSettings,
  scatterSettings,
} from "../settings";

import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
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
      <Chip
        sx={{
          backgroundColor: theme.palette.background.paper,
          border: 1,
          borderColor: lineProps.color,
        }}
        size="small"
        label={
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
            }}
          >
            <Typography
              sx={{
                mr: 1,
                fontSize: "small",
              }}
            >
              {lineProps.xLabel(point.data.xFormatted)}
            </Typography>
            <FontAwesomeIcon
              fontSize="small"
              icon={lineProps.icon}
              color={lineProps.color}
            />
            <Typography
              sx={{
                ml: 1,
                fontSize: "small",
              }}
            >
              {lineProps.yLabel(point.data.yFormatted)}
            </Typography>
          </Box>
        }
        variant="filled"
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
            tooltip={({ day, color, value }) => {
              return (
                <Chip
                  sx={{
                    backgroundColor: theme.palette.background.paper,
                    border: 1,
                    borderColor: color,
                  }}
                  variant="filled"
                  size="small"
                  label={
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Typography sx={{ fontSize: "small" }}>
                        {d3tf.timeFormat("%a, %b %d")(new Date(day))}
                      </Typography>
                      <Divider
                        sx={{ mx: 1, height: 20 }}
                        orientation="vertical"
                      />
                      <Typography sx={{ fontSize: "small" }} color={color}>
                        {value !== "selected"
                          ? statsContext.calendar.value.format(value)
                          : statsContext.calendar.activitiesByDate
                              .get(day)
                              .map((act) => act.name)
                              .join(", ")}
                      </Typography>
                    </Box>
                  }
                />
              );
            }}
          />
        </Box>
      )}
    </>
  );
};

const Scatter = () => {
  const statsContext = useContext(StatsContext);
  const values = scatterSettings.values;
  const theme = useTheme();
  var dataDict;
  if (statsContext.scatter.data)
    dataDict = d3.rollup(
      statsContext.scatter.data,
      (v) => v[0],
      (d) => d.id
    );

  const ScatterTooltip = ({ point }) => {
    const catProps = dataDict.get(point.serieId);
    return (
      <Chip
        sx={{
          backgroundColor: theme.palette.background.paper,
          border: 1,
          borderColor: catProps.color,
        }}
        size="small"
        label={
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
            }}
          >
            <FontAwesomeIcon
              fontSize="small"
              icon={catProps.icon}
              color={catProps.color}
            />
            <Typography
              sx={{
                ml: 1,
                fontSize: "small",
              }}
            >
              {point.data.title}
            </Typography>
          </Box>
        }
        variant="filled"
      />
    );
  };

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
          colors={(d) => dataDict.get(d.serieId).color}
          axisTop={null}
          axisRight={null}
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
          tooltip={({ node }) => <ScatterTooltip point={node} />}
          renderNode={(ctx, node) => {
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size / 2, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            if (node.data.selected) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, node.size / 2 + 2, 0, 2 * Math.PI);
              ctx.strokeStyle = "#000000";
              ctx.stroke();
            }
          }}
          onClick={statsContext.scatter.onClick}
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
      <Grid xs={12} lg={7}>
        <Paper sx={{ height: 400 }}>
          <Scatter />
        </Paper>
      </Grid>
    </Grid>
  );
}
