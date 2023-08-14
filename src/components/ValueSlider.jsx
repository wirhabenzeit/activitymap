import * as React from "react";
import { useState, useEffect } from "react";
import MuiSlider from "@mui/material/Slider";
import { styled } from "@mui/material/styles";
import IconButton from "@mui/material/IconButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { filterSettings } from "../settings";
import SidebarButton from "/src/components/SidebarButton";
import { FilterContext } from "/src/contexts/FilterContext";
import { Tooltip } from "@mui/material";

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

  const minmax = filterContext.filterRanges[name];
  const min = minmax[0];
  const max = minmax[1];
  const scale = !("scale" in filterSettings[name])
    ? (x) => x
    : (x) =>
        min + (max - min) * filterSettings[name].scale((x - min) / (max - min));
  //if (value && value[0] === undefined) setValue(minmax);

  useEffect(() => {
    if (value[0] === undefined) setValue(filterContext.filterRanges[name]);
  }, [filterContext.filterRanges[name]]);

  return (
    <SidebarButton
      open={open}
      contentOpen={openSlider}
      setContentOpen={setOpenSlider}
      button={
        <IconButton
          disabled={minmax.every((v, i) => v === value[i])}
          sx={{
            width: "30px",
            mx: "1px",
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
        sx={{ width: "160px", mx: 3, mt: 1 }}
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
