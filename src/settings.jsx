import { IconButton, Link, Tooltip } from "@mui/material";
import { gridStringOrNumberComparator } from "@mui/x-data-grid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

import * as d3t from "d3-time";
import * as d3 from "d3-array";
import * as d3tf from "d3-time-format";

import { scaleLog, scaleLinear, scaleSqrt } from "@visx/scale";

import { LayerSAC } from "/src/components/LayerSAC";
import { LayerQuaeldich } from "/src/components/LayerQuaeldich";
import { gaussianAvg, movingWindow } from "./components/StatsUtilities";

const stravaTypes = [
  "AlpineSki",
  "BackcountrySki",
  "Badminton",
  "Canoeing",
  "Crossfit",
  "EBikeRide",
  "Elliptical",
  "EMountainBikeRide",
  "Golf",
  "GravelRide",
  "Handcycle",
  "HighIntensityIntervalTraining",
  "Hike",
  "IceSkate",
  "InlineSkate",
  "Kayaking",
  "Kitesurf",
  "MountainBikeRide",
  "NordicSki",
  "Pickleball",
  "Pilates",
  "Racquetball",
  "Ride",
  "RockClimbing",
  "RollerSki",
  "Rowing",
  "Run",
  "Sail",
  "Skateboard",
  "Snowboard",
  "Snowshoe",
  "Soccer",
  "Squash",
  "StairStepper",
  "StandUpPaddling",
  "Surfing",
  "Swim",
  "TableTennis",
  "Tennis",
  "TrailRun",
  "Velomobile",
  "VirtualRide",
  "VirtualRow",
  "VirtualRun",
  "Walk",
  "WeightTraining",
  "Wheelchair",
  "Windsurf",
  "Workout",
  "Yoga",
];

const mapSettings = {
  "Mapbox Street": {
    url: "mapbox://styles/mapbox/streets-v12?optimize=true",
    type: "vector",
    visible: true,
    overlay: false,
  },
  "Mapbox Street 3D": {
    url: "mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Mapbox Outdoors": {
    url: "mapbox://styles/mapbox/outdoors-v12?optimize=true",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Mapbox Light": {
    url: "mapbox://styles/mapbox/light-v11?optimize=true",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Mapbox Topolight": {
    url: "mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Mapbox Dark": {
    url: "mapbox://styles/mapbox/dark-v11?optimize=true",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Mapbox Satellite": {
    url: "mapbox://styles/mapbox/satellite-v9?optimize=true",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Swisstopo Light": {
    url: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Swisstopo Satellite": {
    url: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte-imagery.vt/style.json",
    type: "vector",
    visible: false,
    overlay: false,
  },
  "Swisstopo Pixelkarte": {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`,
    type: "raster",
    visible: false,
    overlay: false,
  },
  "Swisstopo Winter": {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`,
    type: "raster",
    visible: false,
    overlay: false,
  },
  "SAC Tourenportal": {
    overlay: true,
    visible: false,
    type: "custom",
    component: LayerSAC,
  },
  "Quäldich Pässe": {
    overlay: true,
    visible: false,
    type: "custom",
    component: LayerQuaeldich,
  },
  "Swisstopo Ski": {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`,
    type: "raster",
    visible: false,
    opacity: 0.8,
    overlay: true,
  },
  "Swisstopo Slope": {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`,
    type: "raster",
    visible: false,
    opacity: 0.4,
    overlay: true,
  },
  Veloland: {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png`,
    type: "raster",
    visible: false,
    opacity: 0.4,
    overlay: true,
  },
  Wanderland: {
    url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png`,
    type: "raster",
    visible: false,
    opacity: 0.4,
    overlay: true,
  },
};

const defaultMapPosition = {
  zoom: 7,
  longitude: 8.5,
  latitude: 46.8,
  pitch: 0,
  bearing: 0,
  bbox: {
    _sw: { lng: 5.3, lat: 45.9 },
    _ne: { lng: 11.1, lat: 47.8 },
  },
};

var categorySettings = {
  bcXcSki: {
    name: "BC & XC Ski",
    color: "#1982C4",
    icon: "skiing-nordic",
    alias: ["BackcountrySki", "NordicSki", "RollerSki"],
    active: true,
  },
  trailHike: {
    name: "Trail / Hike",
    color: "#FF595E",
    icon: "walking",
    alias: ["Hike", "TrailRun", "RockClimbing", "Snowshoe"],
    active: true,
  },
  run: {
    name: "Run",
    color: "#FFCA3A",
    icon: "running",
    alias: ["Run", "VirtualRun"],
    active: true,
  },
  ride: {
    name: "Ride",
    color: "#8AC926",
    icon: "biking",
    alias: [
      "Ride",
      "VirtualRide",
      "GravelRide",
      "MountainBikeRide",
      "EBikeRide",
      "EMountainBikeRide",
      "Handcycle",
      "Velomobile",
    ],
    active: true,
  },
  /*"Alpine Ski": {
    color: "#3FA7D6",
    icon: "person-skiing",
    alias: ["AlpineSki", "Snowboard"],
    active: true,
  },*/
};

const usedTypes = Object.values(categorySettings).flatMap((x) => x.alias);

categorySettings.misc = {
  name: "Miscellaneous",
  color: "#6A4C93",
  icon: "person-circle-question",
  alias: stravaTypes.filter((x) => !usedTypes.includes(x)),
  active: true,
};

const colorMap = {};
const iconMap = {};
const aliasMap = {};

Object.entries(categorySettings).forEach(([key, value]) => {
  value.alias.forEach((alias) => {
    colorMap[alias] = value.color;
    iconMap[alias] = value.icon;
    aliasMap[alias] = key;
  });
});

const filterSettings = {
  start_date_local_timestamp: {
    icon: "calendar-days",
    tooltip: (value) =>
      new Date(value * 1000).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }),
    scale: (x) => 2 * x - x ** 2,
  },
  distance: {
    icon: "ruler-horizontal",
    tooltip: (value) => `${Math.round(value / 1000)}km`,
    scale: (x) => x ** 2,
  },
  total_elevation_gain: {
    icon: "ruler-vertical",
    tooltip: (value) => `${Math.round(value)}m`,
    scale: (x) => x ** 2,
  },
  elapsed_time: {
    icon: "stopwatch",
    tooltip: (value) => {
      const date = new Date(value * 1000);
      return `${date.getUTCHours()}h${date.getUTCMinutes()}`;
    },
    scale: (x) => x ** 2,
  },
};

const binaryFilters = {
  commute: {
    icon: "briefcase",
    label: "Commutes",
    defaultValue: undefined,
  },
};

function decFormatter(unit = "", decimals = 0) {
  return (num) => (num == undefined ? null : num.toFixed(decimals) + unit);
}

const listSettings = (activityContext) => ({
  columns: [
    {
      field: "sport_type",
      headerName: "Type",
      description: "Sport type",
      renderHeader: (params) => (
        <Tooltip title="Sport type">
          <FontAwesomeIcon fontSize="small" icon="child-reaching" />
        </Tooltip>
      ),
      valueGetter: (params) => params.row.properties.sport_type,
      renderCell: (params) => (
        <Tooltip title={params.value}>
          <FontAwesomeIcon
            fontSize="small"
            icon={categorySettings[aliasMap[params.value]].icon}
            color={colorMap[params.value]}
          />
        </Tooltip>
      ),
      width: 60,
    },
    {
      field: "id",
      headerName: "ID",
      flex: 1,
      minWidth: 60,
      valueGetter: (params) => String(params.row.id),
    },
    {
      field: "name",
      headerName: "Name",
      flex: 2,
      minWidth: 150,
      valueGetter: (params) => ({
        name: params.row.properties.name,
        id: params.row.id,
        type: params.row.properties.sport_type,
      }),
      renderCell: (params) => (
        <Link
          href={`https://www.strava.com/activities/${params.value.id}`}
          target="_blank"
          rel="noreferrer"
        >
          {params.value.name}
        </Link>
      ),
      sortComparator: (v1, v2, param1, param2) =>
        gridStringOrNumberComparator(v1.name, v2.name, param1, param2),
    },
    {
      field: "start_date_local_timestamp",
      headerName: "Day",
      flex: 1,
      minWidth: 80,
      renderHeader: (params) => (
        <Tooltip title="Start date">
          <FontAwesomeIcon fontSize="small" icon="calendar" />
        </Tooltip>
      ),
      type: "number",
      valueGetter: (params) => params.row.properties.start_date_local_timestamp,
      valueFormatter: (params) =>
        new Date(params.value * 1000).toLocaleDateString("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        }),
    },
    {
      field: "time",
      headerName: "Start time",
      flex: 1,
      minWidth: 60,
      renderHeader: (params) => (
        <Tooltip title="Start time">
          <FontAwesomeIcon fontSize="small" icon="clock" />
        </Tooltip>
      ),
      valueGetter: (params) => {
        const date = new Date(params.row.properties.start_date_local);
        return (
          date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
        );
      },
      valueFormatter: (params) => {
        const hours = Math.floor(params.value / 3600);
        const minutes = Math.floor((params.value % 3600) / 60);
        const seconds = params.value % 60;
        return (
          String(hours).padStart(2, "0") +
          ":" +
          String(minutes).padStart(2, "0")
        );
      },
      type: "number",
    },
    {
      headerName: "Elapsed time",
      renderHeader: (params) => (
        <Tooltip title="Elapsed time">
          <FontAwesomeIcon fontSize="small" icon="stopwatch" />
        </Tooltip>
      ),
      field: "elapsed_time",
      flex: 1,
      minWidth: 60,
      valueGetter: (params) =>
        Math.floor(params.row.properties.elapsed_time / 60),
      valueFormatter: (params) =>
        Math.floor(params.value / 60) +
        "h" +
        String(params.value % 60).padStart(2, "0"),
      cellDataType: "number",
      type: "number",
    },
    {
      headerName: "Moving time",
      renderHeader: (params) => (
        <Tooltip title="Moving time">
          <FontAwesomeIcon fontSize="small" icon="stopwatch" />
        </Tooltip>
      ),
      field: "moving_time",
      flex: 1,
      minWidth: 60,
      valueGetter: (params) =>
        Math.floor(params.row.properties.moving_time / 60),
      valueFormatter: (params) =>
        Math.floor(params.value / 60) +
        "h" +
        String(params.value % 60).padStart(2, "0"),
      type: "number",
    },
    {
      field: "distance",
      renderHeader: (params) => (
        <Tooltip title="Distance">
          <FontAwesomeIcon fontSize="small" icon="ruler-horizontal" />
        </Tooltip>
      ),
      headerName: "Distance",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueGetter: (params) => params.row.properties.distance / 1000,
      valueFormatter: (params) => decFormatter("km", 1)(params.value),
    },
    {
      field: "average_speed",
      renderHeader: (params) => (
        <Tooltip title="Average speed">
          <FontAwesomeIcon fontSize="small" icon="tachometer-alt" />
        </Tooltip>
      ),
      headerName: "Avg Speed",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (params) => params.row.properties.average_speed,
      valueFormatter: (params) => decFormatter("km/h", 1)(params.value * 3.6),
    },
    {
      field: "total_elevation_gain",
      renderHeader: (params) => (
        <Tooltip title="Elevation gain">
          <FontAwesomeIcon fontSize="small" icon="mountain" />
        </Tooltip>
      ),
      headerName: "Elev Gain",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (params) => params.row.properties.total_elevation_gain,
      valueFormatter: (params) => decFormatter("m", 0)(params.value),
    },
    {
      field: "elev_high",
      renderHeader: (params) => (
        <Tooltip title="Elevation high">
          <FontAwesomeIcon fontSize="small" icon="mountain" />
        </Tooltip>
      ),
      headerName: "Elevation High",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (params) => params.row.properties.elev_high,
      valueFormatter: (params) => decFormatter("m", 0)(params.value),
    },
    {
      field: "elev_low",
      renderHeader: (params) => (
        <Tooltip title="Elevation low">
          <FontAwesomeIcon fontSize="small" icon="mountain" />
          <span>:low</span>
        </Tooltip>
      ),
      headerName: "Elevation Low",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (params) => params.row.properties.elev_low,
      valueFormatter: (params) => decFormatter("m", 0)(params.value),
    },
    {
      field: "weighted_average_watts",
      renderHeader: (params) => (
        <Tooltip title="Weighted average watts">
          <FontAwesomeIcon fontSize="small" icon="bolt-lightning" />
        </Tooltip>
      ),
      headerName: "Weighted Avg Watts",
      type: "number",
      flex: 1,
      minWidth: 60,
      valueGetter: (params) => params.row.properties.weighted_average_watts,
      valueFormatter: (params) => decFormatter("W")(params.value),
    },
    {
      field: "average_watts",
      renderHeader: (params) => (
        <Tooltip title="Average watts">
          <FontAwesomeIcon fontSize="small" icon="bolt-lightning" />
        </Tooltip>
      ),
      headerName: "Avg Watts",
      type: "number",
      flex: 1,
      minWidth: 60,
      valueGetter: (params) => params.row.properties.average_watts,
      valueFormatter: (params) => decFormatter("W")(params.value),
    },
    {
      field: "max_watts",
      renderHeader: (params) => (
        <Tooltip title="Max watts">
          <FontAwesomeIcon fontSize="small" icon="bolt-lightning" />
        </Tooltip>
      ),
      headerName: "Max Watts",
      type: "number",
      flex: 1,
      minWidth: 60,
      valueGetter: (params) => params.row.properties.max_watts,
      valueFormatter: (params) => decFormatter("W")(params.value),
    },
    {
      field: "average_heartrate",
      renderHeader: (params) => (
        <Tooltip title="Average heartrate">
          <FontAwesomeIcon fontSize="small" icon="heart" />
        </Tooltip>
      ),
      headerName: "Avg Heartrate",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueGetter: (params) => params.row.properties.average_heartrate,
      valueFormatter: (params) => decFormatter("bpm")(params.value),
    },
    {
      field: "max_heartrate",
      renderHeader: (params) => (
        <Tooltip title="Max heartrate">
          <FontAwesomeIcon fontSize="small" icon="heart" />
        </Tooltip>
      ),
      headerName: "Max Heartrate",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueGetter: (params) => params.row.properties.max_heartrate,
      valueFormatter: (params) => decFormatter("bpm")(params.value),
    },
    {
      field: "kudos_count",
      renderHeader: (params) => (
        <Tooltip title="Kudos">
          <FontAwesomeIcon fontSize="small" icon="thumbs-up" />
        </Tooltip>
      ),
      headerName: "Kudos Count",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueGetter: (params) => params.row.properties.kudos_count,
      valueFormatter: (params) => decFormatter("")(params.value),
    },
    {
      field: "edit",
      headerName: "Edit Activity",
      width: 30,
      type: "number",
      sortable: false,
      align: "center",
      headerAlign: "center",
      valueGetter: (params) => params.row.id,
      renderHeader: (params) => (
        <Tooltip title="Edit Activity">
          <FontAwesomeIcon fontSize="small" icon="edit" />
        </Tooltip>
      ),
      renderCell: (params) => (
        <IconButton
          onClick={() =>
            console.log(
              activityContext.reloadActivity(
                params.row.properties.athlete,
                params.row.properties.id
              )
            )
          }
        >
          <FontAwesomeIcon fontSize="small" icon="rotate" />
        </IconButton>
      ),
    },
  ],
  defaultState: {
    compact: {
      sortModel: [{ field: "start_date_local_timestamp", sort: "desc" }],
      columnVisibilityModel: {
        type: false,
        id: false,
        time: false,
        max_watts: false,
        moving_time: false,
        elev_high: false,
        elev_low: false,
        max_heartrate: false,
        max_power: false,
        average_watts: false,
        weighted_average_watts: false,
        average_heartrate: false,
        edit: false,
        kudos_count: false,
        average_speed: false,
      },
    },
    full: {
      sortModel: [{ field: "start_date_local_timestamp", sort: "desc" }],
      columnVisibilityModel: {
        id: false,
        time: false,
        max_watts: false,
        moving_time: false,
        elev_high: false,
        elev_low: false,
        max_heartrate: false,
        max_power: false,
        average_watts: false,
        edit: false,
        kudos_count: false,
        average_speed: false,
      },
    },
  },
});

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

const calendarSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance,
      format: (v) => (v / 1000).toFixed() + "km",
      label: "Distance",
      unit: "km",
      maxValue: 100_000,
    },
    elevation: {
      id: "elevation",
      fun: (d) => d.total_elevation_gain,
      format: (v) => (v / 1.0).toFixed() + "m",
      label: "Elevation",
      unit: "km",
      maxValue: 2_000,
    },
    time: {
      id: "time",
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed(1) + "h",
      label: "Duration",
      unit: "h",
      maxValue: 5 * 3600,
    },
  },
};

const scatterSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance,
      format: (v) => (v / 1000).toFixed() + "km",
      formatAxis: (v) => (v / 1000).toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      fun: (d) => d.total_elevation_gain,
      format: (v) => (v / 1.0).toFixed() + "m",
      formatAxis: (v) => (v / 1.0).toFixed(),
      label: "Elevation",
      unit: "km",
    },
    time: {
      id: "time",
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed(1) + "h",
      formatAxis: (v) => (v / 3600).toFixed(1),
      label: "Duration",
      unit: "h",
    },
    date: {
      id: "date",
      fun: (d) => d.start_date_local_timestamp,
      formatAxis: (v) => d3tf.timeFormat("%b %Y")(new Date(v * 1000)),
      format: (v) => d3tf.timeFormat("%Y-%m-%d")(new Date(v * 1000)),
      label: "Date",
      unit: "",
    },
    kudos_count: {
      id: "kudos_count",
      fun: (d) => d.kudos_count,
      format: (v) => v,
      formatAxis: (v) => v,
      label: "Kudos",
      unit: "",
    },
    average_speed: {
      id: "average_speed",
      fun: (d) => d.average_speed,
      format: (v) => (v * 3.6).toFixed(1) + "km/h",
      formatAxis: (v) => (v * 3.6).toFixed(1),
      label: "Avg Speed",
      unit: "km/h",
    },
  },
  groups: {
    sport_group: {
      id: "sport_group",
      fun: (d) => aliasMap[d.sport_type],
      color: (id) => categorySettings[id].color,
      icon: (id) => categorySettings[id].icon,
      label: "Group",
    },
  },
  color: (type) => categorySettings[type].color,
};

const mapStatSettings = {
  values: {
    count: {
      id: "count",
      fun: (v) => v.length,
      label: "Count",
      unit: "",
    },
    distance: {
      id: "distance",
      fun: (v) => d3.sum(v, (d) => d.distance),
      format: (v) => (v / 1000).toFixed() + "km",
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      fun: (v) => d3.sum(v, (d) => d.total_elevation_gain),
      format: (v) => (v / 1_000).toFixed() + "km",
      label: "Elevation",
      unit: "km",
    },
    time: {
      id: "time",
      fun: (v) => d3.sum(v, (d) => d.elapsed_time),
      format: (v) => (v / 3600).toFixed() + "h",
      label: "Duration",
      unit: "h",
    },
    kudos_count: {
      id: "kudos_count",
      fun: (v) => d3.sum(v, (d) => d.kudos_count),
      format: (v) => v,
      label: "Kudos",
      unit: "",
    },
  },
  timeGroups: {
    all: (year) => ({
      id: "all",
      filter: (d) => true,
      selected: year,
      label: "All",
    }),
    byYear: (year) => ({
      id: "year",
      filter: (d) => d.date.getFullYear() == year,
      selected: year,
      highlight: year,
      label: year,
    }),
  },
};

const boxSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance,
      format: (v) => (v / 1000).toFixed() + "km",
      formatAxis: (v) => (v / 1000).toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      fun: (d) => d.total_elevation_gain,
      format: (v) => v.toFixed() + "m",
      formatAxis: (v) => v.toFixed(),
      label: "Elevation",
      unit: "m",
    },
    time: {
      id: "time",
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed() + "h",
      formatAxis: (v) => (v / 3600).toFixed(),
      label: "Duration",
      unit: "h",
    },
    average_speed: {
      id: "average_speed",
      fun: (d) => d.average_speed,
      format: (v) => (v * 3.6).toFixed(1) + "km/h",
      formatAxis: (v) => (v * 3.6).toFixed(1),
      label: "Avg Speed",
      unit: "km/h",
    },
    kudos_count: {
      id: "kudos_count",
      fun: (v) => d3.sum(v, (d) => d.kudos_count),
      format: (v) => v,
      formatAxis: (v) => v,
      label: "Kudos",
      unit: "",
    },
  },
  mainGroups: {
    sport_group: {
      id: "sport_group",
      fun: (d) => aliasMap[d.sport_type],
      color: (id) => categorySettings[id].color,
      label: "Group",
    },
    sport_type: {
      id: "sport_type",
      fun: (d) => d.sport_type,
      color: (id) => colorMap[id],
      label: "Type",
    },
    no_group: {
      id: "no_group",
      fun: (d) => undefined,
      color: (id) => "#eeeeee",
      label: "All sports",
    },
  },
  secondaryGroups: {
    year: {
      id: "year",
      fun: (d) => d.date.getFullYear(),
      format: (v) => v,
      label: "Year",
    },
    month: {
      id: "month",
      fun: (d) => d.date.getMonth(),
      format: (v) => d3tf.timeFormat("%b")(new Date(0, v)),
      label: "Month",
    },
    weekday: {
      id: "weekday",
      fun: (d) => (d.date.getDay() + 6) % 7,
      format: (v) => d3tf.timeFormat("%a")(new Date(2018, 0, 1 + v)),
      label: "Weekday",
    },
    no_group: {
      id: "no_group",
      fun: (d) => undefined,
      format: (v) => "",
      label: "All times",
    },
  },
};

const violinSettings = {
  color: (v) => colorMap[v.sport_type],
  icon: (v) => categorySettings[aliasMap[v.sport_type]].icon,
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance / 1000,
      format: (v) => (v / 1.0).toFixed() + "km",
      formatAxis: (v) => (v / 1.0).toFixed(),
      label: "Distance",
      unit: "km",
      minValue: 1,
    },
    elevation: {
      id: "elevation",
      fun: (d) => d.total_elevation_gain,
      format: (v) => v.toFixed() + "m",
      formatAxis: (v) => v.toFixed(),
      label: "Elevation",
      unit: "m",
      minValue: 10,
    },
    time: {
      id: "time",
      fun: (d) => d.elapsed_time / 3600,
      format: (v) => (v / 1.0).toFixed(1) + "h",
      formatAxis: (v) => (v / 1.0).toFixed(v > 1 ? 0 : 1),
      label: "Duration",
      unit: "h",
      minValue: 0.2,
    },
    average_speed: {
      id: "average_speed",
      fun: (d) => d.average_speed * 3.6,
      format: (v) => (v * 1.0).toFixed(0) + "km/h",
      formatAxis: (v) => (v * 1.0).toFixed(0),
      label: "Avg Speed",
      unit: "km/h",
      minValue: 1,
      maxValue: 50,
    },
    /*kudos_count: {
      id: "kudos_count",
      fun: (d) => d.kudos_count + 1,
      format: (v) => v - 1,
      formatAxis: (v) => v - 1,
      label: "Kudos",
      unit: "",
      minValue: 1,
      tickValues: [1, 2, 3, 6, 11, 21],
      discrete: true,
    },*/
  },
  groups: {
    sport_group: {
      id: "sport_group",
      fun: (d) => aliasMap[d.sport_type],
      format: (v) => categorySettings[v].name,
      label: "Group",
      icon: (id) => categorySettings[id].icon,
      color: (id) => categorySettings[id].color,
    },
    sport_type: {
      id: "sport_type",
      fun: (d) => d.sport_type,
      format: (v) => v,
      label: "Type",
      icon: (id) => categorySettings[aliasMap[id]].icon,
      color: (id) => colorMap[id],
    },
    year: {
      id: "year",
      fun: (d) => d.date.getFullYear(),
      format: (v) => v,
      label: "Year",
      icon: () => "child-reaching",
      color: () => "#eeeeee",
    },
    month: {
      id: "month",
      fun: (d) => d.date.getMonth(),
      format: (v) => d3tf.timeFormat("%b")(new Date(0, v)),
      label: "Month",
      icon: () => "child-reaching",
      color: () => "#eeeeee",
    },
    weekday: {
      id: "weekday",
      fun: (d) => (d.date.getDay() + 6) % 7,
      format: (v) => d3tf.timeFormat("%a")(new Date(2018, 0, 1 + v)),
      label: "Weekday",
      icon: () => "child-reaching",
      color: () => "#eeeeee",
    },
  },
  scaleYs: {
    log: {
      id: "log",
      label: "Log",
      scale: (props) =>
        scaleLog({ ...props, base: 10, nice: true, clamp: true }),
      ticks: (scale) =>
        scale.ticks().filter((d, i) => [0, 1, 4].includes(i % 9)),
    },
    linear: {
      id: "linear",
      label: "Linear",
      scale: (props) => scaleLinear({ ...props, nice: true }),
      ticks: (scale) => scale.ticks(),
    },
    sqrt: {
      id: "sqrt",
      label: "Sqrt",
      scale: (props) => scaleSqrt({ ...props, nice: true }),
      ticks: (scale) => scale.ticks(),
    },
  },
};

const pieSettings = {
  values: {
    count: {
      id: "count",
      fun: (v) => v.length,
      label: "Count",
      unit: "",
    },
    distance: {
      id: "distance",
      fun: (v) => d3.sum(v, (d) => d.distance),
      format: (v) => (v / 1000).toFixed() + "km",
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      fun: (v) => d3.sum(v, (d) => d.total_elevation_gain),
      format: (v) => (v / 1_000).toFixed() + "km",
      label: "Elevation",
      unit: "km",
    },
    time: {
      id: "time",
      fun: (v) => d3.sum(v, (d) => d.elapsed_time),
      format: (v) => (v / 3600).toFixed() + "h",
      label: "Duration",
      unit: "h",
    },
    kudos_count: {
      id: "kudos_count",
      fun: (v) => d3.sum(v, (d) => d.kudos_count),
      format: (v) => v,
      label: "Kudos",
      unit: "",
    },
  },
  groups: {
    sport_group: {
      id: "sport_group",
      fun: (d) => aliasMap[d.sport_type],
      color: (id) => categorySettings[id].color,
      icon: (id) => categorySettings[id].icon,
      label: "Group",
      sort: (v1, v2) => d3.ascending(v1[0], v2[0]),
    },
    sport_type: {
      id: "sport_type",
      fun: (d) => d.sport_type,
      color: (id) => colorMap[id],
      icon: (id) => categorySettings[aliasMap[id]].icon,
      label: "Type",
      sort: (v1, v2) =>
        d3.ascending(aliasMap[v1[0]], aliasMap[v2[0]]) ||
        d3.descending(v1[1], v2[1]),
    },
  },
  timeGroups: {
    all: (year) => ({
      id: "all",
      filter: (d) => true,
      selected: year,
      label: "All",
    }),
    byYear: (year) => ({
      id: "year",
      filter: (d) => d.date.getFullYear() == year,
      selected: year,
      highlight: year,
      label: year,
    }),
  },
};

const timelineSettings = {
  timePeriods: {
    year: {
      id: "year",
      label: "Year",
      format: (v) => new Date(v).getFullYear(),
      fun: (date) => d3t.timeYear.floor(date),
      range: (extent) =>
        d3t.timeYear.range(
          d3t.timeYear.floor(extent[0]),
          d3t.timeYear.ceil(extent[1])
        ),
      occurrencesIn: () => 1,
      enablePoints: true,
    },
    yearMonth: {
      id: "yearMonth",
      label: "Year/Month",
      format: (v) => d3tf.timeFormat("%y/%m")(new Date(v)),
      fun: (date) => d3t.timeMonth.floor(date),
      range: (extent) =>
        d3t.timeMonth.range(
          d3t.timeMonth.floor(extent[0]),
          d3t.timeMonth.ceil(extent[1])
        ),
      occurrencesIn: () => 1,
      enablePoints: false,
    },
    month: {
      id: "month",
      label: "Month",
      format: (v) => d3tf.timeFormat("%b")(new Date(v)),
      tickValues: "every 1 month",
      fun: (date) => {
        const newDate = d3t.timeMonth.floor(date);
        newDate.setFullYear(2018);
        return newDate;
      },
      relative: true,
      range: (extent) =>
        d3t.timeMonth.range(
          ...extent.map((date) =>
            d3t.timeMonth.floor(new Date(d3tf.timeFormat("2018-%m-%d")(date)))
          )
        ),
      occurrencesIn: (date, from, to) => occurrencesOfMonth(date, from, to),
      enablePoints: true,
    },
    week: {
      id: "week",
      label: "Week",
      format: (v) => d3tf.timeFormat("%b-%d")(new Date(v)),
      tickValues: "every 1 month",
      fun: (date) => {
        const newDate = d3t.timeDay.floor(date);
        newDate.setFullYear(2018);
        return d3t.timeMonday.floor(newDate);
      },
      relative: true,
      range: (extent) =>
        d3t.timeMonday.range(
          ...extent.map((date) =>
            d3t.timeMonday.floor(new Date(d3tf.timeFormat("2018-%m-%d")(date)))
          )
        ),
      occurrencesIn: (date, from, to) => occurrencesOfWeek(date, from, to),
      enablePoints: false,
    },
    day: {
      id: "day",
      label: "Weekday",
      format: (v) =>
        new Date(v).toLocaleString("default", {
          weekday: "short",
        }),
      fun: (date) => new Date(2018, 0, 1 + ((date.getDay() + 6) % 7)),
      relative: true,
      range: () =>
        d3t.timeDay.range(new Date(2018, 0, 1), new Date(2018, 0, 8)),
      occurrencesIn: (date, from, to) => occurrencesOfDay(date, from, to),
      enablePoints: true,
    },
  },
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance,
      format: (v) =>
        v >= 10_000_000
          ? (v / 1_000_000).toFixed() + "k"
          : (v / 1000).toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      fun: (d) => d.total_elevation_gain,
      format: (v) => (v >= 10_000 ? (v / 1_000).toFixed() + "k" : v.toFixed()),
      label: "Elevation",
      unit: "m",
    },
    time: {
      id: "time",
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed(1),
      label: "Duration",
      unit: "h",
    },
    kudos_count: {
      id: "kudos_count",
      fun: (d) => d.kudos_count,
      format: (v) => v,
      label: "Kudos",
      unit: "",
    },
  },
  groups: {
    sport_group: {
      id: "sport_group",
      label: "Group",
      fun: (d) => aliasMap[d.sport_type],
      color: (id) => categorySettings[id].color,
      icon: (id) => categorySettings[id].icon,
    },
    sport_type: {
      id: "sport_type",
      label: "Type",
      fun: (d) => d.sport_type,
      color: (id) => categorySettings[aliasMap[id]].color,
      icon: (id) => categorySettings[aliasMap[id]].icon,
    },
    no_group: {
      id: "no_group",
      label: "All",
      fun: (d) => undefined,
      color: (id) => "#000000",
      icon: (id) => "child-reaching",
    },
  },
  timeGroups: {
    all: (year) => ({
      id: "all",
      fun: (d) => undefined,
      selected: year,
      extent: (date, extent) => extent,
      label: "Avg",
    }),
    byYear: (year) => ({
      id: "byYear",
      fun: (d) => d.date.getFullYear(),
      highlight: year,
      selected: year,
      extent: (date, extent) => {
        return [
          date.getFullYear() == extent[0].getFullYear()
            ? extent[0]
            : new Date(date.getFullYear(), 0, 1),
          date.getFullYear() == extent[1].getFullYear()
            ? extent[1]
            : new Date(date.getFullYear(), 11, 31),
        ];
      },
      label: year,
    }),
  },
  stats: (props) => ({
    avg: {
      id: "avg",
      label: "Average",
      fun: (v) => d3.mean(v, props.value.fun),
      format: props.value.format,
      unit: props.value.unit,
    },
    median: {
      id: "median",
      label: "Median",
      format: props.value.format,
      fun: (v) => d3.median(v, props.value.fun),
      unit: props.value.unit,
    },
    min: {
      id: "min",
      label: "Min",
      format: props.value.format,
      fun: (v) => d3.min(v, props.value.fun),
      unit: props.value.unit,
    },
    max: {
      id: "max",
      label: "Max",
      format: props.value.format,
      fun: (v) => d3.max(v, props.value.fun),
      unit: props.value.unit,
    },
    count: {
      id: "count",
      label: "Count",
      fun: (v) =>
        v.length /
        props.timePeriod.occurrencesIn(
          v[0].date,
          ...props.timeGroup.extent(v[0].date, props.extent)
        ),
      format: (v) => (props.timePeriod.relative ? v.toFixed(1) : v.toFixed()),
      unit: "",
    },
    cumCount: {
      id: "cumCount",
      label: "Cumulative Count",
      fun: (v) =>
        v.length /
        props.timePeriod.occurrencesIn(
          v[0].date,
          ...props.timeGroup.extent(v[0].date, props.extent)
        ),
      format: (v) => v.toFixed(1),
      cumulative: true,
      unit: "",
    },
    total: {
      id: "total",
      label: "Total",
      format: props.value.format,
      fun: (v) =>
        d3.sum(v, props.value.fun) /
        props.timePeriod.occurrencesIn(
          v[0].date,
          ...props.timeGroup.extent(v[0].date, props.extent)
        ),
      unit: props.value.unit,
    },
    cumTotal: {
      id: "cumTotal",
      label: "Cumulative Total",
      format: props.value.format,
      fun: (v) =>
        d3.sum(v, props.value.fun) /
        props.timePeriod.occurrencesIn(
          v[0].date,
          ...props.timeGroup.extent(v[0].date, props.extent)
        ),
      cumulative: true,
      unit: props.value.unit,
    },
  }),
};

const timelineSettingsVisx = {
  values: {
    count: {
      id: "count",
      fun: (d) => 1,
      sortable: false,
      format: (v) => v,
      label: "Count",
      unit: "",
    },
    distance: {
      id: "distance",
      fun: (d) => d.distance,
      sortable: true,
      format: (v) =>
        v >= 10_000_000
          ? (v / 1_000_000).toFixed() + "k"
          : v < 10_000
          ? (v / 1000).toFixed(1)
          : (v / 1000).toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      sortable: true,
      fun: (d) => d.total_elevation_gain,
      format: (v) => (v >= 10_000 ? (v / 1_000).toFixed() + "k" : v.toFixed()),
      label: "Elevation",
      unit: "m",
    },
    time: {
      id: "time",
      sortable: true,
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed(1),
      label: "Duration",
      unit: "h",
    },
    kudos_count: {
      id: "kudos_count",
      sortable: true,
      fun: (d) => d.kudos_count,
      format: (v) => v,
      label: "Kudos",
      unit: "",
    },
  },
  timePeriods: {
    year: {
      id: "year",
      label: "Year",
      tick: d3t.timeYear,
      days: 365,
      format: (v) => new Date(v).getFullYear(),
      averaging: {
        disabled: true,
        valueLabelFormat: (v) => "",
        min: 0,
        max: 1,
      },
    },
    month: {
      id: "month",
      label: "Month",
      tick: d3t.timeMonth,
      days: 30,
      format: (v) => d3tf.timeFormat("%Y-%m")(new Date(v)),
      averaging: {
        disabled: false,
        valueLabelFormat: (v) => "±" + v + " months",
        min: 0,
        max: 2,
      },
    },
    week: {
      id: "week",
      label: "Week",
      tick: d3t.timeMonday,
      days: 7,
      format: (v) => d3tf.timeFormat("%Y, %U")(new Date(v)),
      averaging: {
        disabled: false,
        valueLabelFormat: (v) => "±" + v + " weeks",
        min: 0,
        max: 8,
      },
    },
    day: {
      id: "day",
      label: "Day",
      tick: d3t.timeDay,
      days: 1,
      format: (v) => d3tf.timeFormat("%Y-%m-%d")(new Date(v)),
      averaging: {
        disabled: false,
        valueLabelFormat: (v) => "±" + v + " days",
        min: 0,
        max: 60,
      },
    },
  },
  groups: {
    sport_group: {
      id: "sport_group",
      label: "Type",
      fun: (d) => aliasMap[d.sport_type],
      color: (id) => categorySettings[id].color,
      icon: (id) => categorySettings[id].icon,
    },
    /*sport_type: {
      id: "sport_type",
      label: "Type",
      fun: (d) => d.sport_type,
      color: (id) => categorySettings[aliasMap[id]].color,
      icon: (id) => categorySettings[aliasMap[id]].icon,
    },*/
    no_group: {
      id: "no_group",
      label: "All",
      fun: (d) => "All",
      color: (id) => "#000000",
      icon: (id) => "child-reaching",
    },
  },
  averages: {
    movingAvg: (N) => ({
      id: "movingAvg",
      label: "Moving Average",
      window: N,
      fun: movingWindow(N),
    }),
    gaussianAvg: (N) => ({
      id: "gaussianAvg",
      label: "Gaussian Average",
      window: N,
      fun: gaussianAvg(N),
    }),
  },
};

export {
  mapSettings,
  defaultMapPosition,
  categorySettings,
  filterSettings,
  binaryFilters,
  listSettings,
  aliasMap,
  colorMap,
  iconMap,
  timelineSettings,
  pieSettings,
  calendarSettings,
  scatterSettings,
  mapStatSettings,
  boxSettings,
  violinSettings,
  timelineSettingsVisx,
};
