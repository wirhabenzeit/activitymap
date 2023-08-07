import * as React from "react";
import { styled, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import ResponsiveAppBar from "@/components/AppBar";
import CssBaseline from "@mui/material/CssBaseline";
import ResponsiveDrawer from "@/components/Drawer";

const drawerWidth = 250;

const DrawerHeader = styled("div")(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  padding: theme.spacing(0, 1),
  ...theme.mixins.toolbar,
}));

export default function Layout(props) {
  const theme = useTheme();

  const [open, setOpen] = React.useState(false);

  return (
    <Box sx={{ display: "flex", width: 1, height: 1 }}>
      <CssBaseline />
      <ResponsiveAppBar
        open={open}
        setOpen={setOpen}
        drawerWidth={drawerWidth}
        page={props.page}
        setPage={props.setPage}
      ></ResponsiveAppBar>
      <ResponsiveDrawer
        open={open}
        setOpen={setOpen}
        drawerWidth={drawerWidth}
        theme={theme}
      ></ResponsiveDrawer>
      <Box
        component="main"
        sx={{
          height: 1,
          width: `calc(100% - ${open ? drawerWidth : 32}px)`,
          p: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DrawerHeader sx={{ flexGrow: 0 }} />
        <Box sx={{ flexGrow: 1, overflow: "hidden", width: 1 }}>
          {props.children}
        </Box>
      </Box>
    </Box>
  );
}
