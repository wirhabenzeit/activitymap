import { createContext, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Cookies from "js-cookie";
import { useSearchParams } from "react-router-dom";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const defaultState = {
  activityDict: {},
  geoJson: { type: "FeatureCollection", features: [] },
  loading: true,
  loaded: false,
  athlete: undefined,
  athlete_name: undefined,
  athlete_img: undefined,
  guestMode: false,
};

const requiredFields = new Set([
  "sport_type",
  "name",
  "id",
  "distance",
  "moving_time",
  "elapsed_time",
  "total_elevation_gain",
  "start_date_local",
  "start_date_local_timestamp",
  "geometry_simplified",
  "start_latlng",
  "end_latlng",
  "kudos_count",
  "comment_count",
  "commute",
  "average_speed",
  "max_speed",
  "average_cadence",
  "average_temp",
  "average_watts",
  "weighted_average_watts",
  "kilojoules",
  "average_heartrate",
  "max_heartrate",
  "max_watts",
  "elev_high",
  "elev_low",
  "suffer_score",
  "athlete",
  "commute",
]);

const ActivityContext = createContext(defaultState);

function ActivityContextProvider({ children }) {
  const [state, setState] = useState(defaultState);
  let [searchParams, setSearchParams] = useSearchParams();

  console.log("ActivityContextProvider render");

  useEffect(() => {
    console.log("AC state update:", state);
  }, [state]);

  const getAthleteData = async (athlete) => {
    const { data, error } = await supabase
      .from("strava-athletes-profile")
      .select("*")
      .eq("id", athlete);
    if (data && data.length === 1)
      return {
        athlete: athlete,
        athlete_name: data[0].first_name + " " + data[0].last_name,
        athlete_img: data[0].profile_medium,
      };
    else throw new Error("No athlete data found");
  };

  const getAthleteActivities = async (athlete) => {
    const { nodata, counterror, count, status } = await supabase
      .from("strava-activities")
      .select("*", { count: "exact", head: true })
      .eq("athlete", athlete);

    const pageSize = 1000;
    const numPages = Math.ceil(count / pageSize);
    const ranges = Array.from({ length: numPages }, (_, i) => [
      i * pageSize,
      (i + 1) * pageSize - 1,
    ]);
    const promises = ranges.map((range) =>
      fetchSupabase((sb) => sb.eq("athlete", athlete).range(...range))
    );
    return Promise.all(promises);
  };

  const loadMore = async () => {
    console.log("loading more");
    setState((prev) => ({ ...prev, loading: true }));
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-webhook?page=${
        Math.floor(state.geoJson.features.length / 200) + 1
      }&owner_id=${state.athlete}&aspect_type=create&object_type=activity`
    );
    const data = await response.json();
    console.log(data);
    const newData = data.filter(
      (act) => !state.geoJson.features.some((a) => a.id === act.id)
    );
    console.log(newData);
    if (newData.length > 0) {
      const newGeojsonFeatures = newData.map(parseFeature);
      const activityDict = newData.reduce((obj, act) => {
        obj[act.id] = act;
        return obj;
      }, {});
      setState((prev) => ({
        ...prev,
        activityDict: { ...prev.activityDict, ...activityDict },
        geoJson: {
          type: "FeatureCollection",
          features: [...prev.geoJson.features, ...newGeojsonFeatures],
        },
      }));
      setState((prev) => ({ ...prev, loading: false }));
      return newData.length;
    } else {
      console.log("no new data");
      setState((prev) => ({ ...prev, loading: false }));
      return 0;
    }
  };

  const parseFeature = (feature) => {
    feature.bbox = feature.geometry_simplified.coordinates.reduce(
      (acc, coord) => {
        return [
          Math.min(acc[0], coord[0]),
          Math.min(acc[1], coord[1]),
          Math.max(acc[2], coord[0]),
          Math.max(acc[3], coord[1]),
        ];
      },
      [Infinity, Infinity, -Infinity, -Infinity]
    );
    const jsonFeature = {
      type: "Feature",
      geometry: feature.geometry_simplified,
      bbox: feature.bbox,
      id: feature.id,
      properties: {},
    };
    Object.entries(feature).forEach(([key, value]) => {
      if (key != "geometry_simplified" && key != "bbox") {
        jsonFeature.properties[key] = value;
      }
    });
    return jsonFeature;
  };

  const fetchSupabase = async (query) => {
    const { data, error } = await query(
      supabase
        .from("strava-activities")
        .select(Array.from(requiredFields).join(","))
    );
    return data.map(parseFeature);
  };

  const setAthlete = async (athlete) => {
    const athlete_data = await getAthleteData(athlete);
    const activities = await getAthleteActivities(athlete);
    setState((prevState) => ({
      ...prevState,
      ...athlete_data,
      loading: false,
      loaded: true,
      geoJson: { type: "FeatureCollection", features: activities.flat() },
      activityDict: activities.flat().reduce((obj, act) => {
        obj[act.id] = act;
        return obj;
      }, {}),
    }));
  };

  const setActivityList = async (activityList) => {
    //console.log(activityList);
    const activities = await fetchSupabase((sb) => sb.in("id", activityList));
    //onsole.log(activities);
    setState((prevState) => ({
      ...prevState,
      loading: false,
      loaded: true,
      guestMode: true,
      geoJson: { type: "FeatureCollection", features: activities },
      activityDict: activities.reduce((obj, act) => {
        obj[act.id] = act;
        return obj;
      }, {}),
    }));
  };

  const setCode = async (code) => {
    const url =
      import.meta.env.VITE_SUPABASE_URL +
      "/functions/v1/strava-login?code=" +
      code;
    const response = await fetch(url);
    const data = await response.json();
    console.log(data);
    Cookies.set("athlete", data.athlete, { expires: 365 });
    history.replaceState(
      {},
      "StravaMap",
      window.location.origin + window.location.pathname
    );
    setAthlete(data.athlete);
  };

  const setGuestMode = () => {
    setState((prevState) => ({
      ...prevState,
      loaded: false,
      loading: false,
      guestMode: true,
    }));
  };

  useEffect(() => {
    console.log(searchParams.toString());
    if (searchParams.get("code")) setCode(searchParams.get("code"));
    else if (searchParams.get("athlete"))
      setAthlete(Number(searchParams.get("athlete")));
    else if (searchParams.get("activities"))
      setActivityList(
        searchParams
          .get("activities")
          .split(",")
          .map((x) => parseInt(x))
      );
    else if (Cookies.get("athlete")) setAthlete(Number(Cookies.get("athlete")));
    else setGuestMode();
  }, []);

  return (
    <ActivityContext.Provider
      value={{
        ...state,
        setAthlete: setAthlete,
        setCode: setCode,
        loadMore: loadMore,
        setGuestMode: setGuestMode,
        setActivityList: setActivityList,
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export { ActivityContext, ActivityContextProvider };
