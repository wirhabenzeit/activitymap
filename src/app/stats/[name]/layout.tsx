"use client";

import React, {useContext} from "react";

import {Tabs as MuiTabs, Paper, Stack} from "@mui/material";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

import IconButton from "@mui/material/IconButton";
import Tune from "@mui/icons-material/Tune";

import {useStore} from "~/contexts/Zustand";

import {Divider} from "@mui/material";
import Link from "next/link";
import {usePathname} from "next/navigation";

import statsPlots from "~/stats";
import {StatsContext, StatsProvider} from "./StatsContext";

type StatsPlotsKeys = keyof typeof statsPlots;
type TabKeys = `/stats/${StatsPlotsKeys}`;
type TabValue = {label: string; index: number};

const tabs = (
  Object.keys(statsPlots) as (keyof typeof statsPlots)[]
).reduce(
  (acc, name, index) => ({
    ...acc,
    [`/stats/${name}`]: {label: name, index},
  }),
  {} as Record<TabKeys, TabValue>
);

export default function Stats({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    settingsOpen,
    toggleStatsSettings: toggleStatsSettings,
    setActiveStatsTab,
    activeStatsTab,
  } = useStore((state) => ({
    settingsOpen: state.statsSettingsOpen,
    toggleStatsSettings: state.toggleStatsSettings,
    setActiveStatsTab: state.setActiveStatsTab,
    activeStatsTab: state.activeStatsTab,
  }));

  const pathname = usePathname();
  const [value, setValue] = React.useState(
    pathname in tabs && tabs[pathname as TabKeys]
      ? tabs[pathname as TabKeys].index
      : tabs[activeStatsTab].index
  );
  const handleChange = (
    event: React.SyntheticEvent,
    newValue: number
  ) => {
    const tabKey = Object.keys(tabs)[
      newValue
    ] as keyof typeof tabs;
    if (tabKey && tabKey in tabs) {
      setValue(newValue);
      setActiveStatsTab(tabKey);
    }
  };

  const {settingsRef, elementRef} =
    useContext(StatsContext);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flexWrap: "nowrap",
        minHeight: 0,
      }}
    >
      <StatsProvider>
        <Box
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            width: 1,
            display: "flex",
            alignItems: "stretch",
            overflow: "hidden",
          }}
        >
          <MuiTabs
            value={value}
            onChange={handleChange}
            aria-label="stats tabs"
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              display: "inline-flex",
              width: `calc(100% - 40px)`,
              minHeight: "40px",
            }}
          >
            {Object.entries(tabs).map(([url, tab]) => (
              <Tab
                key={url}
                label={tab.label}
                component={Link}
                href={url}
                sx={{
                  minHeight: "40px",
                  py: "8px",
                  fontSize: "0.8rem",
                }}
              />
            ))}
          </MuiTabs>
          <Box
            sx={{
              display: "inline-flex",
              marginLeft: "auto",
              right: 0,
            }}
          >
            <Divider orientation="vertical" flexItem />
            <IconButton
              onClick={toggleStatsSettings}
              color={settingsOpen ? "primary" : "inherit"}
            >
              <Tune fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        <Box
          ref={elementRef}
          sx={{flexGrow: 1, minHeight: 0, width: "100%"}}
        >
          {children}
        </Box>
        <Paper
          sx={{
            width: "100%",
            backgroundColor: "background.paper",
            height: "60px",
            display: settingsOpen ? "block" : "none",
            borderTop: 1,
            //zIndex: 1,
            boxShadow: 1,
            borderColor: "divider",
            overflowY: "hidden",
            overflowX: "scroll",
          }}
        >
          <Stack
            style={{
              minWidth: "max-content",
            }}
            direction="row"
            justifyContent="space-evenly"
            alignItems="center"
            spacing={2}
            flexWrap={"nowrap"}
            ref={settingsRef}
            sx={{m: 1}}
          ></Stack>
        </Paper>
      </StatsProvider>
    </Box>
  );
}
