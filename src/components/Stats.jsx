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
  Card,
  CardContent,
  Unstable_Grid2 as Grid,
} from "@mui/material";

import { aliasMap, categorySettings } from "../settings";
import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import { FilterContext } from "../contexts/FilterContext";

const addZeros = (val, min, max, step) => {
  val.sort((a, b) => a[0] - b[0]);
  const newVals = [];
  var cur = min;
  var ind = 0;
  while (cur <= max) {
    if (ind < val.length && cur == val[ind][0]) {
      newVals.push(val[ind]);
      ind += 1;
    } else {
      newVals.push([cur, 0]);
    }
    cur += step;
  }
  console.log(min, max, step, val, newVals);
  return newVals;
};

const cumSum = (val) => {
  val.sort((a, b) => a[0] - b[0]);
  return d3.zip(
    val.map(([x, y]) => x),
    d3.cumsum(val.map(([x, y]) => y))
  );
};

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

  const [timePeriod, setTimePeriod] = React.useState("month");
  const [yearAvg, setYearAvg] = React.useState(false);
  const [yearHigh, setYearHigh] = React.useState(new Date().getFullYear());
  const [stat, setStat] = React.useState("total");
  const [group, setGroup] = React.useState("sport_group");
  const [value, setValue] = React.useState("distance");

  const timePeriods = {
    year: {
      label: "Year",
      format: (v) => v,
      fun: (date) => date.getFullYear(),
      unit: "",
      step: 1,
      scale: "linear",
    },
    yearMonth: {
      label: "Year/Month",
      format: (v) => v,
      fun: (date) => date.getFullYear() + date.getMonth() / 12,
      unit: "",
      step: 1 / 12,
      scale: "linear",
    },
    month: {
      label: "Month",
      format: (v) =>
        new Date(2023, v, 1).toLocaleString("default", { month: "short" }),
      fun: (date) => date.getMonth(),
      relative: "year",
      occurrencesIn: (date, from, to) => occurrencesOfMonth(date, from, to),
      unit: "",
      step: 1,
      scale: "point",
    },
    week: {
      label: "Week",
      format: (v) => v,
      fun: (date) => parseInt(d3tf.timeFormat("%W")(date)),
      relative: "year",
      occurrencesIn: (date, from, to) => occurrencesOfWeek(date, from, to),
      unit: "",
      step: 1,
      scale: "linear",
    },
    day: {
      label: "Day",
      format: (v) =>
        new Date(Date.UTC(2017, 0, 2 + v)).toLocaleString("default", {
          weekday: "short",
        }),
      fun: (date) => (date.getDay() + 6) % 7,
      relative: "week",
      occurrencesIn: (date, from, to) => occurrencesOfDay(date, from, to),
      unit: "",
      step: 1,
      scale: "point",
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
  const extent = d3.extent(statsContext.data, (d) => d.date);
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
    },
    median: {
      label: "Median",
      format: values[value].format,
      fun: (v) => d3.median(v, values[value].fun),
    },
    min: {
      label: "Min",
      format: values[value].format,
      fun: (v) => d3.min(v, values[value].fun),
    },
    max: {
      label: "Max",
      format: values[value].format,
      fun: (v) => d3.max(v, values[value].fun),
    },
    count: {
      label: "Count",
      fun: (v) => v.length / normalizer(v[0].date),
      format: (v) =>
        timePeriods[timePeriod].relative ? v.toFixed(1) : v.toFixed(),
    },
    cumCount: {
      label: "Cumulative Count",
      fun: (v) => v.length / normalizer(v[0].date),
      format: (v) =>
        timePeriods[timePeriod].relative ? v.toFixed(1) : v.toFixed(),
      cumulative: true,
    },
    total: {
      label: "Total",
      format: values[value].format,
      fun: (v) => d3.sum(v, values[value].fun) / normalizer(v[0].date),
    },
    cumTotal: {
      label: "Cumulative Total",
      format: values[value].format,
      fun: (v) => d3.sum(v, values[value].fun) / normalizer(v[0].date),
      cumulative: true,
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
  var rollupData;
  const separateByYear = !yearAvg && timePeriods[timePeriod].relative;

  if (!yearAvg && timePeriods[timePeriod].relative) {
    rollupData = d3
      .rollups(
        inputData,
        stats[stat].fun,
        groups[group].fun,
        (f) => f.date.getFullYear(),
        (f) => timePeriods[timePeriod].fun(f.date)
      )
      .map(([sport, years]) =>
        years.map(([year, data]) => [[sport, year], data])
      )
      .flat();
  } else {
    rollupData = d3.rollups(
      inputData,
      stats[stat].fun,
      groups[group].fun,
      (f) => timePeriods[timePeriod].fun(f.date)
    );
  }

  const xRange = (year) => {
    const step = timePeriods[timePeriod].step;
    if (!timePeriods[timePeriod].relative)
      return [...extent.map(timePeriods[timePeriod].fun), step];
    if (yearAvg) return timePeriod == "month" ? [0, 11, step] : [0, 53, step];
    const range = d3t.timeDay
      .range(...extentInYear(year))
      .map(timePeriods[timePeriod].fun);
    return [Math.min(...range), Math.max(...range), step];
  };

  const data = rollupData.map(([id, data]) => ({
    id: id,
    color: separateByYear
      ? groups[group].color(id[0])
      : groups[group].color(id),
    data: (stats[stat].cumulative
      ? cumSum(data)
      : addZeros(data, ...xRange(separateByYear ? id[1] : id))
    ).map(([x, y]) => ({ x: x, y: y })),
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
                  disabled={stat in ["count", "cumCount"]}
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
        <CardContent sx={{ width: 1, aspectRatio: 2 }}>
          <ResponsiveLine
            animate
            margin={{ top: 20, right: 20, bottom: 50, left: 60 }}
            curve="monotoneX"
            enablePointLabel={false}
            useMesh={true}
            //enableSlices="x"
            //sliceTooltip={({ slice }) => JSON.stringify(slice)}
            isInteractive={true}
            enablePoints={timePeriods[timePeriod].step == 1}
            yFormat={stats[stat].format}
            data={data}
            xScale={{
              type: timePeriods[timePeriod].scale,
              min: "auto",
              max: "auto",
            }}
            axisBottom={{
              //tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              format: timePeriods[timePeriod].format,
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
