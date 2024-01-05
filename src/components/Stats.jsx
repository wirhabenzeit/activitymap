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
    minHeight: tabHeight - 2,
    paddingTop: 8,
    paddingBottom: 8,
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

const tabs = [
  { id: "timeline", label: "Timeline", plot: <TimelinePlot /> },
  { id: "scatter", label: "Scatter", plot: <ScatterPlot /> },
  { id: "calendar", label: "Calendar", plot: <CalendarPlot /> },
];

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
          {tabs.map((tab) => (
            <Tab key={tab.id} label={tab.label} />
          ))}
        </Tabs>
        <Box
          sx={{
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
      {tabs.map((tab, index) => (
        <StatTabPanel key={tab.id} value={value} index={index}>
          <LegendSettingPlot plot={tab.plot} settingsOpen={settingsOpen} />
        </StatTabPanel>
      ))}
    </Box>
  );
}
