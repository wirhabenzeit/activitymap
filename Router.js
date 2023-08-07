import { useRouter } from "next/router";
import { useEffect, useContext, useState } from "react";
import { ActivityContext } from "@/ActivityContext";
import { MapContext } from "@/MapContext";
import Layout from "@/components/Layout";
import Cookies from "js-cookie";
import { Backdrop, CircularProgress } from "@mui/material";
import { mapSettings } from "./settings";
import { ListContext } from "./ListContext";

const pages = {
  "/": { name: "Map", index: 0 },
  "/list": { name: "List", index: 1 },
};

export default function Home(props) {
  const activityContext = useContext(ActivityContext);
  const mapContext = useContext(MapContext);
  const listContext = useContext(ListContext);
  const router = useRouter();
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(pages[router.pathname].index);
    if (!router.isReady) return;
    if ("code" in router.query) {
      activityContext.setCode(router.query.code);
    }
    if ("mapPosition" in router.query) {
      const mapPos = JSON.parse(router.query.mapPosition);
      console.log(mapPos);
      mapContext.updateMapPosition(mapPos);
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
  return (
    <>
      <Layout page={page} setPage={setPage}>
        {props.children}
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
