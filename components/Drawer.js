import * as React from "react";
import { styled, useTheme } from "@mui/material/styles";
import MuiDrawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { ListItem } from "@mui/material";
import MultiSelect from "@/components/MultiSelect";
import ValueSlider from "@/components/ValueSlider";
import { filterSettings, categorySettings } from "@/settings";
import { ActivityContext } from "@/components/Context/ActivityContext";

export default function ResponsiveDrawer({ open, setOpen, drawerWidth }) {
  const activityContext = React.useContext(ActivityContext);

  //console.log(activityContext.filterRange, activityContext.loaded);
  const theme = useTheme();
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

  const DrawerHeader = styled("div")(({ theme }) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0, 1),
    // necessary for content to be below app bar
    ...theme.mixins.toolbar,
  }));

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

  return (
    <Drawer
      variant="permanent"
      open={open}
      PaperProps={{ sx: { position: "unset" } }}
    >
      <DrawerHeader>
        <IconButton
          onClick={() => {
            setOpen(false);
          }}
        >
          {theme.direction === "rtl" ? (
            <ChevronRightIcon />
          ) : (
            <ChevronLeftIcon />
          )}
        </IconButton>
      </DrawerHeader>
      <Divider />
      <Box
        sx={{
          width: 1,
          height: 1,
        }}
      >
        <List sx={{ position: "unset" }}>
          {Object.keys(categorySettings).map((key) => (
            <ListItem sx={{ px: 0, py: 0, position: "unset" }} key={key}>
              <MultiSelect open={open} name={key} />
            </ListItem>
          ))}
        </List>
        {activityContext.geoJson.features.length > 1 && (
          <>
            <Divider />
            <List sx={{ position: "unset" }}>
              {Object.keys(filterSettings).map((key) => (
                <ListItem sx={{ px: 0, py: 0, position: "unset" }} key={key}>
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
          </>
        )}
      </Box>
    </Drawer>
  );
}
