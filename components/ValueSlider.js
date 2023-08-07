import * as React from "react";
import { useState } from "react";
import { Box, Popper, Paper, Fade, Typography } from "@mui/material";
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
import SidebarButton from "@/components/SidebarButton";

const Slider = styled(MuiSlider)(({ theme }) => ({
  '& .MuiSlider-markLabel[data-index="0"]': {
    //transform: "translateX(0%)",
  },
  '& .MuiSlider-markLabel[data-index="1"]': {
    //transform: "translateX(-100%)",
  },
  "& .MuiSlider-valueLabel": {
    fontSize: 11,
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
    transform: "translateX(0%)",
    top: 10,
  },
  '& .MuiSlider-thumb[data-index="1"] > span': {
    transform: "translateX(0%)",
    top: -20,
  },
}));

export default function SliderBox({ open, name }) {
  const [openSlider, setOpenSlider] = React.useState(false);
  const filterContext = React.useContext(FilterContext);

  const [value, setValue] = useState(filterContext.values[name]);
  const activityContext = React.useContext(ActivityContext);
  const minmax = activityContext.loading
    ? undefined
    : activityContext.filterRange[name];
  const min = activityContext.loading ? undefined : minmax[0];
  const max = activityContext.loading ? undefined : minmax[1];
  if (value[0] === undefined) setValue(minmax);

  return (
    <SidebarButton
      open={open}
      contentOpen={openSlider}
      setContentOpen={setOpenSlider}
      button={
        <IconButton sx={{ width: "30px", mx: "1px" }}>
          <FontAwesomeIcon fontSize="medium" icon={filterSettings[name].icon} />
        </IconButton>
      }
      content={
        <Slider
          getAriaLabel={() => name}
          sx={{ ml: 3, mr: 3 }}
          min={min}
          max={max}
          scale={
            "scale" in filterSettings[name]
              ? (x) =>
                  min +
                  (max - min) *
                    filterSettings[name].scale((x - min) / (max - min))
              : (x) => x
          }
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
      }
    />
  );
}
