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
import { FilterContext } from "@/components/Context/FilterContext";
import { filterSettings } from "@/settings";
import { ActivityContext } from "@/components/Context/ActivityContext";
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
    ? [undefined, undefined]
    : activityContext.filterRange[name];
  const min = activityContext.loading ? undefined : minmax[0];
  const max = activityContext.loading ? undefined : minmax[1];
  const scale =
    activityContext.loading || !("scale" in filterSettings[name])
      ? (x) => x
      : (x) =>
          min +
          (max - min) * filterSettings[name].scale((x - min) / (max - min));
  if (value && value[0] === undefined) setValue(minmax);

  return (
    <SidebarButton
      open={open}
      contentOpen={openSlider}
      setContentOpen={setOpenSlider}
      button={
        <IconButton
          sx={{
            width: "30px",
            mx: "1px",
            color: minmax.every((v, i) => v === value[i])
              ? "text.disabled"
              : "primary",
          }}
          onClick={() => {
            setValue(minmax);
            filterContext.updateValueFilter(name, minmax.map(scale));
          }}
        >
          <FontAwesomeIcon fontSize="medium" icon={filterSettings[name].icon} />
        </IconButton>
      }
    >
      <Slider
        getAriaLabel={() => name}
        sx={{ width: "160px", ml: 3, mt: 1 }}
        min={min}
        max={max}
        scale={scale}
        valueLabelFormat={(value) => filterSettings[name].tooltip(value)}
        value={value}
        onChange={(event, newValue) => {
          setValue(newValue);
        }}
        onChangeCommitted={(event, newValue) => {
          filterContext.updateValueFilter(name, newValue.map(scale));
        }}
        size="small"
        valueLabelDisplay="on"
      />
    </SidebarButton>
  );
}
