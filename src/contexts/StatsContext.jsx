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
      /*console.log(
        d3a
          .rollups(
            data,
            (v) => v.length,
            (f) => aliasMap[f.sport_type],
            (f) => f.date.getFullYear(),
            (f) => f.date.getMonth()
          )
          .map(([sport, years]) =>
            years.map(([year, data]) => [
              [sport, year],
              data.sort((a, b) => a[0] - b[0]),
            ])
          )
          .flat()
      );*/
      const extent = d3a.extent(data, (d) => d.date);
      const years = d3t.timeYear.range(
        d3t.timeYear.floor(extent[0]),
        extent[1]
      );
      //const month = d3t.timeMonth.range(...extent);
      const weeks = d3t.timeWeek.range(
        d3t.timeMonday.floor(extent[0]),
        extent[1]
      );
      //console.log(extent, years, weeks);
      //const day = d3t.timeDay.range(...extent);
      /*console.log(
        d3a.rollup(
          days,
          (v) => v.length,
          (d) => d.getFullYear(),
          (d) => d.getDay()
        )
      );
      const years = d3t.timeYear.range(
        d3t.timeYear.floor(extent[0]),
        extent[1]
      );
      const dataExtent = {
        week: [...Array(53).keys()].reduce(
          (prev, week) => ({
            ...prev,
            [week]:
              days.filter(
                (date) => parseInt(d3tf.timeFormat("%W")(date)) === week
              ).length / days.length,
          }),
          {}
        ),
        month: [...Array(12).keys()].reduce(
          (prev, month) => ({
            ...prev,
            [month]:
              days.filter((date) => date.getMonth() === month).length /
              days.length,
          }),
          {}
        ),
        day: [...Array(7).keys()].reduce(
          (prev, day) => ({
            ...prev,
            [day]:
              days.filter((date) => date.getDay() === day).length / days.length,
          }),
          {}
        ),
        days: years.reduce(
          (prev, year) => ({
            ...prev,
            [year.getFullYear()]: [...Array(7).keys()].reduce(
              (prev, day) => ({
                ...prev,
                [day]:
                  days.filter(
                    (date) =>
                      date.getFullYear() === year.getFullYear() &&
                      date.getDay() === day
                  ).length /
                  days.filter(
                    (date) => date.getFullYear() === year.getFullYear()
                  ).length,
              }),
              {}
            ),
          }),
          {}
        ),
      };
      console.log(dataExtent);*/
      setState({
        loaded: true,
        data: data,
        years: years,
        weeks: weeks,
        //dataExtent: dataExtent,
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
