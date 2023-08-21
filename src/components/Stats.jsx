// install (please try to align the version of installed @nivo packages)
// yarn add @nivo/bump
import { ResponsiveAreaBump } from "@nivo/bump";
import { ResponsiveLine } from "@nivo/line";
import React, { useContext } from "react";
import { StatsContext } from "../contexts/StatsContext";
import { ActivityContext } from "../contexts/ActivityContext";
function addAlpha(color, opacity) {
  const _opacity = Math.round(Math.min(Math.max(opacity || 1, 0), 1) * 255);
  return color + _opacity.toString(16).toUpperCase();
}
import {
  ListSubheader,
  CardHeader,
  ButtonGroup,
  Button,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Divider,
  Card,
  Box,
  CardContent,
  Unstable_Grid2 as Grid,
  Chip,
  Typography,
} from "@mui/material";

import { aliasMap, categorySettings } from "../settings";
import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import { FilterContext } from "../contexts/FilterContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

const occurrencesOfMonth = (date, from, to) => {
  const month = date.getMonth();
  return (
    to.getFullYear() -
    from.getFullYear() -
    1 +
    (to.getMonth() >= month ? 1 : 0) +
    (from.getMonth() <= month ? 1 : 0)
  );
};
const occurrencesOfWeek = (date, from, to) => {
  const week = parseInt(d3tf.timeFormat("%W")(date));
  return (
    to.getFullYear() -
    from.getFullYear() -
    1 +
    (parseInt(d3tf.timeFormat("%W")(from)) <= week ? 1 : 0) +
    (parseInt(d3tf.timeFormat("%W")(to)) >= week ? 1 : 0)
  );
};
const occurrencesOfDay = (date, from, to) => {
  const day = date.getDay();
  return (
    d3t.timeDay.count(d3t.timeMonday.ceil(from), d3t.timeSunday.floor(to)) / 7 +
    (day >= from.getDay() ? 1 : 0) +
    (day <= to.getDay() ? 1 : 0)
  );
};

function YearlySummary() {
  const statsContext = useContext(StatsContext);
  const filterContext = useContext(FilterContext);
  const extent = d3.extent(statsContext.data, (d) => d.date);

  const [timePeriod, setTimePeriod] = React.useState("week");
  const [yearAvg, setYearAvg] = React.useState(false);
  const [yearHigh, setYearHigh] = React.useState(new Date().getFullYear());
  const [stat, setStat] = React.useState("count");
  const [group, setGroup] = React.useState("sport_group");
  const [value, setValue] = React.useState("distance");

  const timePeriods = {
    year: {
      label: "Year",
      format: (v) => new Date(v).getFullYear(),
      fun: (date) => d3t.timeYear.floor(date),
      tickValues: "every 1 year",
      range: () =>
        d3t.timeYear.range(
          d3t.timeYear.floor(extent[0]),
          d3t.timeYear.ceil(extent[1])
        ),
    },
    yearMonth: {
      label: "Year/Month",
      format: (v) => d3tf.timeFormat("%m/%y")(new Date(v)),
      fun: (date) => d3t.timeMonth.floor(date),
      tickValues: "every 6 months",
      range: () =>
        d3t.timeMonth.range(
          d3t.timeMonth.floor(extent[0]),
          d3t.timeMonth.ceil(extent[1])
        ),
    },
    month: {
      label: "Month",
      format: (v) => d3tf.timeFormat("%b")(new Date(v)),
      tickValues: "every 1 month",
      fun: (date) => {
        const newDate = d3t.timeMonth.floor(date);
        newDate.setFullYear(2018);
        return newDate;
      },
      relative: "year",
      range: (year) => {
        if (year == extent[0].getFullYear())
          return d3t.timeMonth.range(
            d3t.timeMonth.floor(extent[0]).setFullYear(2018),
            new Date(2018, 11, 31)
          );
        else if (year == extent[1].getFullYear())
          return d3t.timeMonth.range(
            new Date(2018, 0, 1),
            d3t.timeMonth.ceil(extent[1]).setFullYear(2018)
          );
        else
          return d3t.timeMonth.range(
            new Date(2018, 0, 1),
            new Date(2018, 11, 31)
          );
      },
      occurrencesIn: (date, from, to) => occurrencesOfMonth(date, from, to),
    },
    week: {
      label: "Week",
      format: (v) => d3tf.timeFormat("%b")(new Date(v)),
      tickValues: "every 1 month",
      fun: (date) => {
        const newDate = d3t.timeDay.floor(date);
        newDate.setFullYear(2018);
        return d3t.timeMonday.floor(newDate);
      },
      relative: "year",
      range: (year) => {
        if (year == extent[0].getFullYear())
          return d3t.timeMonday.range(
            d3t.timeMonday.floor(extent[0]).setFullYear(2018),
            new Date(2018, 11, 31)
          );
        else if (year == extent[1].getFullYear())
          return d3t.timeMonday.range(
            new Date(2018, 0, 1),
            d3t.timeMonday.ceil(extent[1]).setFullYear(2018)
          );
        else
          return d3t.timeMonday.range(
            new Date(2018, 0, 1),
            new Date(2018, 11, 31)
          );
      },
      occurrencesIn: (date, from, to) => occurrencesOfWeek(date, from, to),
    },
    day: {
      label: "Day",
      tickValues: "every 1 day",
      format: (v) =>
        new Date(v).toLocaleString("default", {
          weekday: "short",
        }),
      fun: (date) => new Date(2018, 0, 1 + ((date.getDay() + 6) % 7)),
      relative: "week",
      range: () =>
        d3t.timeDay.range(new Date(2018, 0, 1), new Date(2018, 0, 8)),
      occurrencesIn: (date, from, to) => occurrencesOfDay(date, from, to),
    },
  };

  const values = {
    distance: {
      fun: (d) => d.distance,
      format: (v) => (v / 1000).toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      fun: (d) => d.total_elevation_gain,
      format: (v) => v.toFixed(),
      label: "Elevation",
      unit: "m",
    },
    time: {
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed(1),
      label: "Duration",
      unit: "h",
    },
  };

  const extentInYear = (year) => [
    year == years[0] ? extent[0] : new Date(year, 0, 1),
    year == years[1] ? extent[1] : new Date(year + 1, 0, 1),
  ];
  const years = extent.map((d) => d.getFullYear());

  const normalizer = (date) =>
    timePeriods[timePeriod].relative
      ? timePeriods[timePeriod].occurrencesIn(
          date,
          ...(yearAvg ? extent : extentInYear(date.getFullYear()))
        )
      : 1;

  const stats = {
    avg: {
      label: "Average",
      fun: (v) => d3.mean(v, values[value].fun),
      format: values[value].format,
      unit: values[value].unit,
    },
    median: {
      label: "Median",
      format: values[value].format,
      fun: (v) => d3.median(v, values[value].fun),
      unit: values[value].unit,
    },
    min: {
      label: "Min",
      format: values[value].format,
      fun: (v) => d3.min(v, values[value].fun),
      unit: values[value].unit,
    },
    max: {
      label: "Max",
      format: values[value].format,
      fun: (v) => d3.max(v, values[value].fun),
      unit: values[value].unit,
    },
    count: {
      label: "Count",
      fun: (v) => v.length / normalizer(v[0].date),
      format: (v) =>
        timePeriods[timePeriod].relative ? v.toFixed(1) : v.toFixed(),
      unit: "",
    },
    cumCount: {
      label: "Cumulative Count",
      fun: (v) => v.length / normalizer(v[0].date),
      format: (v) =>
        timePeriods[timePeriod].relative ? v.toFixed(1) : v.toFixed(),
      cumulative: true,
      unit: "",
    },
    total: {
      label: "Total",
      format: values[value].format,
      fun: (v) => d3.sum(v, values[value].fun) / normalizer(v[0].date),
      unit: values[value].unit,
    },
    cumTotal: {
      label: "Cumulative Total",
      format: values[value].format,
      fun: (v) => d3.sum(v, values[value].fun) / normalizer(v[0].date),
      cumulative: true,
      unit: values[value].unit,
    },
  };

  const groups = {
    sport_group: {
      label: "Sport Group",
      fun: (d) => aliasMap[d.sport_type],
      color: (id) => categorySettings[id].color,
    },
    sport_type: {
      label: "Sport Type",
      fun: (d) => d.sport_type,
      color: (id) => categorySettings[aliasMap[id]].color,
    },
    no_group: {
      label: "All",
      fun: (d) => "All",
      color: (id) => "#000000",
    },
  };

  const inputData = d3.filter(statsContext.data, (f) =>
    filterContext.filterIDs.includes(f.id)
  );
  var rollup;
  const separateByYear = !yearAvg && timePeriods[timePeriod].relative;

  if (!yearAvg && timePeriods[timePeriod].relative) {
    rollup = new d3.InternMap(
      d3
        .map(
          d3.rollup(
            inputData,
            stats[stat].fun,
            groups[group].fun,
            (f) => f.date.getFullYear(),
            (f) => timePeriods[timePeriod].fun(f.date)
          ),
          ([id, data]) => d3.map(data, ([x, y]) => [[id, x], y])
        )
        .flat()
    );
  } else {
    rollup = d3.rollup(inputData, stats[stat].fun, groups[group].fun, (f) =>
      timePeriods[timePeriod].fun(f.date)
    );
  }

  const fillZeros = (data, year) => {
    const out = [];
    timePeriods[timePeriod].range(year).forEach((date) => {
      const transformedDate = timePeriods[timePeriod].fun(date);
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
      ? makeCumulative(fillZeros(data, separateByYear ? id[1] : null))
      : fillZeros(data, separateByYear ? id[1] : null),
  ]);

  const data = rollupData.map(([id, data]) => ({
    id: id,
    color: separateByYear
      ? groups[group].color(id[0])
      : groups[group].color(id),
    data: data.map(([x, y]) => ({ x: x, y: y })),
  }));
  const minMax = d3.extent(statsContext.years).map((d) => d.getFullYear());

  return (
    statsContext.loaded && (
      <Card>
        <CardHeader
          title="Yearly Summary"
          action={
            <Grid
              container
              justify="center"
              alignItems="center"
              direction="row"
            >
              <FormControl sx={{ mx: 1 }}>
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
                  {Object.entries(timePeriods)
                    .filter(([key, agg]) => !agg.relative)
                    .map(([key, aggregator]) => (
                      <MenuItem value={key} key={key}>
                        {aggregator.label}
                      </MenuItem>
                    ))}
                  <ListSubheader>Relative</ListSubheader>
                  {Object.entries(timePeriods)
                    .filter(([key, agg]) => agg.relative)
                    .map(([key, aggregator]) => (
                      <MenuItem value={key} key={key}>
                        {aggregator.label}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
              <ButtonGroup variant="outlined">
                <Button
                  disabled={
                    !timePeriods[timePeriod].relative ||
                    yearAvg ||
                    yearHigh == minMax[0]
                  }
                  onClick={(e) => {
                    setYearHigh(yearHigh - 1);
                  }}
                >
                  -
                </Button>
                <Button
                  disabled={!timePeriods[timePeriod].relative}
                  onClick={(e) => {
                    setYearAvg(!yearAvg);
                  }}
                >
                  {yearAvg ? "Avg" : yearHigh}
                </Button>
                <Button
                  disabled={
                    !timePeriods[timePeriod].relative ||
                    yearAvg ||
                    yearHigh == minMax[1]
                  }
                  onClick={(e) => {
                    setYearHigh(yearHigh + 1);
                  }}
                >
                  +
                </Button>
              </ButtonGroup>
              <FormControl sx={{ mx: 1 }}>
                <InputLabel>Group</InputLabel>
                <Select
                  size="small"
                  value={group}
                  label="Group"
                  onChange={(event) => setGroup(event.target.value)}
                >
                  {Object.entries(groups).map(([key, aggregator]) => (
                    <MenuItem value={key} key={key}>
                      {aggregator.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl sx={{ mx: 1 }}>
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
              <FormControl sx={{ mx: 1 }}>
                <InputLabel>Value</InputLabel>
                <Select
                  size="small"
                  value={value}
                  label="Value"
                  onChange={(event) => setValue(event.target.value)}
                  disabled={["count", "cumCount"].includes(stat)}
                >
                  {Object.entries(values).map(([key, aggregator]) => (
                    <MenuItem value={key} key={key}>
                      {aggregator.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          }
        />
        <CardContent sx={{ width: 1, aspectRatio: 3 }}>
          <ResponsiveLine
            animate
            margin={{ top: 10, right: 20, bottom: 20, left: 40 }}
            curve="monotoneX"
            //enablePointLabel={false}
            useMesh={true}
            //enableSlices="x"
            //sliceTooltip={({ slice }) => JSON.stringify(slice)}
            isInteractive={true}
            tooltip={({ point }) => {
              console.log(point);
              return (
                <Chip
                  label={
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Typography sx={{ mr: 1 }}>
                        {timePeriods[timePeriod].format(point.data.xFormatted)}
                      </Typography>
                      <FontAwesomeIcon
                        fontSize="small"
                        icon={
                          categorySettings[
                            separateByYear ? point.serieId[0] : point.serieId
                          ].icon
                        }
                        color={
                          categorySettings[
                            separateByYear ? point.serieId[0] : point.serieId
                          ].color
                        }
                      />
                      <Divider orientation="vertical" flexItem />
                      <Typography sx={{ ml: 1 }}>
                        {stats[stat].format(point.data.y) + stats[stat].unit}
                      </Typography>
                    </Box>
                  }
                  variant="filled"
                />
              );
            }}
            //enablePoints={timePeriods[timePeriod].step == 1}
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
              //tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              format: timePeriods[timePeriod].format,
              tickValues: timePeriods[timePeriod].tickValues,
            }}
            axisLeft={{
              //tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: stat == "count" ? "#" : values[value].unit,
              format: stats[stat].format,
            }}
            colors={(d) =>
              addAlpha(
                d.color,
                yearAvg ||
                  d.id[1] == yearHigh ||
                  !timePeriods[timePeriod].relative
                  ? 1
                  : 0.15
              )
            }
            onClick={(d) => {
              console.log(d);
              setYearHigh(d.serieId[1]);
            }}
          />
        </CardContent>
      </Card>
    )
  );
}

export default function StatsView() {
  const statsContext = useContext(StatsContext);
  return (
    <Grid container spacing={2}>
      <Grid xs={12}>{statsContext.loaded && <YearlySummary />}</Grid>
    </Grid>
  );
}
