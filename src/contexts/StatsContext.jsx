import { useContext, createContext, useState, useEffect } from "react";

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
    extent: [undefined, undefined],
    loaded: false,
    data: new d3.InternMap(),
    activitiesByDate: {},
    dayTotals: [],
  },
  scatter: {
    xValue: scatterSettings.values.date,
    yValue: scatterSettings.values.elevation,
    size: scatterSettings.values.distance,
    group: scatterSettings.groups.sport_group,
    color: scatterSettings.color,
    loaded: false,
    extent: {
      x: [undefined, undefined],
      y: [undefined, undefined],
      size: [undefined, undefined],
    },
    onClick: () => {},
  },
};

const StatsContext = createContext(defaultStats);

const updateCalendar = (data, calendar, selectedDays, setSelected, extent) => {
  const activitiesByDate = d3.group(data, (f) => d3.utcDay(f.date));
  const rollup = d3.rollup(
    data,
    (v) => d3.sum(v, calendar.value.fun),
    (d) => d3.timeMonth(d.date),
    (d) => d3.utcDay(d.date)
  );
  const dayTotals = d3.map(
    d3.rollup(
      data,
      (v) => d3.sum(v, calendar.value.fun),
      (d) => d3.utcDay(d.date)
    ),
    ([key, value]) => ({ date: key, value })
  );
  return {
    data: rollup,
    activitiesByDate: activitiesByDate,
    dayTotals: dayTotals,
  };
};

export function StatsContextProvider({ children }) {
  const activityContext = useContext(ActivityContext);
  const filterContext = useContext(FilterContext);
  const [state, setState] = useState(defaultStats);

  const setTimeline = (newTimeline) => {
    if ("timePeriod" in newTimeline) {
      const newAveraging =
        state.timeline.averaging /
        (newTimeline.timePeriod.days / state.timeline.timePeriod.days);

      newTimeline.averaging = Math.min(
        Math.max(
          Math.round(newAveraging),
          newTimeline.timePeriod.averaging.min
        ),
        newTimeline.timePeriod.averaging.max
      );

      console.log(newTimeline);
    }

    setState((state) => ({
      ...state,
      timeline: {
        ...state.timeline,
        ...newTimeline,
      },
    }));
  };

  const setCalendar = (newCalendar) => {
    setState((state) => ({
      ...state,
      calendar: { ...state.calendar, ...newCalendar },
    }));
  };

  const setScatter = (newScatter) => {
    setState((state) => ({
      ...state,
      scatter: {
        ...state.scatter,
        ...newScatter,
      },
    }));
  };

  useEffect(() => {
    if (activityContext.loaded && state.data.length > 0) {
      setTimeline({});
      setCalendar({});
      setScatter({});
    }
  }, [state.data]);

  useEffect(() => {
    if (activityContext.loaded) {
      const data = activityContext.geoJson.features.map(
        (feature) => feature.properties
      );
      data.forEach((feature) => {
        feature.date = new Date(feature.start_date_local);
      });
      setState({
        ...state,
        allData: data,
      });
    }
  }, [activityContext.geoJson]);

  useEffect(() => {
    if (activityContext.loaded) {
      setState((state) => {
        const data = state.allData.filter((feature) =>
          filterContext.filterIDs.includes(feature.id)
        );
        const extent = d3.extent(data, (f) => f.date);
        return {
          ...state,
          extent: extent,
          data: data,
          loaded: true,
        };
      });
    }
  }, [state.allData, filterContext.filterIDs]);

  return (
    <StatsContext.Provider
      value={{
        ...state,
        setTimeline: setTimeline,
        setCalendar: setCalendar,
        setScatter: setScatter,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export { StatsContext };
