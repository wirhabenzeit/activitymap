import * as React from "react";

import PropTypes from "prop-types";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

import CalendarPlot from "./Charts/Test.jsx";
import ScatterPlot from "./Charts/ScatterPlot2.jsx";

function CustomTabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}
      {...other}
    >
      {value === index && (
        <Box
          sx={{
            p: 0,
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
          }}
        >
          {children}
        </Box>
      )}
    </div>
  );
}

CustomTabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
};

export default function BasicTabs() {
  const [value, setValue] = React.useState(0);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%", // set a specific height
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Tabs
          value={value}
          onChange={handleChange}
          aria-label="basic tabs example"
        >
          <Tab label="Scatter" id="calendar" />
          <Tab label="Calendar" id="scatter" />
        </Tabs>
      </Box>
      <CustomTabPanel
        value={value}
        index={0}
        style={{ flexGrow: 1, overflow: "auto" }}
      >
        <ScatterPlot />
      </CustomTabPanel>
      <CustomTabPanel
        value={value}
        index={1}
        style={{ flexGrow: 1, overflow: "auto" }}
      >
        <CalendarPlot />
      </CustomTabPanel>
    </Box>
  );
}
