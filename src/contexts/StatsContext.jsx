import { useContext, createContext, useState, useEffect, useRef } from "react";
import { ActivityContext } from "./ActivityContext";
import { FilterContext } from "./FilterContext";
import { SelectionContext } from "./SelectionContext";
import * as d3tf from "d3-time-format";
import * as d3 from "d3-array";

import {
  timelineSettings,
  pieSettings,
  calendarSettings,
  scatterSettings,
} from "../settings";

const defaultTimeline = {
  timePeriod: timelineSettings.timePeriods.week,
  value: timelineSettings.values.time,
  group: timelineSettings.groups.sport_group,
  timeGroup: timelineSettings.timeGroups.byYear(2023),
  loaded: false,
};

const defaultStats = {
  data: [],
  allData: [],
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
    data: [],
  },
  calendar: {
    value: calendarSettings.values.elevation,
    extent: [undefined, undefined],
    loaded: false,
    data: [],
    activitiesByDate: {},
    colorScaleFn: (colors) => (value) => colors[0],
    onClick: () => {},
  },
  scatter: {
    xValue: scatterSettings.values.date,
    yValue: scatterSettings.values.elevation,
    size: scatterSettings.values.distance,
    group: scatterSettings.groups.sport_group,
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

const updateScatter = (data, scatter, setSelected) => {
  const groups = d3.group(data, scatter.group.fun);

  const extent = {
    x: d3.extent(data, scatter.xValue.fun),
    y: d3.extent(data, scatter.yValue.fun),
    size: d3.extent(data, scatter.size.fun),
  };

  const outData = d3.map(groups, ([key, value]) => ({
    id: key,
    color: scatter.group.color(key),
    icon: scatter.group.icon(key),
    data: value.map((d) => ({
      x: scatter.xValue.fun(d),
      y: scatter.yValue.fun(d),
      selected: d.selected,
      id: d.id,
      title: d.name,
      size:
        ((scatter.size.fun(d) - extent.size[0]) /
          (extent.size[1] - extent.size[0])) *
          10 +
        2,
    })),
  }));

  const onClick = (point) => setSelected([point.data.id]);

  return { data: outData, extent: extent, onClick: onClick };
};

const updateCalendar = (data, calendar, selectedDays, setSelected) => {
  const activitiesByDate = d3.group(data, (f) =>
    d3tf.timeFormat("%Y-%m-%d")(f.date)
  );
  const outData = d3.map(activitiesByDate, ([key, value]) => ({
    value: selectedDays.includes(key) ? "selected" : calendar.value.fun(value),
    day: key,
  }));
  const onClick = (point) => {
    const selected = activitiesByDate.get(point.day);
    if (selected) setSelected(selected.map((f) => f.id));
    else setSelected([]);
  };
  return {
    data: outData,
    activitiesByDate: activitiesByDate,
    onClick: onClick,
  };
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
  const selectionContext = useContext(SelectionContext);
  const [state, setState] = useState(defaultStats);

  const setTimeline = (newTimeline) => {
    const timeline = {
      ...state.timeline,
      ...newTimeline,
      extent: state.extent,
    };
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

    const data = updateTimeline(state.data, timeline, setTimeline);
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
    const data = updatePie(state.data, pie);
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
    const colorScaleFn = (colors) => {
      const realColors = colors.slice(1, colors.length - 1);
      return (value) => {
        var retVal;
        if (value === 0) retVal = colors[0];
        else if (value === "selected") retVal = colors[colors.length - 1];
        else
          retVal =
            realColors[
              Math.floor(
                Math.min(value / calendar.value.maxValue, 1) *
                  (realColors.length - 1)
              )
            ];
        return retVal;
      };
    };
    const data = updateCalendar(
      state.data,
      calendar,
      selectionContext.selected.map((id) =>
        activityContext.activityDict[id].properties.start_date_local.slice(
          0,
          10
        )
      ),
      selectionContext.setSelected
    );
    setState((state) => ({
      ...state,
      calendar: {
        ...calendar,
        ...data,
        extent: d3.extent(state.data, (f) => f.date),
        colorScaleFn: colorScaleFn,
        loaded: true,
      },
    }));
  };

  const setScatter = (newScatter) => {
    const scatter = { ...state.scatter, ...newScatter };
    const data = updateScatter(
      state.data,
      scatter,
      selectionContext.setSelected
    );
    setState((state) => ({
      ...state,
      scatter: {
        ...scatter,
        ...data,
        loaded: true,
      },
    }));
  };

  useEffect(() => {
    if (activityContext.loaded && state.data.length > 0) {
      setTimeline({});
      setPie({});
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
        feature.selected = selectionContext.selected.includes(feature.id);
      });
      console.log(data);
      setState({
        ...state,
        loaded: true,
        extent: d3.extent(data, (f) => f.date),
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
        data.forEach((feature) => {
          feature.selected = selectionContext.selected.includes(feature.id);
        });
        const extent = d3.extent(data, (f) => f.date);
        return {
          ...state,
          extent: extent,
          data: data,
        };
      });
    }
  }, [state.allData, filterContext.filterIDs, selectionContext.selected]);

  return (
    <StatsContext.Provider
      value={{
        ...state,
        setTimeline: setTimeline,
        setPie: setPie,
        setCalendar: setCalendar,
        setScatter: setScatter,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export { StatsContext };
