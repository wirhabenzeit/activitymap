import { IconButton, Link, Tooltip } from "@mui/material";
import { gridStringOrNumberComparator } from "@mui/x-data-grid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

import * as d3 from "d3";

import { LayerSAC } from "/src/components/LayerSAC";
import { LayerFriflyt } from "./components/LayerFriflyt";
import { LayerQuaeldich } from "/src/components/LayerQuaeldich";

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
  NorgesKart: {
    url: `https://opencache.statkart.no/gatekeeper/gk/gk.open_gmaps?layers=topo4&zoom={z}&x={x}&y={y}`,
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
  "Friflyt Routes": {
    overlay: true,
    visible: false,
    type: "custom",
    component: LayerFriflyt,
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
};

const usedTypes = Object.values(categorySettings).flatMap(
  (x) => x.alias
);

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
  return (num) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

const listSettings = (activityContext) => ({
  columns: [
    {
      field: "sport_type",
      headerName: "Type",
      description: "Sport type",
      renderHeader: (params) => (
        <Tooltip title="Sport type">
          <FontAwesomeIcon
            fontSize="small"
            icon="child-reaching"
          />
        </Tooltip>
      ),
      valueGetter: (value, row, column, apiRef) =>
        row.properties.sport_type,
      renderCell: (params) => (
        <Tooltip title={params.value}>
          <FontAwesomeIcon
            fontSize="small"
            icon={
              categorySettings[aliasMap[params.value]].icon
            }
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
      valueGetter: (value, row, column, apiRef) =>
        String(row.id),
    },
    {
      field: "name",
      headerName: "Name",
      flex: 2,
      minWidth: 150,
      valueGetter: (value, row, column, apiRef) => ({
        name: row.properties.name,
        id: row.id,
        type: row.properties.sport_type,
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
        gridStringOrNumberComparator(
          v1.name,
          v2.name,
          param1,
          param2
        ),
    },
    {
      field: "start_date_local_timestamp",
      headerName: "Day",
      flex: 1,
      minWidth: 80,
      renderHeader: (params) => (
        <Tooltip title="Start date">
          <FontAwesomeIcon
            fontSize="small"
            icon="calendar"
          />
        </Tooltip>
      ),
      type: "number",
      valueGetter: (value, row, column, apiRef) =>
        row.properties.start_date_local_timestamp,
      valueFormatter: (value, row, column, apiRef) =>
        new Date(value * 1000).toLocaleDateString("de-DE", {
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
      valueGetter: (value, row, column, apiRef) => {
        const date = new Date(
          row.properties.start_date_local
        );
        return (
          date.getHours() * 3600 +
          date.getMinutes() * 60 +
          date.getSeconds()
        );
      },
      valueFormatter: (value, row, column, apiRef) => {
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const seconds = value % 60;
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
          <FontAwesomeIcon
            fontSize="small"
            icon="stopwatch"
          />
        </Tooltip>
      ),
      field: "elapsed_time",
      flex: 1,
      minWidth: 60,
      valueGetter: (value, row, column, apiRef) =>
        Math.floor(row.properties.elapsed_time / 60),
      valueFormatter: (value, row, column, apiRef) =>
        Math.floor(value / 60) +
        "h" +
        String(value % 60).padStart(2, "0"),
      cellDataType: "number",
      type: "number",
    },
    {
      headerName: "Moving time",
      renderHeader: (params) => (
        <Tooltip title="Moving time">
          <FontAwesomeIcon
            fontSize="small"
            icon="stopwatch"
          />
        </Tooltip>
      ),
      field: "moving_time",
      flex: 1,
      minWidth: 60,
      valueGetter: (value, row, column, apiRef) =>
        Math.floor(row.properties.moving_time / 60),
      valueFormatter: (value, row, column, apiRef) =>
        Math.floor(value / 60) +
        "h" +
        String(value % 60).padStart(2, "0"),
      type: "number",
    },
    {
      field: "distance",
      renderHeader: (params) => (
        <Tooltip title="Distance">
          <FontAwesomeIcon
            fontSize="small"
            icon="ruler-horizontal"
          />
        </Tooltip>
      ),
      headerName: "Distance",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.distance / 1000,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("km", 1)(value),
    },
    {
      field: "average_speed",
      renderHeader: (params) => (
        <Tooltip title="Average speed">
          <FontAwesomeIcon
            fontSize="small"
            icon="tachometer-alt"
          />
        </Tooltip>
      ),
      headerName: "Avg Speed",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.average_speed,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("km/h", 1)(value * 3.6),
    },
    {
      field: "total_elevation_gain",
      renderHeader: (params) => (
        <Tooltip title="Elevation gain">
          <FontAwesomeIcon
            fontSize="small"
            icon="mountain"
          />
        </Tooltip>
      ),
      headerName: "Elev Gain",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.total_elevation_gain,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("m", 0)(value),
    },
    {
      field: "elev_high",
      renderHeader: (params) => (
        <Tooltip title="Elevation high">
          <FontAwesomeIcon
            fontSize="small"
            icon="mountain"
          />
        </Tooltip>
      ),
      headerName: "Elevation High",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.elev_high,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("m", 0)(value),
    },
    {
      field: "elev_low",
      renderHeader: (params) => (
        <Tooltip title="Elevation low">
          <FontAwesomeIcon
            fontSize="small"
            icon="mountain"
          />
          <span>:low</span>
        </Tooltip>
      ),
      headerName: "Elevation Low",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.elev_low,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("m", 0)(value),
    },
    {
      field: "weighted_average_watts",
      renderHeader: (params) => (
        <Tooltip title="Weighted average watts">
          <FontAwesomeIcon
            fontSize="small"
            icon="bolt-lightning"
          />
        </Tooltip>
      ),
      headerName: "Weighted Avg Watts",
      type: "number",
      flex: 1,
      minWidth: 60,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.weighted_average_watts,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("W")(value),
    },
    {
      field: "average_watts",
      renderHeader: (params) => (
        <Tooltip title="Average watts">
          <FontAwesomeIcon
            fontSize="small"
            icon="bolt-lightning"
          />
        </Tooltip>
      ),
      headerName: "Avg Watts",
      type: "number",
      flex: 1,
      minWidth: 60,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.average_watts,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("W")(value),
    },
    {
      field: "max_watts",
      renderHeader: (params) => (
        <Tooltip title="Max watts">
          <FontAwesomeIcon
            fontSize="small"
            icon="bolt-lightning"
          />
        </Tooltip>
      ),
      headerName: "Max Watts",
      type: "number",
      flex: 1,
      minWidth: 60,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.max_watts,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("W")(value),
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
      valueGetter: (value, row, column, apiRef) =>
        row.properties.average_heartrate,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("bpm")(value),
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
      valueGetter: (value, row, column, apiRef) =>
        row.properties.max_heartrate,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("bpm")(value),
    },
    {
      field: "kudos_count",
      renderHeader: (params) => (
        <Tooltip title="Kudos">
          <FontAwesomeIcon
            fontSize="small"
            icon="thumbs-up"
          />
        </Tooltip>
      ),
      headerName: "Kudos Count",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueGetter: (value, row, column, apiRef) =>
        row.properties.kudos_count,
      valueFormatter: (value, row, column, apiRef) =>
        decFormatter("")(value),
    },
    {
      field: "edit",
      headerName: "Edit Activity",
      width: 30,
      type: "number",
      sortable: false,
      align: "center",
      headerAlign: "center",
      valueGetter: (value, row, column, apiRef) => row.id,
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
      sortModel: [
        {
          field: "start_date_local_timestamp",
          sort: "desc",
        },
      ],
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
      sortModel: [
        {
          field: "start_date_local_timestamp",
          sort: "desc",
        },
      ],
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

const calendarSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance,
      format: (v) => (v / 1000).toFixed() + "km",
      label: "Distance",
      unit: "km",
      reducer: d3.sum,
      color: { scheme: "reds", type: "sqrt", ticks: 3 },
    },
    elevation: {
      id: "elevation",
      fun: (d) => d.total_elevation_gain,
      format: (v) => (v / 1.0).toFixed() + "m",
      label: "Elevation",
      unit: "km",
      reducer: d3.sum,
      color: { scheme: "reds", type: "sqrt", ticks: 3 },
    },
    time: {
      id: "time",
      fun: (d) => d.elapsed_time,
      format: (v) => (v / 3600).toFixed(1) + "h",
      label: "Duration",
      unit: "h",
      reducer: d3.sum,
      color: { scheme: "reds", type: "sqrt", ticks: 3 },
    },
    type: {
      id: "type",
      fun: (d) => aliasMap[d.sport_type],
      format: (l) =>
        l in categorySettings
          ? categorySettings[l].name
          : l,
      label: "Sport Type",
      unit: "",
      reducer: (v, fun) => {
        const set = new Set(v.map(fun));
        return set.size > 1
          ? "Multiple"
          : set.values().next().value;
      },
      color: {
        domain: [
          ...Object.keys(categorySettings),
          "Multiple",
        ],
        range: [
          ...Object.values(categorySettings).map(
            (x) => x.color
          ),
          "#aaa",
        ],
      },
    },
  },
};

const scatterSettings = {
  values: {
    distance: {
      id: "distance",
      fun: (d) => d.distance / 1000,
      format: (v) => v.toFixed() + "km",
      formatAxis: (v) => v.toFixed(),
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
      fun: (d) => d.elapsed_time / 3600,
      format: (v) => v.toFixed(1) + "h",
      formatAxis: (v) => v.toFixed(1),
      label: "Duration",
      unit: "h",
    },
    date: {
      id: "date",
      fun: (d) => d.date,
      formatAxis: (v) => d3.timeFormat("%b %Y")(v),
      format: (v) => d3.timeFormat("%Y-%m-%d")(v),
      label: "Date",
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

const timelineSettings = {
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
      format: (v) =>
        v >= 10_000
          ? (v / 1_000).toFixed() + "k"
          : v.toFixed(),
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
  },
  timePeriods: {
    year: {
      id: "year",
      label: "Year",
      tick: d3.utcYear,
      days: 365,
      tickFormat: "%Y",
      averaging: { min: 0, max: 0 },
    },
    month: {
      id: "month",
      label: "Month",
      tick: d3.utcMonth,
      days: 30,
      tickFormat: "%b %Y",
      averaging: { min: 0, max: 3 },
    },
    week: {
      id: "week",
      label: "Week",
      tick: d3.timeMonday,
      days: 7,
      tickFormat: "%Y-%m-%d",
      averaging: { min: 0, max: 12 },
    },
    day: {
      id: "day",
      label: "Day",
      tick: d3.timeDay,
      days: 1,
      tickFormat: "%Y-%m-%d",
      averaging: { min: 0, max: 90 },
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
  yScales: {
    linear: {
      id: "linear",
      label: "Linear",
      prop: {
        type: "linear",
      },
    },
    sqrt: {
      id: "sqrt",
      label: "Sqrt",
      prop: {
        type: "sqrt",
      },
    },
    cbrt: {
      id: "cbrt",
      label: "Cbrt",
      prop: {
        type: "pow",
        exponent: 1 / 3,
      },
    },
  },
};

const progressSettings = {
  values: {
    count: {
      id: "count",
      fun: (d) => 1,
      format: (v) => v,
      label: "Count",
      unit: "",
    },
    distance: {
      id: "distance",
      fun: (d) => Math.round(d.distance / 100) / 10,
      format: (v) =>
        v >= 10_000
          ? (v / 1_000).toFixed() + "k"
          : v < 10
          ? v.toFixed(1)
          : v.toFixed(),
      label: "Distance",
      unit: "km",
    },
    elevation: {
      id: "elevation",
      sortable: true,
      fun: (d) => Math.round(d.total_elevation_gain),
      format: (v) =>
        v >= 10_000
          ? (v / 1_000).toFixed() + "k"
          : v.toFixed(),
      label: "Elevation",
      unit: "m",
    },
    time: {
      id: "time",
      sortable: true,
      fun: (d) => Math.round(d.elapsed_time / 360) / 10,
      format: (v) => v.toFixed(1),
      label: "Duration",
      unit: "h",
    },
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
  calendarSettings,
  scatterSettings,
  progressSettings,
};
