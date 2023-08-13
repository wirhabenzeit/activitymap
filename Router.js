import { useRouter } from "next/router";
import { useEffect, useContext, useState, cloneElement, useRef } from "react";
import { ActivityContext } from "@/components/Context/ActivityContext";
import { MapContext } from "@/components/Context/MapContext";
import Layout from "@/components/Layout";
import Cookies from "js-cookie";
import { Backdrop, CircularProgress, Box, Tabs, Tab } from "@mui/material";
import { mapSettings, defaultMapPosition } from "./settings";
import { ListContext } from "@/components/Context/ListContext";

export default function Home({ children }) {
  const activityContext = useContext(ActivityContext);
  const mapContext = useContext(MapContext);
  const listContext = useContext(ListContext);
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [mapPosition, setMapPosition] = useState(defaultMapPosition);
  const mapRef = useRef();
  const [value, setValue] = useState(0);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  function BasicTabs() {
    return (
      <Box sx={{ width: "100%" }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs
            value={value}
            onChange={handleChange}
            aria-label="basic tabs example"
          >
            <Tab label="Item One" />
            <Tab label="Item Two" />
          </Tabs>
        </Box>
      </Box>
    );
  }

  function PageLinks() {
    return (
      <>
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
      </>
    );
  }

  useEffect(() => {
    if (!router.isReady) return;
    if ("code" in router.query) {
      activityContext.setCode(router.query.code);
    }
    if ("mapPosition" in router.query) {
      const mapPos = JSON.parse(router.query.mapPosition);
      setMapPosition(mapPos);
    }
    if ("baseMap" in router.query) {
      console.log("Setting base map", router.query.baseMap);
      console.log(mapSettings[router.query.baseMap]);
      mapContext.setBaseMap(router.query.baseMap);
    }
    if ("overlayMaps" in router.query) {
      mapContext.setOverlayMaps(JSON.parse(router.query.overlayMaps));
    }
    if ("threeDim" in router.query) {
      mapContext.setThreeDim(router.query.threeDim === "true");
    }
    if ("fullListState" in router.query) {
      const listState = JSON.parse(router.query.fullListState);
      listContext.setSortModel("full", listState.sortModel);
      listContext.setColumnVisibilityModel(
        "full",
        listState.columnVisibilityModel
      );
    }
    if ("compactListState" in router.query) {
      const listState = JSON.parse(router.query.compactListState);
      listContext.setSortModel("compact", listState.sortModel);
      listContext.setColumnVisibilityModel(
        "compact",
        listState.columnVisibilityModel
      );
    }
    if ("athlete" in router.query) {
      activityContext.setAthlete(router.query.athlete);
      activityContext.setGuestMode(true);
    } else if ("activities" in router.query) {
      activityContext.setActivityList(
        router.query.activities.split(",").map((x) => parseInt(x))
      );
      activityContext.setGuestMode(true);
    } else if (Cookies.get("athlete")) {
      activityContext.setAthlete(Cookies.get("athlete"));
    } else {
      activityContext.setAthlete(null);
    }
  }, [router.isReady]);

  console.log("Router render");
  return (
    <>
      <Layout nav={<BasicTabs />} mapRef={mapRef}>
        {cloneElement(children, {
          mapPosition: mapPosition,
          mapRef: mapRef,
          page: page,
        })}
      </Layout>
      <Backdrop
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={activityContext.loading}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </>
  );
}
