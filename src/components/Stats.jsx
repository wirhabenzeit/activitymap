// install (please try to align the version of installed @nivo packages)
// yarn add @nivo/bump
import { ResponsiveAreaBump } from "@nivo/bump";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveLine } from "@nivo/line";
import React, { useContext } from "react";
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
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Box,
  Unstable_Grid2 as Grid,
  Chip,
  Typography,
} from "@mui/material";

import { timelineSettings } from "../settings";

import { aliasMap, categorySettings } from "../settings";
import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import { FilterContext } from "../contexts/FilterContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { Title } from "@mui/icons-material";
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
      {children.map((child) => (
        <child.type {...child.props} sx={formProps} />
      ))}
    </Box>
  );
}

function YearlySummary() {
  const statsContext = useContext(StatsContext);
  const filterContext = useContext(FilterContext);
  const inputData = d3.filter(statsContext.data, (f) =>
    filterContext.filterIDs.includes(f.id)
  );
  const extent = d3.extent(inputData, (d) => d.date);
  const years = extent.map((d) => d.getFullYear());
  const extentInYear = (year) => [
    year == years[0] ? extent[0] : new Date(year, 0, 1),
    year == years[1] ? extent[1] : new Date(year, 11, 31),
  ];

  const [timePeriod, setTimePeriod] = React.useState("week");
  const [stat, setStat] = React.useState("count");
  const [group, setGroup] = React.useState("sport_group");
  const [timeGroup, setTimeGroup] = React.useState(
    timelineSettings.timeGroups.byYear(2023)
  );
  const [value, setValue] = React.useState("distance");

  const [yearAvg, setYearAvg] = React.useState(false);

  const normalizer = (date) =>
    timelineSettings.timePeriods[timePeriod].occurrencesIn(
      date,
      ...(yearAvg ? extent : extentInYear(date.getFullYear()))
    );

  const stats = {
    avg: {
      label: "Average",
      fun: (v) => d3.mean(v, timelineSettings.values[value].fun),
      format: timelineSettings.values[value].format,
      unit: timelineSettings.values[value].unit,
    },
    median: {
      label: "Median",
      format: timelineSettings.values[value].format,
      fun: (v) => d3.median(v, timelineSettings.values[value].fun),
      unit: timelineSettings.values[value].unit,
    },
    min: {
      label: "Min",
      format: timelineSettings.values[value].format,
      fun: (v) => d3.min(v, timelineSettings.values[value].fun),
      unit: timelineSettings.values[value].unit,
    },
    max: {
      label: "Max",
      format: timelineSettings.values[value].format,
      fun: (v) => d3.max(v, timelineSettings.values[value].fun),
      unit: timelineSettings.values[value].unit,
    },
    count: {
      label: "Count",
      fun: (v) => v.length / normalizer(v[0].date),
      format: (v) =>
        timelineSettings.timePeriods[timePeriod].relative
          ? v.toFixed(1)
          : v.toFixed(),
      unit: "",
    },
    cumCount: {
      label: "Cumulative Count",
      fun: (v) => v.length / normalizer(v[0].date),
      format: (v) =>
        timelineSettings.timePeriods[timePeriod].relative
          ? v.toFixed(1)
          : v.toFixed(),
      cumulative: true,
      unit: "",
    },
    total: {
      label: "Total",
      format: timelineSettings.values[value].format,
      fun: (v) =>
        d3.sum(v, timelineSettings.values[value].fun) / normalizer(v[0].date),
      unit: timelineSettings.values[value].unit,
    },
    cumTotal: {
      label: "Cumulative Total",
      format: timelineSettings.values[value].format,
      fun: (v) =>
        d3.sum(v, timelineSettings.values[value].fun) / normalizer(v[0].date),
      cumulative: true,
      unit: timelineSettings.values[value].unit,
    },
  };

  var rollup;
  const separateByYear =
    !yearAvg && timelineSettings.timePeriods[timePeriod].relative;

  if (!yearAvg && timelineSettings.timePeriods[timePeriod].relative) {
    rollup = new d3.InternMap(
      d3
        .map(
          d3.rollup(
            inputData,
            stats[stat].fun,
            timelineSettings.groups[group].fun,
            (f) => f.date.getFullYear(),
            (f) => timelineSettings.timePeriods[timePeriod].fun(f.date)
          ),
          ([id, data]) => d3.map(data, ([x, y]) => [[id, x], y])
        )
        .flat()
    );
  } else {
    rollup = d3.rollup(
      inputData,
      stats[stat].fun,
      timelineSettings.groups[group].fun,
      (f) => timelineSettings.timePeriods[timePeriod].fun(f.date)
    );
  }

  const fillZeros = (data, extent) => {
    const out = [];
    timelineSettings.timePeriods[timePeriod].range(extent).forEach((date) => {
      const transformedDate =
        timelineSettings.timePeriods[timePeriod].fun(date);
      if (data.has(transformedDate)) {
        out.push([transformedDate, data.get(transformedDate)]);
      } else {
        out.push([transformedDate, 0]);
      }
    });
    return out;
  };
  const makeCumulative = (data) => {
    return d3.zip(
      data.map(([x, y]) => x),
      d3.cumsum(data.map(([x, y]) => y))
    );
  };

  const rollupData = Array.from(rollup.entries()).map(([id, data]) => [
    id,
    stats[stat].cumulative
      ? makeCumulative(
          fillZeros(
            data,
            separateByYear
              ? extentInYear(id[1])
              : timelineSettings.timePeriods[timePeriod].relative
              ? extentInYear(2018)
              : extent
          )
        )
      : fillZeros(
          data,
          separateByYear
            ? extentInYear(id[1])
            : timelineSettings.timePeriods[timePeriod].relative
            ? extentInYear(2018)
            : extent
        ),
  ]);
  //  console.log(Array.from(rollup.get("All").entries()));

  const data = rollupData.map(([id, data]) => ({
    id: id,
    color: separateByYear
      ? timelineSettings.groups[group].color(id[0])
      : timelineSettings.groups[group].color(id),
    data: data.map(([x, y]) => ({ x: x, y: y })),
  }));

  return (
    <>
      <TitleBox>
        <Typography variant="h6">Timeline</Typography>
        <FormControl>
          <InputLabel>Axis</InputLabel>
          <Select
            size="small"
            value={timePeriod}
            label="Value"
            onChange={(event) => {
              setTimePeriod(event.target.value);
            }}
          >
            <ListSubheader>Absolute</ListSubheader>
            {Object.entries(timelineSettings.timePeriods)
              .filter(([key, agg]) => !agg.relative)
              .map(([key, aggregator]) => (
                <MenuItem value={key} key={key}>
                  {aggregator.label}
                </MenuItem>
              ))}
            <ListSubheader>Relative</ListSubheader>
            {Object.entries(timelineSettings.timePeriods)
              .filter(([key, agg]) => agg.relative)
              .map(([key, aggregator]) => (
                <MenuItem value={key} key={key}>
                  {aggregator.label}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        <FormControl>
          <InputLabel>Sport</InputLabel>
          <Select
            size="small"
            value={group}
            label="Sport"
            onChange={(event) => setGroup(event.target.value)}
          >
            {Object.entries(timelineSettings.groups).map(
              ([key, aggregator]) => (
                <MenuItem value={key} key={key}>
                  {aggregator.label}
                </MenuItem>
              )
            )}
          </Select>
        </FormControl>
        <ButtonGroup variant="outlined">
          <Button
            disabled={
              !timelineSettings.timePeriods[timePeriod].relative ||
              yearAvg ||
              timeGroup.selected == years[0]
            }
            onClick={(e) => {
              setTimeGroup(
                timelineSettings.timeGroups.byYear(timeGroup.selected - 1)
              );
            }}
          >
            -
          </Button>
          <Button
            disabled={!timelineSettings.timePeriods[timePeriod].relative}
            onClick={(e) => {
              setYearAvg(!yearAvg);
            }}
          >
            {yearAvg ? "Avg" : timeGroup.selected}
          </Button>
          <Button
            disabled={
              !timelineSettings.timePeriods[timePeriod].relative ||
              yearAvg ||
              timeGroup.selected == years[1]
            }
            onClick={(e) => {
              setTimeGroup(
                timelineSettings.timeGroups.byYear(timeGroup.selected + 1)
              );
            }}
          >
            +
          </Button>
        </ButtonGroup>
        <FormControl>
          <InputLabel>Stat</InputLabel>
          <Select
            size="small"
            value={stat}
            label="Value"
            onChange={(event) => setStat(event.target.value)}
          >
            {Object.entries(stats).map(([key, aggregator]) => (
              <MenuItem value={key} key={key}>
                {aggregator.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <InputLabel>Value</InputLabel>
          <Select
            size="small"
            value={value}
            label="Value"
            onChange={(event) => setValue(event.target.value)}
            disabled={["count", "cumCount"].includes(stat)}
          >
            {Object.entries(timelineSettings.values).map(
              ([key, aggregator]) => (
                <MenuItem value={key} key={key}>
                  {aggregator.label}
                </MenuItem>
              )
            )}
          </Select>
        </FormControl>
      </TitleBox>
      <ResponsiveLine
        animate
        margin={{ top: 10, right: 20, bottom: 100, left: 40 }}
        curve="monotoneX"
        useMesh={true}
        isInteractive={true}
        tooltip={({ point }) => {
          return (
            <Chip
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
                      fontFamily: "monospace",
                      fontSize: "small",
                    }}
                  >
                    {separateByYear && point.serieId[1] + "-"}
                    {timelineSettings.timePeriods[timePeriod].format(
                      point.data.xFormatted
                    )}
                  </Typography>
                  <FontAwesomeIcon
                    fontSize="small"
                    icon={
                      group == "no_group"
                        ? "child-reaching"
                        : categorySettings[
                            separateByYear ? point.serieId[0] : point.serieId
                          ].icon
                    }
                    color={
                      group == "no_group"
                        ? "#000000"
                        : categorySettings[
                            separateByYear ? point.serieId[0] : point.serieId
                          ].color
                    }
                  />
                  <Typography
                    sx={{
                      ml: 1,
                      fontSize: "small",
                      fontFamily: "monospace",
                    }}
                  >
                    {stats[stat].format(point.data.y) + stats[stat].unit}
                  </Typography>
                </Box>
              }
              variant="filled"
            />
          );
        }}
        enablePoints={!["yearMonth", "week"].includes(timePeriod)}
        yFormat={stats[stat].format}
        data={data}
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
          format: timelineSettings.timePeriods[timePeriod].format,
          tickValues: 6,
        }}
        axisLeft={{
          //tickSize: 5,
          tickPadding: 5,
          tickRotation: 0,
          legend: stat == "count" ? "#" : timelineSettings.values[value].unit,
          format: stats[stat].format,
          tickValues: 5,
        }}
        colors={(d) =>
          addAlpha(
            d.color,
            yearAvg ||
              d.id[1] == timeGroup.highlight ||
              !timelineSettings.timePeriods[timePeriod].relative
              ? 1
              : 0.1
          )
        }
        onClick={(d) => {
          setYearHigh(d.serieId[1]);
        }}
      />
    </>
  );
}

const TypePie = () => {
  const statsContext = useContext(StatsContext);
  const filterContext = useContext(FilterContext);
  const inputData = d3.filter(statsContext.data, (f) =>
    filterContext.filterIDs.includes(f.id)
  );
  const [value, setValue] = React.useState("count");
  const values = {
    count: {
      fun: (v) => v.length,
      label: "Count",
      unit: "",
    },
    distance: {
      fun: (v) => d3.sum(v, (d) => d.distance),
      format: (v) => (v / 1000).toFixed() + "km",
      label: "Distance",
      unit: "km",
    },
    elevation: {
      fun: (v) => d3.sum(v, (d) => d.total_elevation_gain),
      format: (v) => (v / 1_000).toFixed() + "km",
      label: "Elevation",
      unit: "km",
    },
    time: {
      fun: (v) => d3.sum(v, (d) => d.elapsed_time),
      format: (v) => (v / 3600).toFixed() + "h",
      label: "Duration",
      unit: "h",
    },
  };

  const rollup = d3.map(
    d3.rollup(inputData, values[value].fun, (d) => aliasMap[d.sport_type]),
    ([key, value]) => ({
      id: key,
      value: value,
      color: categorySettings[key].color,
    })
  );
  console.log(rollup);

  return (
    <>
      <TitleBox>
        <Typography variant="h6" key="title">
          Sport
        </Typography>
        <FormControl>
          <InputLabel>Value</InputLabel>
          <Select
            size="small"
            value={value}
            label="Value"
            onChange={(event) => setValue(event.target.value)}
          >
            {Object.entries(values).map(([key, aggregator]) => (
              <MenuItem value={key} key={key}>
                {aggregator.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </TitleBox>
      <ResponsivePie
        data={rollup}
        margin={{ top: 40, right: 80, bottom: 80, left: 80 }}
        innerRadius={0.5}
        padAngle={0.7}
        cornerRadius={3}
        activeOuterRadiusOffset={8}
        borderWidth={1}
        arcLinkLabelsSkipAngle={10}
        arcLinkLabelsThickness={2}
        arcLinkLabelsColor={{ from: "color" }}
        arcLabelsSkipAngle={10}
        colors={(d) => d.data.color}
        valueFormat={values[value].format}
      />
    </>
  );
};

export default function StatsView() {
  const statsContext = useContext(StatsContext);
  return (
    <Grid container>
      <Grid xs={12} md={8}>
        <Paper sx={{ height: 400 }}>
          {statsContext.loaded && <YearlySummary />}
        </Paper>
      </Grid>
      <Grid xs={12} md={4}>
        <Paper sx={{ height: 400 }}>{statsContext.loaded && <TypePie />}</Paper>
      </Grid>
    </Grid>
  );
}
