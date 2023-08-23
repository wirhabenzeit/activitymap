import { useContext, createContext, useState, useEffect, useRef } from "react";
import { ActivityContext } from "./ActivityContext";
import { FilterContext } from "./FilterContext";
import * as d3tf from "d3-time-format";
import * as d3 from "d3-array";

import { timelineSettings, pieSettings, calendarSettings } from "../settings";

const defaultTimeline = {
  timePeriod: timelineSettings.timePeriods.week,
  value: timelineSettings.values.time,
  group: timelineSettings.groups.sport_group,
  timeGroup: timelineSettings.timeGroups.byYear(2023),
  loaded: false,
};

const defaultStats = {
  data: [],
  extent: [undefined, undefined],
  timeline: {
    ...defaultTimeline,
    stat: timelineSettings.stats(defaultTimeline).cumTotal,
    data: [],
  },
  pie: {
    value: pieSettings.values.elevation,
    group: pieSettings.groups.sport_group,
    timeGroup: pieSettings.timeGroups.all(2023),
    loaded: false,
  },
  calendar: {
    value: calendarSettings.values.elevation,
    extent: [undefined, undefined],
  },
};

const StatsContext = createContext(defaultStats);

const updateCalendar = (data, calendar) => {
  const rollup = d3.rollups(data, calendar.value.fun, (f) =>
    d3tf.timeFormat("%Y-%m-%d")(f.date)
  );
  return d3.map(rollup, ([key, value]) => ({
    value: value,
    day: key,
  }));
};

const updatePie = (data, pie) => {
  const filteredData = d3.filter(data, (f) => pie.timeGroup.filter(f));
  const rollup = d3.rollups(filteredData, pie.value.fun, pie.group.fun);
  rollup.sort(pie.group.sort);
  return d3.map(rollup, ([key, value]) => ({
    id: key,
    value: value,
    color: pie.group.color(key),
  }));
};

const updateTimeline = (data, timeline, setTimeline) => {
  const extent = d3.extent(data, (d) => d.date);
  const years = extent.map((d) => d.getFullYear());
  const extentInYear = (year) => [
    year == years[0] ? extent[0] : new Date(year, 0, 1),
    year == years[1] ? extent[1] : new Date(year, 11, 31),
  ];
  const rollup = d3.rollup(
    data,
    timeline.stat.fun,
    (f) =>
      JSON.stringify({
        group: timeline.group.fun(f),
        year: timeline.timeGroup.fun(f),
      }),
    (f) => timeline.timePeriod.fun(f.date)
  );
  const fillZeros = (data, extent) => {
    const out = [];
    timeline.timePeriod.range(extent).forEach((date) => {
      const transformedDate = timeline.timePeriod.fun(date);
      if (data.has(transformedDate)) {
        out.push([transformedDate, data.get(transformedDate)]);
      } else {
        out.push([transformedDate, 0]);
      }
    });
    return out;
  };

  const makeCumulative = (data) => {
    return d3.zip(
      data.map(([x, y]) => x),
      d3.cumsum(data.map(([x, y]) => y))
    );
  };
  const rollupData = Array.from(rollup.entries()).map(([id, data]) => {
    id = JSON.parse(id);
    return [
      id,
      timeline.stat.cumulative
        ? makeCumulative(
            fillZeros(
              data,
              timeline.timeGroup.highlight
                ? extentInYear(id.year)
                : timeline.timePeriod.relative
                ? extentInYear(2018)
                : extent
            )
          )
        : fillZeros(
            data,
            timeline.timeGroup.highlight
              ? extentInYear(id.year)
              : timeline.timePeriod.relative
              ? extentInYear(2018)
              : extent
          ),
    ];
  });

  const outData = rollupData.map(([id, data]) => ({
    id: JSON.stringify(id),
    color: timeline.group.color(id.group),
    icon: timeline.group.icon(id.group),
    alpha: id.year == timeline.timeGroup.highlight ? 1 : 0.1,
    data: data.map(([x, y]) => ({ x: d3tf.timeFormat("%Y-%m-%d")(x), y: y })),
    xLabel: (x) =>
      ("year" in id ? id.year + "-" : "") + timeline.timePeriod.format(x),
    yLabel: (y) => y + timeline.stat.unit,
    onClick: () => {
      if ("year" in id)
        setTimeline({
          ...timeline,
          timeGroup: timelineSettings.timeGroups.byYear(id.year),
        });
    },
  }));
  return outData;
};

export function StatsContextProvider({ children }) {
  const activityContext = useContext(ActivityContext);
  const filterContext = useContext(FilterContext);
  const [state, setState] = useState(defaultStats);

  const setTimeline = (newTimeline) => {
    const timeline = { ...state.timeline, ...newTimeline };
    // stats depend on the other props
    if (!("stat" in newTimeline))
      timeline.stat = timelineSettings.stats(timeline)[timeline.stat.id];
    // if switching from relative to absolute, reset timeGroup to all
    if (
      "timePeriod" in newTimeline &&
      !newTimeline.timePeriod.relative &&
      timeline.timeGroup.highlight
    )
      timeline.timeGroup = timelineSettings.timeGroups.all(
        timeline.timeGroup.highlight
      );

    const data = updateTimeline(
      d3.filter(state.data, (f) => filterContext.filterIDs.includes(f.id)),
      timeline,
      setTimeline
    );
    setState((state) => ({
      ...state,
      timeline: {
        ...state.timeline,
        ...timeline,
        data: data,
        loaded: true,
      },
    }));
  };

  const setPie = (newPie) => {
    const pie = { ...state.pie, ...newPie };
    const data = updatePie(
      d3.filter(state.data, (f) => filterContext.filterIDs.includes(f.id)),
      pie
    );
    setState((state) => ({
      ...state,
      pie: {
        ...pie,
        data: data,
        loaded: true,
      },
    }));
  };

  const setCalendar = (newCalendar) => {
    const calendar = { ...state.calendar, ...newCalendar };
    const filteredData = d3.filter(state.data, (f) =>
      filterContext.filterIDs.includes(f.id)
    );
    const data = updateCalendar(filteredData, calendar);
    setState((state) => ({
      ...state,
      calendar: {
        ...calendar,
        data: data,
        extent: d3.extent(filteredData, (f) => f.date),
        loaded: true,
      },
    }));
  };

  useEffect(() => {
    if (activityContext.loaded && state.data.length > 0) {
      setTimeline({
        extent: d3.extent(
          activityContext.geoJson.features,
          (f) => f.properties.date
        ),
      });
      setPie({});
      setCalendar({});
    }
  }, [activityContext.loaded, filterContext.filterIDs]);

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
        loaded: true,
        extent: d3.extent(data, (f) => f.date),
        data: data,
      });
    }
  }, [activityContext.geoJson]);

  return (
    <StatsContext.Provider
      value={{
        ...state,
        setTimeline: setTimeline,
        setPie: setPie,
        setCalendar: setCalendar,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export { StatsContext };
