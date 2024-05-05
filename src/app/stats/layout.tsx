"use client";

import React, {createContext, useState} from "react";
import {useRef, useLayoutEffect, createRef} from "react";

import {Tabs as MuiTabs, Stack} from "@mui/material";
import {styled} from "@mui/material";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

import IconButton from "@mui/material/IconButton";
import Tune from "@mui/icons-material/Tune";

import {useStore} from "~/contexts/Zustand";

import {Divider} from "@mui/material";
import Link from "next/link";
import {usePathname} from "next/navigation";

const settingsRef = createRef<HTMLDivElement>();

const defaultStatsContext = {
  settingsRef,
  width: 0,
  height: 0,
};

const StatsContext = createContext(defaultStatsContext);

const tabHeight = 36;

const tabs = {
  "/stats/timeline": {
    label: "Timeline",
    index: 0,
  },
  "/stats/calendar": {
    label: "Calendar",
    index: 1,
  },
  "/stats/progress": {
    label: "Progress",
    index: 2,
  },
  "/stats/scatter": {
    label: "Scatter",
    index: 3,
  },
};

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

  const [state, setState] = useState(defaultStatsContext);

  const pathname = usePathname();
  const [value, setValue] = React.useState(
    pathname in tabs
      ? tabs[pathname as keyof typeof tabs].index
      : tabs[activeStatsTab].index
  );
  const handleChange = (
    event: React.SyntheticEvent,
    newValue: number
  ) => {
    const tabKey = Object.keys(tabs)[newValue];
    if (tabKey && tabKey in tabs) {
      setValue(newValue);
      setActiveStatsTab(tabKey as keyof typeof tabs);
    }
  };

  const elementRef = useRef(
    null
  ) as React.MutableRefObject<HTMLElement | null>;

  useLayoutEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setState((state) => ({
          ...state,
          width: cr.width,
          height: cr.height,
        }));
      }
    });

    setState((state) => {
      if (elementRef?.current === null) {
        return state;
      }
      return {
        ...state,
        width: elementRef.current.offsetWidth,
        height: elementRef.current.offsetHeight,
      };
    });

    if (elementRef.current) ro.observe(elementRef.current);
    return () => {
      if (elementRef.current)
        ro.unobserve(elementRef.current);
    };
  }, []);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        maxHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
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
          }}
        >
          {Object.entries(tabs).map(([url, tab]) => (
            <Tab
              key={url}
              label={tab.label}
              component={Link}
              href={url}
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
      <Box ref={elementRef} sx={{flexGrow: 1}}>
        <StatsContext.Provider
          value={{
            height: settingsOpen
              ? state.height - 60
              : state.height,
            width: state.width,
            settingsRef,
          }}
        >
          {children}
        </StatsContext.Provider>
      </Box>
      <Box
        sx={{
          width: "100%",
          backgroundColor: "background.paper",
          height: "60px",
          display: settingsOpen ? "block" : "none",
          borderTop: 1,
          zIndex: 1,
          boxShadow: 1,
          borderColor: "divider",
          flexShrink: 0,
          overflowY: "hidden",
          overflowX: "scroll",
          py: 1,
          position: "absolute",
          bottom: 0,
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

export {StatsContext};
