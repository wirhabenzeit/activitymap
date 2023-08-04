import { createContext, Component } from "react";
import { createClient } from "@supabase/supabase-js";
import { filterSettings } from "./settings";
import Cookies from "js-cookie";

const supabase = createClient(
  "http://" + process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const defaultState = {
  geoJson: { type: "FeatureCollection", features: [] },
  loading: true,
  loaded: false,
  filterRange: {},
  athlete: undefined,
  code: undefined,
  athlete_name: undefined,
  athlete_img: undefined,
};

const requiredFields = new Set([
  "type",
  "name",
  "id",
  "distance",
  "moving_time",
  "elapsed_time",
  "total_elevation_gain",
  "start_date_local",
  "start_date_local_timestamp",
  "geometry:geometry_simplified",
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
]);

const ActivityContext = createContext(defaultState);

export class ActivityContextProvider extends Component {
  constructor() {
    super();
    this.state = defaultState;
  }

  async componentDidUpdate(prevProps, prevState) {
    //console.log("state changed to ", this.state);
    if (prevState.code === undefined && this.state.code !== undefined) {
      //console.log("Fetching athlete for code " + this.state.code);
      fetch(
        "http://" +
          process.env.NEXT_PUBLIC_SUPABASE_URL +
          "/functions/v1/strava-login?code=" +
          this.state.code
      )
        .then((response) => {
          //console.log(response);
          return response.json();
        })
        .then((data) => {
          //console.log(data);
          this.setState((prev) => ({ ...prev, athlete: data.athlete }));
          Cookies.set("athlete", data.athlete, { expires: 365 });
          history.pushState({}, "StravaMap", "/");
        });
    }
    if (
      (prevState.athlete === undefined || prevState.athlete === 0) &&
      this.state.athlete !== 0 &&
      this.state.athlete !== undefined
    ) {
      //console.log("Fetching data for athlete " + this.state.athlete);

      supabase
        .from("strava-athletes-profile")
        .select("*")
        .eq("id", this.state.athlete)
        .then(({ data, error }) => {
          if (data && data.length === 1)
            this.setState((prev) => ({
              ...prev,
              athlete_name: data[0].first_name + " " + data[0].last_name,
              athlete_img: data[0].profile_medium,
            }));
        });

      const { nodata, counterror, count, status } = await supabase
        .from("strava-activities")
        .select("*", { count: "exact", head: true })
        .eq("athlete", this.state.athlete);

      const pageSize = 1000;
      const numPages = Math.ceil(count / pageSize);
      const ranges = Array.from({ length: numPages }, (_, i) => [
        i * pageSize,
        (i + 1) * pageSize - 1,
      ]);
      const promises = ranges.map((range) => this.fetchSupabase(range));

      const results = await Promise.all(promises);
      //console.log("got " + results.flat().length + " out of "+count+" activities");
      //const geoJson = {"type":"FeatureCollection", "features": results.flat()};

      this.setState((prev) => ({
        ...prev,
        loading: false,
        loaded: true,
        filterRange: Object.entries(filterSettings)
          .map(([key, value]) => [
            key,
            [
              Math.min(
                ...prev.geoJson.features.map(
                  (feature) => feature.properties[key]
                )
              ),
              Math.max(
                ...prev.geoJson.features.map(
                  (feature) => feature.properties[key]
                )
              ),
            ],
          ])
          .reduce((obj, [key, value]) => ((obj[key] = value), obj), {}),
      }));
    } else if (prevState.athlete === undefined && this.state.athlete === 0) {
      this.setState((prev) => ({ ...prev, loaded: false, loading: false }));
    }
  }

  async fetchSupabase(range) {
    const { data, error } = await supabase
      .from("strava-activities")
      .select(Array.from(requiredFields).join(","))
      .eq("athlete", this.state.athlete)
      .range(...range);
    data.forEach((feature) => {
      const properties = {};
      Object.entries(feature).forEach(([key, value]) => {
        if (key != "geometry") {
          properties[key] = value;
        }
        if (key != "geometry" && key != "id") {
          delete feature[key];
        }
      });
      feature.type = "Feature";
      feature.properties = properties;
    });
    const newFilterRange = {};
    Object.keys(filterSettings).forEach((key) => {
      newFilterRange[key] = [
        Math.min(...data.map((feature) => feature.properties[key])),
        Math.max(...data.map((feature) => feature.properties[key])),
      ];
    });
    this.setState((prev) => ({
      ...prev,
      geoJson: {
        type: "FeatureCollection",
        features: [...prev.geoJson.features, ...data],
      },
    }));
    //console.log("Wrote " + data.length + " activities to geoJson");
    /*const filterRange = {};
            Object.keys(filterSettings).forEach((key) => { 
                filterRange[key] = [Math.min(...geoJson.features.map((feature) => feature.properties[key])), Math.max(...geoJson.features.map((feature) => feature.properties[key]))];
            });*/
    return data.length;
  }

  setAthlete = (athlete) => {
    this.setState((prevState) => ({ ...prevState, athlete: Number(athlete) }));
    //console.log("setAthlete", athlete);
  };

  setCode = (code) => {
    this.setState((prevState) => ({ ...prevState, code: code }));
    //console.log("setCode", code);
  };

  render = () => {
    const { children } = this.props;
    return (
      <ActivityContext.Provider
        value={{
          ...this.state,
          setAthlete: this.setAthlete,
          setCode: this.setCode,
        }}
      >
        {children}
      </ActivityContext.Provider>
    );
  };
}

export { ActivityContext };
