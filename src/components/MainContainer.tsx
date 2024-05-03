"use client";

import {useEffect} from "react";
import {Box} from "@mui/material";
import {styled} from "@mui/material/styles";
import {useStore} from "~/contexts/Zustand";

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
  children,
}: { 
  children: React.ReactNode;
}) {
  const open = useStore((state) => state.drawerOpen);
  const loadFromDB = useStore((state) => state.loadFromDB);
  const updateFilters = useStore(
    (state) => state.updateFilters
  );
  const setFilterRanges = useStore(
    (state) => state.setFilterRanges
  );

  useEffect(() => {
    async function load() {
      await loadFromDB();
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
        height: "100%",
        maxHeight: "100%",
        overflow: "hidden",
        width: open
          ? "calc(100% - 250px)"
          : "calc(100% - 33px)",
        p: 0,
      }}
    >
      <DrawerHeader sx={{flexGrow: 0}} />
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
        {children}
      </Box>
    </Box>
  );
}
