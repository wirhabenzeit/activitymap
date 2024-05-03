import {Link, Tooltip} from "@mui/material";
import {
  type GridSortCellParams,
  gridStringOrNumberComparator,
  type GridColDef,
  type GridSortItem,
} from "@mui/x-data-grid";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";

library.add(fas);

import {type Activity} from "~/server/db/schema";
import {
  categorySettings,
  aliasMap,
  colorMap,
} from "./category";
import {desc} from "drizzle-orm";

function decFormatter(unit = "", decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

export const listSettings = {
  columns: [
    {
      field: "sport_type",
      headerName: "Type",
      description: "Sport type",
      renderHeader: () => (
        <Tooltip title="Sport type">
          <FontAwesomeIcon
            fontSize="small"
            icon="child-reaching"
          />
        </Tooltip>
      ),
      renderCell: ({
        value,
      }: {
        value: Activity["sport_type"];
      }) => (
        <Tooltip title={value}>
          <FontAwesomeIcon
            fontSize="small"
            icon={categorySettings[aliasMap[value]!].icon}
            color={colorMap[value]}
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
    },
    {
      field: "name",
      headerName: "Name",
      flex: 2,
      minWidth: 150,
      valueGetter: (value: number, row: Activity) => ({
        name: row.name,
        id: row.id,
        type: row.sport_type,
      }),
      renderCell: ({value}: {value: Activity}) => (
        <Link
          href={`https://www.strava.com/activities/${value.id}`}
          target="_blank"
          rel="noreferrer"
        >
          {value.name}
        </Link>
      ),
      sortComparator: (
        v1: {name: string},
        v2: {name: string},
        param1: GridSortCellParams<string>,
        param2: GridSortCellParams<string>
      ) =>
        gridStringOrNumberComparator(
          v1.name,
          v2.name,
          param1,
          param2
        ),
    },
    {
      field: "description",
      headerName: "Description",
      flex: 2,
      minWidth: 80,
    },
    {
      field: "start_date_local_timestamp",
      headerName: "Day",
      flex: 1,
      minWidth: 80,
      renderHeader: () => (
        <Tooltip title="Start date">
          <FontAwesomeIcon
            fontSize="small"
            icon="calendar"
          />
        </Tooltip>
      ),
      type: "number",
      valueFormatter: (value: number) =>
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
      renderHeader: () => (
        <Tooltip title="Start time">
          <FontAwesomeIcon fontSize="small" icon="clock" />
        </Tooltip>
      ),
      valueGetter: (value: string, row: Activity) => {
        const date = new Date(row.start_date_local!);
        return (
          date.getHours() * 3600 +
          date.getMinutes() * 60 +
          date.getSeconds()
        );
      },
      valueFormatter: (value: number) => {
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
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
      renderHeader: () => (
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
      valueGetter: (value: number) =>
        Math.floor(value / 60),
      valueFormatter: (value: number) =>
        Math.floor(value / 60) +
        "h" +
        String(value % 60).padStart(2, "0"),
      cellDataType: "number",
      type: "number",
    },
    {
      headerName: "Moving time",
      renderHeader: () => (
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
      valueGetter: (value: number) =>
        Math.floor(value ? value / 60 : 0),
      valueFormatter: (value: number) =>
        Math.floor(value / 60) +
        "h" +
        String(value % 60).padStart(2, "0"),
      type: "number",
    },
    {
      field: "distance",
      renderHeader: () => (
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
      valueGetter: (value: number) => value / 1000,
      valueFormatter: (value: number) =>
        decFormatter("km", 1)(value),
    },
    {
      field: "average_speed",
      renderHeader: () => (
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
      valueFormatter: (value: number) =>
        decFormatter("km/h", 1)(value * 3.6),
    },
    {
      field: "total_elevation_gain",
      renderHeader: () => (
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
      valueFormatter: (value: number) =>
        decFormatter("m", 0)(value),
    },
    {
      field: "elev_high",
      renderHeader: () => (
        <Tooltip title="Elevation high">
          <div>
            <span>max</span>
            <FontAwesomeIcon
              fontSize="small"
              icon="mountain"
            />
          </div>
        </Tooltip>
      ),
      headerName: "Elevation High",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueGetter: (value: number) => value,
      valueFormatter: (value: number) =>
        decFormatter("m", 0)(value),
    },
    {
      field: "elev_low",
      renderHeader: () => (
        <Tooltip title="Elevation low">
          <div>
            <span>min</span>
            <FontAwesomeIcon
              fontSize="small"
              icon="mountain"
            />
          </div>
        </Tooltip>
      ),
      headerName: "Elevation Low",
      type: "number",
      flex: 1,
      minWidth: 70,
      valueFormatter: (value: number) =>
        decFormatter("m", 0)(value),
    },
    {
      field: "weighted_average_watts",
      renderHeader: () => (
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
      valueFormatter: (value: number) =>
        decFormatter("W")(value),
    },
    {
      field: "average_watts",
      renderHeader: () => (
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
      valueFormatter: (value: number) =>
        decFormatter("W")(value),
    },
    {
      field: "max_watts",
      renderHeader: () => (
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
      valueFormatter: (value: number) =>
        decFormatter("W")(value),
    },
    {
      field: "average_heartrate",
      renderHeader: () => (
        <Tooltip title="Average heartrate">
          <FontAwesomeIcon fontSize="small" icon="heart" />
        </Tooltip>
      ),
      headerName: "Avg Heartrate",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueFormatter: (value: number) =>
        decFormatter("bpm")(value),
    },
    {
      field: "max_heartrate",
      renderHeader: () => (
        <Tooltip title="Max heartrate">
          <FontAwesomeIcon fontSize="small" icon="heart" />
        </Tooltip>
      ),
      headerName: "Max Heartrate",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueFormatter: (value: number) =>
        decFormatter("bpm")(value),
    },
    {
      field: "kudos_count",
      renderHeader: () => (
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
      valueFormatter: (value: number) =>
        decFormatter("")(value),
    },
  ] as GridColDef[],
  defaultState: {
    compact: {
      sortModel: [
        {
          field: "start_date_local_timestamp",
          sort: "desc",
        } as GridSortItem,
      ],
      columnVisibilityModel: {
        type: false,
        id: false,
        description: false,
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
        } as GridSortItem,
      ],
      columnVisibilityModel: {
        id: false,
        time: false,
        description: false,
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
};
