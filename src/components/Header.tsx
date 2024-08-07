"use client";

import React from "react";
import {usePathname} from "next/navigation";
import Link from "next/link";
import {
  Box,
  Tabs,
  Tab,
  Toolbar,
  Typography,
  IconButton,
  AppBar as MuiAppBar,
} from "@mui/material";
import {
  ChevronRight as ChevronRightIcon,
  Map as MapIcon,
} from "@mui/icons-material";
import {styled} from "@mui/material/styles";

import {LoginButton, UserSettings} from "~/components/User";
import {Share} from "~/components/Share";
import {useStore} from "~/contexts/Zustand";
import {ChatBot} from "./ChatBox";

const AppBar = styled(MuiAppBar)(({theme}) => {
  const {open} = useStore((state) => ({
    open: state.drawerOpen,
  }));
  return {
    zIndex: theme.zIndex.drawer + 1,
    transition: theme.transitions.create(
      ["width", "margin"],
      {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
      }
    ),
    "& .MuiToolbar-root": {
      minHeight: theme.customValues.toolbarHeight,
    },
    ...(open && {
      marginLeft: theme.customValues.drawerWidth,
      width: `calc(100% - ${theme.customValues.drawerWidth}px)`,
      transition: theme.transitions.create(
        ["width", "margin"],
        {
          easing: theme.transitions.easing.sharp,
          duration:
            theme.transitions.duration.enteringScreen,
        }
      ),
    }),
  };
});

const tabs = {
  "/map": {label: "Map", index: 0},
  "/list": {label: "List", index: 1},
  "/stats": {label: "Stats", index: 2},
};

export default function Header() {
  const {
    open,
    setOpen,
    activeStatsTab,
    user,
    guest,
    loading,
  } = useStore((state) => ({
    open: state.drawerOpen,
    setOpen: state.toggleDrawer,
    activeStatsTab: state.activeStatsTab,
    user: state.user,
    guest: state.guest,
    loading: state.loading,
  }));
  const pathname = usePathname();
  const parts = pathname.split("/");
  const valueKey = parts.length > 1 ? `/${parts[1]}` : "";
  const tab = tabs[valueKey as keyof typeof tabs];
  const [value, setValue] = React.useState(
    valueKey in tabs && tab ? tab.index : 0
  );
  const handleChange = (
    event: React.SyntheticEvent,
    newValue: number
  ) => {
    setValue(newValue);
  };

  return (
    <AppBar position="fixed">
      <Toolbar sx={{pl: {xs: 0, sm: 0}}}>
        <IconButton
          color="inherit"
          aria-label="open drawer"
          onClick={() => setOpen()}
          edge="start"
          sx={{
            p: 0,
            mx: 0.25,
            ...(open && {display: "none"}),
          }}
        >
          <ChevronRightIcon />
        </IconButton>
        <MapIcon
          sx={{
            mx: 1,
            display: {xs: "none", sm: "flex"},
          }}
        />
        <Typography
          variant="h6"
          noWrap
          component={Link}
          href="/"
          onClick={() => setValue(0)}
          sx={{
            mr: 2,
            fontWeight: 700,
            color: "inherit",
            textDecoration: "none",
            display: {xs: "none", sm: "flex"},
          }}
        >
          ActivityMap
        </Typography>
        <Box>
          <Tabs
            value={value}
            onChange={handleChange}
            textColor="inherit"
            TabIndicatorProps={{
              style: {
                backgroundColor: "white",
              },
            }}
          >
            <Tab
              label="Map"
              component={Link}
              href="/map"
              key="/map"
              sx={{minWidth: 50}}
            />
            <Tab
              label="List"
              component={Link}
              href="/list"
              key="/list"
              sx={{minWidth: 50}}
            />
            <Tab
              label="Stats"
              component={Link}
              href={activeStatsTab}
              key="/stats"
              style={{minWidth: 50}}
            />
          </Tabs>
        </Box>
        <Box sx={{flexGrow: 1}} />
        {user && "image" in user && !guest && (
          <>
            <ChatBot />
            <Share />
            <UserSettings user={user} />
          </>
        )}{" "}
        {!user && !guest && !loading && <LoginButton />}
      </Toolbar>
    </AppBar>
  );
}
