import * as React from "react";
import { cloneElement, useRef, useLayoutEffect, useEffect } from "react";

import {
  Tabs as MuiTabs,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import { styled } from "@mui/material";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

import IconButton from "@mui/material/IconButton";
import Tune from "@mui/icons-material/Tune";
import CalendarPlot from "./Charts/CalendarPlot.jsx";
import { TimelinePlot } from "./Charts/TimelinePlot.jsx";

import ProgressPlot from "./Charts/ProgressPlot.jsx";
import ScatterPlot from "./Charts/ScatterPlot.jsx";

import { Divider } from "@mui/material";

export function CustomSelect({
  propName,
  name,
  value,
  options,
  setState,
  headers,
  sx,
  disabled,
}) {
  return (
    <FormControl key={propName} sx={sx} disabled={disabled}>
      <InputLabel>{name}</InputLabel>
      <Select
        size="small"
        autoWidth
        value={value.id}
        label={name}
        sx={{ minWidth: "100px" }}
        onChange={(event) =>
          setState({
            [propName]: options[event.target.value],
          })
        }
      >
        {!headers &&
          Object.entries(options).map(([key, aggregator]) => (
            <MenuItem value={key} key={key}>
              {aggregator.label}
            </MenuItem>
          ))}
        {headers &&
          headers.reduce(
            (prev, header) => [
              ...prev,
              <ListSubheader key={header.title}>{header.title}</ListSubheader>,
              ...Object.entries(options)
                .filter(([key, agg]) => header.filter(agg))
                .map(([key, aggregator]) => (
                  <MenuItem value={key} key={key}>
                    {aggregator.label}
                  </MenuItem>
                )),
            ],
            []
          )}
      </Select>
    </FormControl>
  );
}

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
      {children}
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

function LegendSettingPlot({ plot, settingsOpen, width, height }) {
  const settingsRef = useRef(null);

  return (
    <Box
      sx={{
        p: 0,
        width: "100%",
        height: "100%",
      }}
    >
      {cloneElement(plot, {
        settingsRef,
        width: width,
        height: settingsOpen ? height - 60 : height,
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
    </Box>
  );
}

const tabs = [
  { id: "timeline", label: "Timeline", plot: <TimelinePlot /> },
  { id: "calendar", label: "Calendar", plot: <CalendarPlot /> },
  { id: "progress", label: "Progress", plot: <ProgressPlot /> },
  { id: "scatter", label: "Scatter", plot: <ScatterPlot /> },
];

export default function BasicTabs({ open }) {
  const [value, setValue] = React.useState(0);
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [width, setWidth] = React.useState(0);
  const [height, setHeight] = React.useState(0);
  const elementRef = useRef(null);

  useLayoutEffect(() => {
    var ro = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const cr = entry.contentRect;
        setWidth(cr.width);
        setHeight(cr.height);
      }
    });

    setWidth(elementRef.current.offsetWidth);
    setHeight(elementRef.current.offsetHeight);

    ro.observe(elementRef.current);

    return () => {
      ro.unobserve(elementRef.current);
    };
  }, []);

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
      <div
        style={{ height: `calc(100% - ${tabHeight}px)`, width: "100%" }}
        ref={elementRef}
      >
        {tabs.map((tab, index) => (
          <StatTabPanel key={tab.id} value={value} index={index}>
            <LegendSettingPlot
              plot={tab.plot}
              settingsOpen={settingsOpen}
              width={width}
              height={height}
            />
          </StatTabPanel>
        ))}
      </div>
    </Box>
  );
}
