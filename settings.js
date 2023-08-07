import { Link } from "@mui/material";
import { gridStringOrNumberComparator } from "@mui/x-data-grid";

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
    alias: ["Walk", "Run", "Hike", "RockClimbing", "Snowshoe", "VirtualRun"],
    active: true,
  },
  Ride: {
    color: "#8AC926",
    icon: "biking",
    alias: ["Ride", "VirtualRide", "EBikeRide", "Handcycle", "Velomobile"],
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
    ],
    active: true,
  },
};

const colorMap = {};

Object.entries(categorySettings).forEach(([key, value]) => {
  value.alias.forEach((alias) => {
    colorMap[alias] = value.color;
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

function decFormatter(unit = "", decimals = 0) {
  return (num) => (num == undefined ? null : num.toFixed(decimals) + unit);
}

const listSettings = {
  columns: [
    {
      field: "type",
      headerName: "Type",
      valueGetter: (params) => params.row.properties.type,
      flex: 1,
      minWidth: 60,
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
        type: params.row.properties.type,
      }),
      renderCell: (params) => (
        <Link
          href={`https://www.strava.com/activities/${params.value.id}`}
          target="_blank"
          rel="noreferrer"
          sx={{ color: colorMap[params.value.type] }}
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
      renderHeader: (params) => <i className="fa-solid fa-calendar"></i>,
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
      renderHeader: (params) => <i className="fa-solid fa-clock"></i>,
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
        <>
          <i className="fa-solid fa-stopwatch"></i>&nbsp;elapsed
        </>
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
        <>
          <i className="fa-solid fa-stopwatch"></i>&nbsp;moving
        </>
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
        <>
          <i className="fa-solid fa-ruler-horizontal"></i>
        </>
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
        <>
          <i className="fa-solid fa-mountain"></i>
          <span>&nbsp;gain</span>
        </>
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
        <>
          <i className="fa-solid fa-mountain"></i>
          <span>&nbsp;high</span>
        </>
      ),
      headerName: "Elev High",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (params) => params.row.properties.elev_high,
      valueFormatter: (params) => decFormatter("m", 0)(params.value),
    },
    {
      field: "elev_low",
      renderHeader: (params) => (
        <>
          <i className="fa-solid fa-mountain"></i>
          <span>:low</span>
        </>
      ),
      headerName: "Elev Low",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (params) => params.row.properties.elev_low,
      valueFormatter: (params) => decFormatter("m", 0)(params.value),
    },
    {
      field: "weighted_average_watts",
      renderHeader: (params) => (
        <>
          <i className="fa-solid fa-bolt-lightning"></i>
          <span>&nbsp;wavg</span>
        </>
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
        <>
          <i className="fa-solid fa-bolt-lightning"></i>
          <span>&nbsp;avg</span>
        </>
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
        <>
          <i className="fa-solid fa-bolt-lightning"></i>
          <span>&nbsp;avg</span>
        </>
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
        <>
          <i className="fa-solid fa-heart"></i>
          <span>&nbsp;avg</span>
        </>
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
        <>
          <i className="fa-solid fa-heart"></i>
          <span>&nbsp;max</span>
        </>
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
        max_heartrate: false,
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
        max_heartrate: false,
      },
    },
  },
};

export { mapSettings, categorySettings, filterSettings, listSettings };
