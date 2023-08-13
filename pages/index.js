import MapView from "@/components/Map";
import ListView from "@/components/List";
import {
  Box,
  Backdrop,
  CircularProgress,
  Tabs,
  Tab,
  CssBaseline,
  Toolbar,
  Typography,
  MenuItem,
  Divider,
  List,
  ListItem,
  IconButton,
} from "@mui/material";
import { User } from "@/components/AppBar";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import MapIcon from "@mui/icons-material/Map";
import { ThemeProvider, styled, createTheme } from "@mui/material/styles";

import ResponsiveAppBar from "@/components/AppBar";
import MuiAppBar from "@mui/material/AppBar";
import MuiDrawer from "@mui/material/Drawer";
import ResponsiveDrawer from "@/components/Drawer";
import {
  mapSettings,
  defaultMapPosition,
  categorySettings,
  binaryFilters,
  filterSettings,
} from "@/settings";
import Layout from "@/components/Layout";
import MultiSelect from "@/components/MultiSelect";
import SearchBox from "@/components/SearchBox";
import ValueSlider from "@/components/ValueSlider";
import CheckboxFilter from "@/components/CheckboxFilter";
import { ActivityContext } from "@/components/Context/ActivityContext";
import { FilterContext } from "@/components/Context/FilterContext";

import { useQueryParam, NumberParam, withDefault } from "use-query-params";

import { useState, useEffect, useContext, useRef } from "react";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const DrawerHeader = styled("div")(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  padding: theme.spacing(0, 1),
  ...theme.mixins.toolbar,
}));

const drawerWidth = 250;

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(["width", "margin"], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(open && {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}));

const openedMixin = (theme) => ({
  width: drawerWidth,
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: "hidden",
});

const closedMixin = (theme) => ({
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: "hidden",
  width: `calc(${theme.spacing(4)} + 1px)`,
});

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  width: drawerWidth,
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
}));

function CustomTabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <Box
      role="tabpanel"
      component="main"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      sx={{
        height: 1,
        width: 1,
        p: 0,
        display: "flex",
        flexDirection: "column",
      }}
      {...other}
    >
      {value === index && (
        <>
          <DrawerHeader sx={{ flexGrow: 0 }} />
          <Box sx={{ width: 1, flexGrow: 1, minHeight: 0, minWidth: 0 }}>
            {children}
          </Box>
        </>
      )}
    </Box>
  );
}

function Index(props) {
  const [mapPosition, setMapPosition] = useState(defaultMapPosition);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const mapRef = useRef();
  const activityContext = useContext(ActivityContext);
  const filterContext = useContext(FilterContext);
  /*const activityContext = useContext(ActivityContext);*/
  const [athlete, setAthlete] = useQueryParam(
    "athlete",
    withDefault(NumberParam, 0)
  );
  console.log(filterContext.filterRanges);

  return (
    <Box sx={{ display: "flex", width: 1, height: 1 }}>
      <CssBaseline />
      <AppBar position="fixed" open={open}>
        <ThemeProvider theme={darkTheme}>
          <Toolbar sx={{ pl: { xs: 0, sm: 0 } }}>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              onClick={() => {
                setOpen(true);
              }}
              edge="start"
              sx={{
                p: 0,
                mx: 0.25,
                ...(open && { display: "none" }),
              }}
            >
              <ChevronRightIcon />
            </IconButton>
            <MapIcon sx={{ mx: 1, display: { xs: "none", sm: "flex" } }} />
            <Typography
              variant="h6"
              noWrap
              component="a"
              href="/"
              sx={{
                mr: 2,
                fontWeight: 700,
                color: "inherit",
                textDecoration: "none",
                display: { xs: "none", sm: "flex" },
              }}
            >
              StravaMap
            </Typography>
            <Box>
              <Tabs
                value={page}
                onChange={(e, v) => {
                  setPage(v);
                }}
                textColor="inherit"
                TabIndicatorProps={{
                  style: {
                    backgroundColor: "white",
                  },
                }}
              >
                <Tab label="Map" id="map" />
                <Tab label="List" id="list" />
              </Tabs>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <User mapRef={mapRef} />
          </Toolbar>
        </ThemeProvider>
      </AppBar>
      <Drawer variant="permanent" open={open}>
        <DrawerHeader>
          <IconButton
            onClick={() => {
              setOpen(false);
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
        </DrawerHeader>
        <Divider />
        <Box
          sx={{
            width: 1,
            height: 1,
          }}
        >
          <List>
            {Object.keys(categorySettings).map((key) => (
              <ListItem sx={{ px: 0, py: 0 }} key={key}>
                <MultiSelect open={open} name={key} />
              </ListItem>
            ))}
          </List>
          <Divider />
          <List>
            <ListItem sx={{ px: 0, py: 0 }} key="search">
              <SearchBox open={open} />
            </ListItem>
            {Object.keys(binaryFilters).map((key) => (
              <ListItem sx={{ px: 0, py: 0 }} key={key}>
                <CheckboxFilter open={open} name={key} />
              </ListItem>
            ))}
          </List>
          <Divider />
          <List>
            {Object.keys(filterSettings).map((key) => (
              <ListItem sx={{ px: 0, py: 0 }} key={key}>
                <ValueSlider open={open} name={key} />
              </ListItem>
            ))}
          </List>
          {/*
          <Divider />
          {activityContext.loaded && (
            <List>
              <ListItem sx={{ px: 0, py: 1 }} key="datePicker">
                <DateFilter open={open} />
              </ListItem>
            </List>
          )}
          <Divider />*/}
        </Box>
      </Drawer>
      <CustomTabPanel value={page} index={0}>
        <MapView mapRef={mapRef} mapPosition={mapPosition} />
      </CustomTabPanel>
      <CustomTabPanel value={page} index={1}>
        <ListView />
      </CustomTabPanel>
      <Backdrop
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={activityContext.loading}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </Box>
  );
  return (
    <>
      <Layout nav={<PageLinks />} mapRef={mapRef}>
        <h1>Home</h1>
      </Layout>
    </>
  );
  return (
    <>
      <CustomTabPanel value={props.page} index={0}>
        <Map mapRef={props.mapRef} mapPosition={props.mapPosition} />
      </CustomTabPanel>
      <CustomTabPanel value={props.page} index={1}>
        <List />
      </CustomTabPanel>
    </>
  );
}

export default Index;
