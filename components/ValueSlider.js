import * as React from "react";
import { useState } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import MuiSlider from "@mui/material/Slider";
import { styled } from "@mui/material/styles";
import IconButton from "@mui/material/IconButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { library, config } = require("@fortawesome/fontawesome-svg-core");
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "@/FilterContext";
import { filterSettings } from "@/settings";
import { ActivityContext } from "@/ActivityContext";

const Slider = styled(MuiSlider)(({ theme }) => ({
  '& .MuiSlider-markLabel[data-index="0"]': {
    transform: "translateX(0%)",
  },
  '& .MuiSlider-markLabel[data-index="1"]': {
    transform: "translateX(-100%)",
  },
  "& .MuiSlider-valueLabel": {
    fontSize: 12,
    fontWeight: "normal",
    backgroundColor: "unset",
    color: theme.palette.text.primary,
    "&:before": {
      display: "none",
    },
    "& *": {
      background: "transparent",
      color: theme.palette.mode === "dark" ? "#fff" : "#000",
    },
  },
  '& .MuiSlider-thumb[data-index="0"] > span': {
    transform: "translateX(30%)",
    top: 15,
  },
  '& .MuiSlider-thumb[data-index="1"] > span': {
    transform: "translateX(-30%)",
    top: -25,
  },
}));

function ValueSlider({ name }) {
  const filterContext = React.useContext(FilterContext);

  const [value, setValue] = useState(filterContext.values[name]);
  const activityContext = React.useContext(ActivityContext);
  const context = React.useContext(FilterContext);
  const minmax = activityContext.loading
    ? undefined
    : activityContext.filterRange[name];
  const min = activityContext.loading ? undefined : minmax[0];
  const max = activityContext.loading ? undefined : minmax[1];
  if (value[0] === undefined) setValue(minmax);

  return (
    <Slider
      getAriaLabel={() => name}
      sx={{ mx: 2 }}
      min={min}
      max={max}
      valueLabelFormat={(value) => filterSettings[name].tooltip(value)}
      value={value}
      onChange={(event, newValue) => {
        setValue(newValue);
      }}
      onChangeCommitted={(event, newValue) => {
        filterContext.updateValueFilter(name, newValue);
      }}
      size="small"
      valueLabelDisplay="on"
    />
  );
}

export default function SliderBox({ open, name }) {
  const activityContext = React.useContext(ActivityContext);
  const context = React.useContext(FilterContext);
  const buttonRef = React.useRef();
  const [openSlider, setOpenSlider] = React.useState(false);

  return (
    <Box sx={{ width: 1, display: "flex", flexDirection: "row" }}>
      <IconButton
        sx={{ width: "30px" }}
        onClick={() => setOpenSlider(true)}
        ref={buttonRef}
      >
        <FontAwesomeIcon fontSize="medium" icon={filterSettings[name].icon} />
      </IconButton>
      {open && <ValueSlider name={name} />}
      <Popover
        id={name + "-slider"}
        open={openSlider}
        anchorOrigin={{
          vertical: "center",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "center",
          horizontal: "left",
        }}
        anchorEl={buttonRef.current}
        onClose={() => setOpenSlider(false)}
      >
        <Box sx={{ width: 200, ml: 2, mr: 5, my: 2 }}>
          <ValueSlider name={name} />
        </Box>
      </Popover>
    </Box>
  );
}
