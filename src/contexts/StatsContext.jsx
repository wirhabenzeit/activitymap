import { useContext, createContext, useState, useEffect, useRef } from "react";
import { ActivityContext } from "./ActivityContext";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3a from "d3-array";

import { aliasMap } from "../settings";

const defaultStats = {
  loaded: false,
  data: [],
  dataExtent: {},
};

const StatsContext = createContext(defaultStats);

export function StatsContextProvider({ children }) {
  const activityContext = useContext(ActivityContext);
  const [state, setState] = useState(defaultStats);

  useEffect(() => {
    if (activityContext.loaded) {
      const data = activityContext.geoJson.features.map(
        (feature) => feature.properties
      );
      data.forEach((feature) => {
        feature.date = new Date(feature.start_date_local);
      });
      setState({
        loaded: true,
        data: data,
      });
    }
  }, [activityContext.geoJson]);

  return (
    <StatsContext.Provider
      value={{
        ...state,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export { StatsContext };
