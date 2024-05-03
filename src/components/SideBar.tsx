"use client";
import React from "react";

import {
  Box,
  Divider,
  List,
  ListItem,
  IconButton,
  Drawer as MuiDrawer,
  type DrawerProps,
  type Theme,
} from "@mui/material";
import {ChevronLeft as ChevronLeftIcon} from "@mui/icons-material";
import {styled} from "@mui/material/styles";

import {useStore} from "~/contexts/Zustand";

import {
  MultiSelect,
  SearchBox,
  CheckboxFilter,
  ValueSlider,
} from "~/components/Drawer";

import {categorySettings} from "~/settings/category";

import {
  binaryFilters,
  filterSettings,
} from "~/settings/filter";

const DrawerHeader = styled("div")(({theme}) => {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0, 1),
    minHeight: theme.customValues.toolbarHeight,
  };
});

const openedMixin = (theme: Theme) => ({
  width: theme.customValues.drawerWidth,
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: "hidden",
});

const closedMixin = (theme: Theme) => ({
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: "hidden",
  width: `calc(${theme.spacing(4)} + 1px)`,
});

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: () => true,
})<DrawerProps>(({theme}) => {
  const {open} = useStore((state) => ({
    open: state.drawerOpen,
  }));
  return {
    width: theme.customValues.drawerWidth,
    flexShrink: 0,
    whiteSpace: "nowrap",
    boxSizing: "border-box",
    ...(open && {
      ...openedMixin(theme),
      "& .MuiDrawer-paper": openedMixin(theme),
    }),
    ...(!open && {
      ...closedMixin(theme),
      "& .MuiDrawer-paper": closedMixin(theme),
    }),
  };
});

export default function SideBar() {
  const {open, setOpen} = useStore((state) => ({
    setOpen: state.toggleDrawer,
    open: state.drawerOpen,
  }));

  return (
    <Drawer variant="permanent" open={open}>
      <DrawerHeader>
        <IconButton onClick={setOpen}>
          <ChevronLeftIcon />
        </IconButton>
      </DrawerHeader>
      <Divider />
      <Box>
        <List>
          {Object.keys(categorySettings).map((key) => (
            <ListItem sx={{px: 0, py: 0}} key={key}>
              <MultiSelect
                name={key as keyof typeof categorySettings}
              />
            </ListItem>
          ))}
        </List>
        <Divider />
        <List>
          <ListItem sx={{px: 0, py: 0}} key="search">
            <SearchBox />
          </ListItem>
          {Object.keys(binaryFilters).map((key) => (
            <ListItem sx={{px: 0, py: 0}} key={key}>
              <CheckboxFilter
                name={key as keyof typeof binaryFilters}
              />
            </ListItem>
          ))}
        </List>
        <Divider />
        <List>
          {Object.keys(filterSettings).map((key) => (
            <ListItem sx={{px: 0, py: 0}} key={key}>
              <ValueSlider
                name={key as keyof typeof filterSettings}
              />
            </ListItem>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}
