import {
  useState,
  useContext,
  useRef,
  useEffect,
} from "react";
import {
  Box,
  Tabs,
  Tab,
  CssBaseline,
  Toolbar,
  Typography,
  Divider,
  List,
  ListItem,
  IconButton,
  AppBar as MuiAppBar,
  Drawer as MuiDrawer,
} from "@mui/material";
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Map as MapIcon,
} from "@mui/icons-material";
import {
  ThemeProvider,
  styled,
  createTheme,
} from "@mui/material/styles";
import {
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { ActivityContext } from "/src/contexts/ActivityContext";

import MapView from "/src/components/Map";
import ListView from "/src/components/List";
import StatsView from "/src/components/Stats";
import { User } from "/src/components/AppBar";
import {
  MultiSelect,
  SearchBox,
  ValueSlider,
  CheckboxFilter,
} from "/src/components/Drawer";

import {
  categorySettings,
  binaryFilters,
  filterSettings,
} from "/src/settings";

export const usePrevious = (value, initialValue) => {
  const ref = useRef(initialValue);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
};

export const useEffectDebugger = (
  effectHook,
  dependencies,
  dependencyNames = []
) => {
  const previousDeps = usePrevious(dependencies, []);

  const changedDeps = dependencies.reduce(
    (accum, dependency, index) => {
      if (dependency !== previousDeps[index]) {
        const keyName = dependencyNames[index] || index;
        return {
          ...accum,
          [keyName]: {
            before: previousDeps[index],
            after: dependency,
          },
        };
      }

      return accum;
    },
    {}
  );

  if (Object.keys(changedDeps).length) {
    console.log("[use-effect-debugger] ", changedDeps);
  }

  useEffect(effectHook, dependencies);
};

const StyledTab = styled((props) => (
  <Tab disableRipple {...props} />
))(({ theme }) => ({
  minWidth: 60,
}));

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const toolbarHeight = 48;
const drawerWidth = 250;

const DrawerHeader = styled("div")(({ theme }) => {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0, 1),
    minHeight: toolbarHeight,
  };
});

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(
    ["width", "margin"],
    {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }
  ),
  "& .MuiToolbar-root": {
    minHeight: toolbarHeight,
  },
  ...(open && {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(
      ["width", "margin"],
      {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.enteringScreen,
      }
    ),
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

const pathMap = {
  "/": 0,
  "/list": 1,
  "/stats": 2,
  "/stats2": 3,
};

function App() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(pathMap[pathname] || 0);
  const activityContext = useContext(ActivityContext);
  const mapRef = useRef(null);
  let navigate = useNavigate();

  const goTo = (path) => {
    if (page === 0) {
      console.log("Removing terrain");
      mapRef.current.getMap().setTerrain();
    }
    navigate(path + search);
  };

  return (
    <Box
      sx={{
        display: "flex",
        width: 1,
        height: 1,
        overflowY: "hidden",
      }}
    >
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
            <MapIcon
              sx={{
                mx: 1,
                display: { xs: "none", sm: "flex" },
              }}
            />
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
              ActivityMap
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
                <StyledTab
                  label="Map"
                  index={0}
                  onClick={() => {
                    goTo("/");
                  }}
                />
                <StyledTab
                  label="List"
                  index={1}
                  onClick={() => {
                    goTo("/list");
                  }}
                />
                <StyledTab
                  label="Stats"
                  index={2}
                  onClick={() => {
                    goTo("/stats");
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
        <Box>
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
          maxHeight: "100%",
          overflow: "hidden",
          width: open
            ? "calc(100% - 250px)"
            : "calc(100% - 33px)",
          p: 0,
        }}
      >
        <DrawerHeader sx={{ flexGrow: 0 }} />
        <Box
          sx={{
            width: 1,
            height: "calc(100% - 48px)",
            maxHeight: "calc(100% - 48px)",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <Routes>
            <Route
              exact
              path="/"
              element={<MapView mapRef={mapRef} />}
            />
            <Route
              exact
              path="/list"
              element={<ListView />}
            />
            <Route
              exact
              path="/stats"
              element={<StatsView open={open} />}
            />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

export default App;
