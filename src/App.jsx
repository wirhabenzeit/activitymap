import MapView from "/src/components/Map";
import ListView from "/src/components/List";
import {
  Box,
  Backdrop,
  CircularProgress,
  Tabs,
  Tab,
  CssBaseline,
  Toolbar,
  Typography,
  Divider,
  List,
  ListItem,
  IconButton,
} from "@mui/material";
import {
  Routes,
  Route,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { User } from "/src/components/AppBar";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import MapIcon from "@mui/icons-material/Map";
import { ThemeProvider, styled, createTheme } from "@mui/material/styles";

import MuiAppBar from "@mui/material/AppBar";
import MuiDrawer from "@mui/material/Drawer";
import { categorySettings, binaryFilters, filterSettings } from "/src/settings";
import MultiSelect from "/src/components/MultiSelect";
import SearchBox from "/src/components/SearchBox";
import ValueSlider from "/src/components/ValueSlider";
import CheckboxFilter from "/src/components/CheckboxFilter";
import { ActivityContext } from "/src/contexts/ActivityContext";

import { useState, useContext, useRef, forwardRef } from "react";

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

const pathMap = { "/": 0, "/list": 1 };

function App() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(pathMap[pathname] || 0);
  const activityContext = useContext(ActivityContext);
  const mapRef = useRef(null);
  let navigate = useNavigate();

  const goTo = (path) => {
    if (path === "/list") {
      console.log("Removing terrain");
      mapRef.current.getMap().setTerrain();
    }
    navigate(path + search);
  };

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
                <Tab
                  label="Map"
                  index={0}
                  onClick={() => {
                    goTo("/");
                  }}
                />
                <Tab
                  label="List"
                  index={1}
                  onClick={() => {
                    goTo("/list");
                  }}
                />
              </Tabs>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <User />
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
            overflowY: "scroll",
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
          {activityContext.loaded &&
            activityContext.geoJson.features.length > 1 && (
              <List>
                {Object.keys(filterSettings).map((key) => (
                  <ListItem sx={{ px: 0, py: 0 }} key={key}>
                    <ValueSlider open={open} name={key} />
                  </ListItem>
                ))}
              </List>
            )}
        </Box>
      </Drawer>
      <Box
        sx={{
          height: "100%",
          width: "calc(100% - 33px)",
          display: "flex",
          p: 0,
          flexDirection: "column",
        }}
      >
        <DrawerHeader sx={{ flexGrow: 0 }} />
        <Box sx={{ width: 1, flexGrow: 1, minHeight: 0, minWidth: 0 }}>
          <Routes>
            <Route exact path="/" element={<MapView mapRef={mapRef} />} />
            <Route exact path="/list" element={<ListView />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

export default App;
