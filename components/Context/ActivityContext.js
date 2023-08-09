import { createContext, Component } from "react";
import { createClient } from "@supabase/supabase-js";
import { filterSettings } from "@/settings";
import Cookies from "js-cookie";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const defaultState = {
  activityDict: {},
  geoJson: { type: "FeatureCollection", features: [] },
  loading: true,
  loaded: false,
  filterRange: {},
  athlete: undefined,
  code: undefined,
  athlete_name: undefined,
  athlete_img: undefined,
  guestMode: false,
  activityList: [],
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

export class ActivityContextProvider extends Component {
  constructor() {
    super();
    this.state = defaultState;
  }

  getAthleteData = async () => {
    const { data, error } = await supabase
      .from("strava-athletes-profile")
      .select("*")
      .eq("id", this.state.athlete);
    if (data && data.length === 1)
      this.setState((prev) => ({
        ...prev,
        athlete_name: data[0].first_name + " " + data[0].last_name,
        athlete_img: data[0].profile_medium,
      }));
  };

  getAthleteActivities = async () => {
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
    const promises = ranges.map((range) =>
      this.fetchSupabase((sb) =>
        sb.eq("athlete", this.state.athlete).range(...range)
      )
    );
    return Promise.all(promises);
  };

  setFilterRanges = () => {
    this.setState((prev) => ({
      ...prev,
      loading: false,
      loaded: true,
      filterRange: Object.entries(filterSettings)
        .map(([key, value]) => [
          key,
          [
            Math.min(
              ...prev.geoJson.features.map((feature) => feature.properties[key])
            ),
            Math.max(
              ...prev.geoJson.features.map((feature) => feature.properties[key])
            ),
          ],
        ])
        .reduce((obj, [key, value]) => ((obj[key] = value), obj), {}),
    }));
  };

  async componentDidUpdate(prevProps, prevState) {
    console.log("state changed to ", this.state);
    if (prevState.code === undefined && this.state.code !== undefined) {
      fetch(
        process.env.NEXT_PUBLIC_SUPABASE_URL +
          "/functions/v1/strava-login?code=" +
          this.state.code
      )
        .then((response) => {
          return response.json();
        })
        .then((data) => {
          this.setState((prev) => ({ ...prev, athlete: data.athlete }));
          Cookies.set("athlete", data.athlete, { expires: 365 });
          history.pushState({}, "StravaMap", "/list");
        });
    } else if (
      (prevState.athlete === undefined || prevState.athlete === 0) &&
      this.state.athlete !== 0 &&
      this.state.athlete !== undefined
    ) {
      this.getAthleteData();
      const result = await this.getAthleteActivities();
      this.setFilterRanges();
    } else if (
      prevState.activityList.length === 0 &&
      this.state.activityList.length > 0
    ) {
      const result = await this.fetchSupabase((sb) =>
        sb.in("id", this.state.activityList)
      );
      this.setFilterRanges();
    } else if (prevState.athlete === undefined && this.state.athlete === 0) {
      this.setState((prev) => ({ ...prev, loaded: false, loading: false }));
    }
  }

  loadMore = async () => {
    console.log("loading more");
    this.setState((prev) => ({ ...prev, loading: true }));
    const response = await fetch(
      `${
        process.env.NEXT_PUBLIC_SUPABASE_URL
      }/functions/v1/strava-webhook?page=${
        Math.floor(this.state.geoJson.features.length / 200) + 1
      }&owner_id=${this.state.athlete}&aspect_type=create&object_type=activity`
    );
    const data = await response.json();
    console.log(data);
    const newData = data.filter(
      (act) => !this.state.geoJson.features.some((a) => a.id === act.id)
    );
    console.log(newData);
    if (newData.length > 0) {
      const newGeojsonFeatures = newData.map(this.parseFeature);
      const activityDict = newData.reduce((obj, act) => {
        obj[act.id] = act;
        return obj;
      }, {});
      this.setState((prev) => ({
        ...prev,
        activityDict: { ...prev.activityDict, ...activityDict },
        geoJson: {
          type: "FeatureCollection",
          features: [...prev.geoJson.features, ...newGeojsonFeatures],
        },
      }));
      this.setState((prev) => ({ ...prev, loading: false }));
      return newData.length;
    } else {
      console.log("no new data");
      this.setState((prev) => ({ ...prev, loading: false }));
      return 0;
    }
  };

  parseFeature = (feature) => {
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

  async fetchSupabase(query) {
    const { data, error } = await query(
      supabase
        .from("strava-activities")
        .select(Array.from(requiredFields).join(","))
    );
    const featureList = [];
    const activityDict = {};
    data.forEach((feature) => {
      const jsonFeature = this.parseFeature(feature);
      activityDict[feature.id] = feature;
      featureList.push(jsonFeature);
    });
    this.setState((prev) => ({
      ...prev,
      activityDict: { ...prev.activityDict, ...activityDict },
      geoJson: {
        type: "FeatureCollection",
        features: [...prev.geoJson.features, ...featureList],
      },
    }));
    return data.length;
  }

  setAthlete = (athlete) => {
    this.setState((prevState) => ({ ...prevState, athlete: Number(athlete) }));
    //console.log("setAthlete", athlete);
  };

  setActivityList = (activities) => {
    this.setState((prevState) => ({
      ...prevState,
      activityList: activities,
    }));
  };

  setCode = (code) => {
    this.setState((prevState) => ({ ...prevState, code: code }));
    //console.log("setCode", code);
  };

  setGuestMode = () => {
    this.setState((prevState) => ({ ...prevState, guestMode: true }));
  };

  render = () => {
    console.log("ActivityContext render");
    const { children } = this.props;
    return (
      <ActivityContext.Provider
        value={{
          ...this.state,
          setAthlete: this.setAthlete,
          setCode: this.setCode,
          loadMore: this.loadMore,
          setGuestMode: this.setGuestMode,
          setActivityList: this.setActivityList,
        }}
      >
        {children}
      </ActivityContext.Provider>
    );
  };
}

export { ActivityContext };
