import { useRouter } from "next/router";
import { useEffect, useContext } from "react";
import { ActivityContext } from "@/ActivityContext";
import Layout from "@/components/Layout";
import Cookies from "js-cookie";
import { Backdrop, CircularProgress } from "@mui/material";

export default function Home(props) {
  const activityContext = useContext(ActivityContext);
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    if ("code" in router.query) {
      activityContext.setCode(router.query.code);
    }
    if ("athlete" in router.query) {
      activityContext.setAthlete(router.query.athlete);
    } else if (Cookies.get("athlete")) {
      activityContext.setAthlete(Cookies.get("athlete"));
    } else {
      activityContext.setAthlete(null);
    }
  }, [router.isReady]);
  return (
    <>
      <Layout>{props.children}</Layout>
      <Backdrop
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={activityContext.loading}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </>
  );
}
