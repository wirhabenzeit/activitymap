"use client";
import {createTheme} from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Theme {
    customValues: {
      drawerWidth: number;
      toolbarHeight: number;
    };
  }
  // allow configuration using `createTheme`
  interface ThemeOptions {
    customValues?: {
      drawerWidth?: number;
      toolbarHeight?: number;
    };
  }
}
const theme = createTheme({
  customValues: {
    drawerWidth: 250,
    toolbarHeight: 48,
  },
});

export default theme;
