import * as React from "react";

import { ParentSize } from "@visx/responsive";

import PropTypes from "prop-types";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

import IconButton from "@mui/material/IconButton";
import Tune from "@mui/icons-material/Tune";
import CalendarPlot from "./Charts/CalendarPlot.jsx";
import TimelinePlot from "./Charts/TimelinePlot.jsx";

import { Scatter } from "./Charts/ScatterPlot.jsx";

import ViolinPlot from "./Charts/ViolinPlot.jsx";
import { Divider } from "@mui/material";

function StatTabPanel(props) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      style={{ height: `calc(100% - ${tabHeight}px)`, flexDirection: "column" }}
      {...other}
    >
      {value === index && <>{children}</>}
    </div>
  );
}

const tabHeight = 48;

export default function BasicTabs({ open }) {
  const [value, setValue] = React.useState(0);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
      }}
    >
      <Box
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
          width: 1,
        }}
      >
        <Tabs
          value={value}
          onChange={handleChange}
          aria-label="stats tabs"
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            display: "inline-flex",
            width: `calc(100% - 40px)`,
            minHeight: tabHeight,
          }}
        >
          <Tab label="Scatter" id="calendar" sx={{ minHeight: tabHeight }} />
          <Tab label="Calendar" id="scatter" sx={{ minHeight: tabHeight }} />
          <Tab label="Timeline" id="timeline" sx={{ minHeight: tabHeight }} />
          <Tab label="Violin" id="violin" sx={{ minHeight: tabHeight }} />
        </Tabs>
        <Box
          sx={{
            height: tabHeight,
            display: "inline-flex",
            marginLeft: "auto",
            right: 0,
            position: "absolute",
          }}
        >
          <Divider orientation="vertical" flexItem />
          <IconButton
            onClick={() => {
              setSettingsOpen(!settingsOpen);
            }}
            color={settingsOpen ? "primary" : "inherit"}
          >
            <Tune fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <StatTabPanel value={value} index={0}>
        <Scatter settingsOpen={settingsOpen} />
      </StatTabPanel>
      <StatTabPanel value={value} index={1}>
        <CalendarPlot settingsOpen={settingsOpen} />
      </StatTabPanel>
      <StatTabPanel value={value} index={2}>
        <TimelinePlot />
      </StatTabPanel>
      <StatTabPanel value={value} index={3}>
        <ParentSize>
          {({ width, height }) => <ViolinPlot width={width} height={height} />}
        </ParentSize>
      </StatTabPanel>
    </Box>
  );
}
