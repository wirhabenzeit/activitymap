import * as React from "react";
import { cloneElement, useRef } from "react";

import { ParentSize } from "@visx/responsive";

import { Tabs as MuiTabs, Stack } from "@mui/material";
import { styled } from "@mui/material";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

import IconButton from "@mui/material/IconButton";
import Tune from "@mui/icons-material/Tune";
import CalendarPlot from "./Charts/CalendarPlot.jsx";
import { TimelinePlot } from "./Charts/TimelinePlot.jsx";

import ScatterPlot from "./Charts/ScatterPlot.jsx";

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

const tabHeight = 36;

const Tabs = styled(MuiTabs)(({ theme }) => ({
  minHeight: tabHeight,
  "& .MuiTab-root": {
    minHeight: tabHeight,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: "0.75rem",
  },
}));

function LegendSettingPlot({ plot, settingsOpen, legend = true }) {
  const settingsRef = useRef(null);

  return (
    <Box
      sx={{
        p: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <ParentSize>
        {({ width, height }) => (
          <>
            {cloneElement(plot, {
              width,
              height: settingsOpen ? height - 60 : height,
              settingsRef,
            })}
            <Box
              sx={{
                width: "100%",
                height: "60px",
                display: settingsOpen ? "block" : "none",
                borderTop: 1,
                borderColor: "divider",
                flexShrink: 0,
                overflowY: "hidden",
                overflowX: "scroll",
                py: 1,
              }}
            >
              <Stack
                style={{
                  minWidth: "min-content",
                }}
                direction="row"
                justifyContent="space-evenly"
                alignItems="center"
                spacing={2}
                ref={settingsRef}
              ></Stack>
            </Box>
          </>
        )}
      </ParentSize>
    </Box>
  );
}

export default function BasicTabs({ open }) {
  const [value, setValue] = React.useState(0);
  const [settingsOpen, setSettingsOpen] = React.useState(true);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        maxHeight: "100%",
        overflow: "hidden",
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
          }}
        >
          <Tab label="Scatter" id="calendar" />
          <Tab label="Calendar" id="scatter" />
          <Tab label="Timeline" id="timeline" />
          <Tab label="Violin" id="violin" />
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
        <LegendSettingPlot plot={<ScatterPlot />} settingsOpen={settingsOpen} />
      </StatTabPanel>
      <StatTabPanel value={value} index={1}>
        <LegendSettingPlot
          plot={<CalendarPlot />}
          settingsOpen={settingsOpen}
        />
      </StatTabPanel>
      <StatTabPanel value={value} index={2}>
        <LegendSettingPlot
          plot={<TimelinePlot />}
          settingsOpen={settingsOpen}
          legend={false}
        />
      </StatTabPanel>
      <StatTabPanel value={value} index={3}>
        <ParentSize>
          {({ width, height }) => <ViolinPlot width={width} height={height} />}
        </ParentSize>
      </StatTabPanel>
    </Box>
  );
}
