import { useContext, createContext, useEffect, useReducer } from "react";

import { ActivityContext } from "./ActivityContext";
import { FilterContext } from "./FilterContext";
import * as d3 from "d3";

import {
  timelineSettings,
  calendarSettings,
  scatterSettings,
} from "../settings";

const defaultStats = {
  data: [],
  allData: [],
  loaded: false,
  extent: [undefined, undefined],
  timeline: {
    timePeriod: timelineSettings.timePeriods.month,
    value: timelineSettings.values.elevation,
    group: timelineSettings.groups.sport_group,
    averaging: 2,
    yScale: timelineSettings.yScales.linear,
  },
  calendar: {
    value: calendarSettings.values.elevation,
  },
  scatter: {
    xValue: scatterSettings.values.date,
    yValue: scatterSettings.values.elevation,
    size: scatterSettings.values.distance,
    group: scatterSettings.groups.sport_group,
    color: scatterSettings.color,
  },
};

const StatsContext = createContext(defaultStats);

function reducer(state, action) {
  switch (action.type) {
    case "SET_TIMELINE":
      if ("timePeriod" in action.payload) {
        const newAveraging =
          state.timeline.averaging /
          (action.payload.timePeriod.days / state.timeline.timePeriod.days);

        action.payload.averaging = Math.min(
          Math.max(
            Math.round(newAveraging),
            action.payload.timePeriod.averaging.min
          ),
          action.payload.timePeriod.averaging.max
        );
      }
      return { ...state, timeline: { ...state.timeline, ...action.payload } };
    case "SET_CALENDAR":
      return { ...state, calendar: { ...state.calendar, ...action.payload } };
    case "SET_SCATTER":
      return { ...state, scatter: { ...state.scatter, ...action.payload } };
    case "SET_ALL_DATA":
      return { ...state, allData: action.payload };
    case "SET_FILTERED_DATA":
      return {
        ...state,
        extent: action.payload.extent,
        data: action.payload.data,
        loaded: true,
      };
    default:
      throw new Error();
  }
}

export function StatsContextProvider({ children }) {
  const activityContext = useContext(ActivityContext);
  const filterContext = useContext(FilterContext);
  const [state, dispatch] = useReducer(reducer, defaultStats);

  useEffect(() => {
    if (activityContext.loaded && state.data.length > 0) {
      dispatch({ type: "SET_TIMELINE", payload: {} });
      dispatch({ type: "SET_CALENDAR", payload: {} });
      dispatch({ type: "SET_SCATTER", payload: {} });
    }
  }, [state.data]);

  useEffect(() => {
    if (activityContext.loaded) {
      const data = activityContext.geoJson.features.map(
        (feature) => feature.properties
      );
      dispatch({ type: "SET_ALL_DATA", payload: data });
    }
  }, [activityContext.geoJson]);

  useEffect(() => {
    if (activityContext.loaded) {
      const data = state.allData.filter((feature) =>
        filterContext.filterIDs.includes(feature.id)
      );
      const extent = d3.extent(data, (f) => f.date);
      dispatch({ type: "SET_FILTERED_DATA", payload: { extent, data } });
    }
  }, [state.allData, filterContext.filterIDs]);

  return (
    <StatsContext.Provider
      value={{
        ...state,
        setTimeline: (payload) => dispatch({ type: "SET_TIMELINE", payload }),
        setCalendar: (payload) => dispatch({ type: "SET_CALENDAR", payload }),
        setScatter: (payload) => dispatch({ type: "SET_SCATTER", payload }),
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export { StatsContext };
