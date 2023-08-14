import { Link, Tooltip } from "@mui/material";
import { gridStringOrNumberComparator } from "@mui/x-data-grid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

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
};

const categorySettings = {
  "BC & XC Ski": {
    color: "#1982C4",
    icon: "skiing-nordic",
    alias: ["BackcountrySki", "NordicSki", "RollerSki"],
    active: true,
  },
  "Walk / Run / Hike": {
    color: "#FF595E",
    icon: "walking",
    alias: [
      "Walk",
      "Run",
      "Hike",
      "TrailRun",
      "RockClimbing",
      "Snowshoe",
      "VirtualRun",
    ],
    active: true,
  },
  Ride: {
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
  "Alpine Ski": {
    color: "#3FA7D6",
    icon: "person-skiing",
    alias: ["AlpineSki", "Snowboard"],
    active: true,
  },
  Miscellaneous: {
    color: "#6A4C93",
    icon: "person-circle-question",
    alias: [
      "Canoeing",
      "Crossfit",
      "Elliptical",
      "Golf",
      "IceSkate",
      "InlineSkate",
      "Kayaking",
      "Kitesurf",
      "Rowing",
      "Sail",
      "Skateboard",
      "Soccer",
      "StairStepper",
      "StandUpPaddling",
      "Surfing",
      "Swim",
      "WeightTraining",
      "Wheelchair",
      "Windsurf",
      "Workout",
      "Yoga",
      "Badminton",
      "HighIntensityIntervalTraining",
      "Pickelball",
      "Pilates",
      "Racquetball",
      "Squash",
      "TableTennis",
      "Tennis",
      "VirtualRow",
    ],
    active: true,
  },
};

const colorMap = {};
const aliasMap = {};

Object.entries(categorySettings).forEach(([key, value]) => {
  value.alias.forEach((alias) => {
    colorMap[alias] = value.color;
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

const listSettings = {
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
      },
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
};
