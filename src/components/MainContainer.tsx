"use client";

import {useEffect} from "react";
import {Box} from "@mui/material";
import {styled} from "@mui/material/styles";
import {useStore} from "~/contexts/Zustand";
import type {Account} from "~/server/db/schema";
import {geo} from "@observablehq/plot";

const DrawerHeader = styled("div")(({theme}) => {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0, 1),
    minHeight: theme.customValues.toolbarHeight,
  };
});

export default function MainContainer({
  account,
  children,
}: {
  children: React.ReactNode;
  account?: Account;
}) {
  const {
    open,
    loadFromDB,
    updateFilters,
    setFilterRanges,
    setAccount,
    toggleUserSettings,
  } = useStore((state) => ({
    open: state.drawerOpen,
    loadFromDB: state.loadFromDB,
    updateFilters: state.updateFilters,
    setFilterRanges: state.setFilterRanges,
    setAccount: state.setAccount,
    toggleUserSettings: state.toggleUserSettings,
  }));

  useEffect(() => {
    if (account) setAccount(account);
    async function load() {
      const nActivities = await loadFromDB();
      if (nActivities === 0) toggleUserSettings();
    }
    const unsub = useStore.subscribe((state, prevState) => {
      if (
        state.categories !== prevState.categories ||
        state.binary !== prevState.binary ||
        state.search !== prevState.search ||
        state.values !== prevState.values
      ) {
        updateFilters();
      } else if (
        state.activityDict !== prevState.activityDict
      ) {
        setFilterRanges();
        updateFilters();
      }
    });
    load().catch(console.error);
    return unsub;
  }, []);

  return (
    <Box
      sx={{
        height: "100vh",
        overflow: "hidden",
        width: open
          ? "calc(100vw - 250px)"
          : "calc(100vw - 33px)",
        p: 0,
        left: open ? "250px" : "33px",
        position: "fixed",
      }}
    >
      <DrawerHeader sx={{flexGrow: 0}} />
      <Box
        sx={{
          width: "100%",
          height: "100%",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
