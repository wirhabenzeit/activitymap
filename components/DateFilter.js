import * as React from "react";
import { useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { library, config } = require("@fortawesome/fontawesome-svg-core");
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "@/FilterContext";
import { filterSettings } from "@/settings";
import { ActivityContext } from "@/ActivityContext";
import dayjs from "dayjs";
import Slider from "@mui/material/Slider";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

function CustomSlider({ timeStamps, minMax, onChange }) {
  const [value, setValue] = useState(timeStamps);

  return (
    <Slider
      size="small"
      valueLabelDisplay="off"
      value={value}
      onChange={(event, newValue) => setValue(newValue)}
      onChangeCommitted={(event, newValue) => onChange(newValue)}
      min={minMax[0]}
      max={minMax[1]}
      sx={{ gridColumn: 1, gridRow: 1, mx: 1, width: "200px" }}
    />
  );
}

function CustomDatePicker({ timestamp, onChange }) {
  const [dateVal, setDateVal] = React.useState(
    dayjs(new Date(timestamp).toDateString("en-US"))
  );
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        value={dateVal}
        onChange={(newValue) => {
          onChange(newValue);
          setDateVal(newValue);
        }}
        format="DD.MM.YY"
        slotProps={{
          openPickerIcon: {
            fontSize: "small",
          },
          textField: {
            variant: "standard",
            sx: { width: "88px", mx: 1 },
            inputProps: { style: { fontSize: "13px" } },
          },
        }}
      />
    </LocalizationProvider>
  );
}

export default function DateFilterBox({ open }) {
  const activityContext = React.useContext(ActivityContext);
  const filterContext = React.useContext(FilterContext);
  const start_date_timestamp =
    1000 *
    (filterContext.values.start_date_local_timestamp[0] === undefined
      ? activityContext.filterRange.start_date_local_timestamp[0]
      : filterContext.values.start_date_local_timestamp[0]);
  const end_date_timestamp =
    1000 *
    (filterContext.values.start_date_local_timestamp[1] === undefined
      ? activityContext.filterRange.start_date_local_timestamp[1]
      : filterContext.values.start_date_local_timestamp[1]);

  return (
    <Box sx={{ width: 1, display: "flex", flexDirection: "row" }}>
      <IconButton sx={{ width: "30px" }}>
        <FontAwesomeIcon fontSize="medium" icon="calendar-days" />
      </IconButton>
      {open && (
        <Box sx={{ display: "grid" }}>
          <CustomSlider
            timeStamps={[start_date_timestamp, end_date_timestamp]}
            minMax={activityContext.filterRange.start_date_local_timestamp.map(
              (x) => x * 1000
            )}
            onChange={(newValue) => {
              filterContext.updateValueFilter(
                "start_date_local_timestamp",
                newValue.map((x) => x / 1000)
              );
            }}
          />
          <div>
            <CustomDatePicker
              timestamp={start_date_timestamp}
              onChange={(newValue) => {
                filterContext.updateValueFilter("start_date_local_timestamp", [
                  dayjs(newValue).unix(),
                  dayjs(end_date_timestamp).unix(),
                ]);
              }}
            />
            <span>–</span>
            <CustomDatePicker
              timestamp={end_date_timestamp}
              onChange={(newValue) => {
                filterContext.updateValueFilter("start_date_local_timestamp", [
                  dayjs(start_date_timestamp).unix(),
                  dayjs(newValue).unix(),
                ]);
              }}
            />
          </div>
        </Box>
      )}
    </Box>
  );
}
