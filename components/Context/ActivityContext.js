import { createContext, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams } from "react-router-dom";
import { filterSettings } from "@/settings";
import Cookies from "js-cookie";
//import { useSearchParams } from "next/navigation";
//import { useQueryParams, NumberParam, withDefault } from "use-query-params";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const defaultState = {
  activityDict: {},
  geoJson: { type: "FeatureCollection", features: [] },
  loading: true,
  loaded: false,
  athlete: undefined,
  code: undefined,
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

export function ActivityContextProvider({ children }) {
  const [state, setState] = useState(defaultState);
  console.log("query:", useSearchParams().get("athlete"));
  //const [query, setQuery] = useQueryParams({ athlete: NumberParam });

  /*useEffect(() => {
    if (state.athlete !== undefined && state.athlete !== 0) {
      const fetchData = async () => {
        getAthleteData();
        const result = await getAthleteActivities();
        setFilterRanges();
      };
      fetchData();
    }
  }, [state.athlete]);*/

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

  /*async componentDidUpdate(prevProps, prevState) {
    console.log("state changed to ", state);
    if (prevState.code === undefined && state.code !== undefined) {
      fetch(
        process.env.NEXT_PUBLIC_SUPABASE_URL +
          "/functions/v1/strava-login?code=" +
          state.code
      )
        .then((response) => {
          return response.json();
        })
        .then((data) => {
          setState((prev) => ({ ...prev, athlete: data.athlete }));
          Cookies.set("athlete", data.athlete, { expires: 365 });
          history.pushState({}, "StravaMap", "/list");
        });
    } else if (
      (prevState.athlete === undefined || prevState.athlete === 0) &&
      state.athlete !== 0 &&
      state.athlete !== undefined
    ) {
      this.getAthleteData();
      const result = await this.getAthleteActivities();
      this.setFilterRanges();
    } else if (
      prevState.activityList.length === 0 &&
      state.activityList.length > 0
    ) {
      const result = await this.stateabase((sb) =>
        sb.in("id", state.activityList)
      );
      this.setFilterRanges();
    } else if (prevState.athlete === undefined && state.athlete === 0) {
      setState((prev) => ({ ...prev, loaded: false, loading: false }));
    }
  }*/

  const loadMore = async () => {
    console.log("loading more");
    setState((prev) => ({ ...prev, loading: true }));
    const response = await fetch(
      `${
        process.env.NEXT_PUBLIC_SUPABASE_URL
      }/functions/v1/strava-webhook?page=${
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
    //const activityDict = {};
    return data.map(parseFeature);
    setState((prev) => ({
      ...prev,
      activityDict: { ...prev.activityDict, ...activityDict },
      geoJson: {
        type: "FeatureCollection",
        features: [...prev.geoJson.features, ...featureList],
      },
    }));
    return data.length;
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
    //setFilterRanges();
    //setState((prevState) => ({ ...prevState, athlete: Number(athlete) }));
    //console.log("setAthlete", athlete);
  };

  const setActivityList = (activities) => {
    setState((prevState) => ({
      ...prevState,
      activityList: activities,
    }));
  };

  const setCode = (code) => {
    setState((prevState) => ({ ...prevState, code: code }));
    //console.log("setCode", code);
  };

  const setGuestMode = () => {
    setState((prevState) => ({ ...prevState, guestMode: true }));
  };

  //setAthlete(Cookies.get("athlete"));

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

export { ActivityContext };
