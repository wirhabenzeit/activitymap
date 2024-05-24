import {
  Icon,
  IconButton,
  Link,
  Tooltip,
} from "@mui/material";
import {
  type GridSortCellParams,
  type GridRenderEditCellParams,
  gridStringOrNumberComparator,
  type GridColDef,
  type GridSortItem,
  useGridApiContext,
} from "@mui/x-data-grid";

import {type Activity} from "~/server/db/schema";
import {
  categorySettings,
  aliasMap,
  colorMap,
} from "./category";
import React, {useEffect, useState} from "react";
import {
  FaBoltLightning,
  FaCalendar,
  FaClock,
  FaFileLines,
  FaGauge,
  FaHeart,
  FaInfo,
  FaMountain,
  FaRulerHorizontal,
  FaStopwatch,
  FaStrava,
  FaThumbsUp,
} from "react-icons/fa6";

function decFormatter(unit = "", decimals = 0) {
  return (num: number | undefined) =>
    num == undefined ? null : num.toFixed(decimals) + unit;
}

function CustomNameEditComponent(
  props: GridRenderEditCellParams<
    Activity,
    {name: string; id: number; type: string}
  >
) {
  const apiRef = useGridApiContext();
  const ref = React.useRef(null);
  const {id, field} = props;
  console.log(props.value);
  const [value, setValue] = useState(props.value?.name);

  useEffect(() => {
    void apiRef.current.setEditCellValue({
      id,
      field,
      value: props.value?.name,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValueChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const newValue = event.target.value; // The new value entered by the user
    setValue(newValue);
    void apiRef.current.setEditCellValue({
      id,
      field,
      value: newValue,
      debounceMs: 200,
    });
  };

  return (
    <input
      style={{border: 0, width: "100%"}}
      ref={ref}
      type="text"
      value={value}
      onChange={handleValueChange}
    />
  );
}

const renderNameEditInputCell: GridColDef["renderCell"] = (
  params
) => {
  return <CustomNameEditComponent {...params} />;
};

export const listSettings = {
  columns: [
    {
      field: "sport_type",
      headerName: "Type",
      description: "Sport type",
      renderHeader: () => <FaStrava />,
      renderCell: ({
        value,
        row,
      }: {
        value: Activity["sport_type"];
        row: Activity;
      }) => (
        <Tooltip title={`View ${value} on Strava`}>
          <IconButton
            size="small"
            sx={{
              color:
                categorySettings[aliasMap[value]!].color,
            }}
            href={`https://www.strava.com/activities/${row.id}`}
          >
            {categorySettings[aliasMap[value]!].icon}
          </IconButton>
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
      editable: true,
      minWidth: 150,
      /*valueGetter: (value: number, row: Activity) => ({
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
      renderEditCell: renderNameEditInputCell,
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
        ),*/
    },
    {
      field: "description",
      headerName: "Description",
      flex: 2,
      renderHeader: () => <FaFileLines />,
      editable: true,
      minWidth: 80,
    },
    {
      field: "start_date_local_timestamp",
      headerName: "Day",
      flex: 1,
      minWidth: 80,
      renderHeader: () => <FaCalendar />,
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
      renderHeader: () => <FaClock />,
      valueGetter: (value: string, row: Activity) => {
        const date = new Date(row.start_date_local);
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
        <FaStopwatch title="Elapsed time" />
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
        <FaStopwatch title="Moving time" />
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
        <FaRulerHorizontal title="Distance" />
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
      renderHeader: () => <FaGauge title="Average speed" />,
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
        <FaMountain title="Elevation gain" />
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
        <div>
          <span>max</span>
          <FaMountain title="altitude" />
        </div>
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
        <div>
          <span>min</span>
          <FaMountain title="altitude" />
        </div>
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
        <FaBoltLightning title="Weighted average watts" />
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
        <FaBoltLightning title="Average watts" />
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
        <FaBoltLightning title="Max watts" />
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
        <FaHeart title="Average heartrate" />
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
      renderHeader: () => <FaHeart title="Max heartrate" />,
      headerName: "Max Heartrate",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueFormatter: (value: number) =>
        decFormatter("bpm")(value),
    },
    {
      field: "kudos_count",
      renderHeader: () => <FaThumbsUp title="Kudos" />,
      headerName: "Kudos Count",
      type: "number",
      flex: 1,
      minWidth: 80,
      valueFormatter: (value: number) =>
        decFormatter("")(value),
    },
    {
      field: "detailed_activity",
      renderHeader: () => (
        <FaInfo title="Detailed activity" />
      ),
      headerName: "Detailed Activity",
      type: "boolean",
      flex: 1,
      minWidth: 80,
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
        description: true,
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
        detailed_activity: false,
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
        description: true,
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
        detailed_activity: false,
      },
    },
  },
} as const;

listSettings.columns;
