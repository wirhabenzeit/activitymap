import React, { useContext, useRef, useMemo, useState } from "react";
import { Group } from "@visx/group";
import { scaleQuantile } from "@visx/scale";
import { HeatmapCircle, HeatmapRect } from "@visx/heatmap";
import { getSeededRandom } from "@visx/mock-data";
import {
  LegendOrdinal,
  LegendItem,
  LegendLabel,
  LegendQuantile,
  LegendLinear,
} from "@visx/legend";

import { StatsContext } from "../../contexts/StatsContext";
import { SelectionContext } from "../../contexts/SelectionContext";

import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3 from "d3-array";
import * as d3sc from "d3-scale-chromatic";

import { useTooltip } from "@visx/tooltip";

const legendGlyphSize = 15;

export const background = "#f3f3f3";

import { Typography, Box, Slider as MuiSlider } from "@mui/material";
import { useTheme, styled, ThemeProvider } from "@mui/material/styles";

const Slider = styled(MuiSlider)(({ theme }) => ({
  "& .MuiSlider-markLabel": {
    fontSize: "0.7rem",
    top: "20px",
  },
  "& .MuiSlider-active": {
    marginBottom: "0px !important",
    marginTop: "20px",
    cursor: "crosshair",
    color: "green",
  },
  "& .MuiSlider-valueLabel": {
    fontSize: 11,
    fontWeight: "normal",
    backgroundColor: "unset",
    color: theme.palette.text.primary,
    "&:before": {
      display: "none",
    },
    "& *": {
      background: "transparent",
      color: theme.palette.mode === "dark" ? "#fff" : "#000",
    },
  },
  "& .MuiSlider-thumb > span": {
    transform: "translateX(0%)",
    top: 10,
  },
}));

import { calendarSettings, colorMap, iconMap } from "../../settings";

import {
  TitleBox,
  CustomSelect,
  IconTooltip,
  MultiIconTooltip,
  symmetricDifference,
  useDimensions,
} from "../StatsUtilities.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const Calendar = () => {
  const statsContext = useContext(StatsContext);
  const values = calendarSettings.values;
  const ref = useRef(null);
  const { width, height } = useDimensions(ref);

  const theme = useTheme();

  const margin = useMemo(
    () => ({
      top: 15,
      left: 20,
      right: 20,
      bottom: 30,
    }),
    []
  );

  const colorScale = scaleQuantile({
    range: d3sc.schemeReds[5],
    domain: [0, statsContext.calendar.value.maxValue],
  });

  return (
    <Box
      sx={{
        height: 200,
        width: "100%",
        position: "relative",
        background: background,
        borderRadius: "20px",
      }}
      ref={ref}
    >
      <ThemeProvider theme={theme}>
        <TitleBox>
          <Typography variant="h6" key="heading">
            Calendar
          </Typography>
          <CustomSelect
            key="value"
            propName="value"
            value={statsContext.calendar.value}
            name="Value"
            options={values}
            setState={statsContext.setCalendar}
          />
          <Box key="legend">
            <div className="legend">
              <LegendLinear
                scale={colorScale}
                labelFormat={(d, i) => statsContext.calendar.value.format(d)}
              >
                {(labels) => (
                  <div style={{ display: "flex", flexDirection: "row" }}>
                    {labels.map((label, i) => (
                      <LegendItem
                        key={`legend-quantile-${i}`}
                        margin="0 5px"
                        onClick={() => {
                          if (events)
                            alert(`clicked: ${JSON.stringify(label)}`);
                        }}
                      >
                        <svg width={legendGlyphSize} height={legendGlyphSize}>
                          <rect
                            fill={label.value}
                            width={legendGlyphSize}
                            height={legendGlyphSize}
                          />
                        </svg>
                        <LegendLabel align="left" margin="0 0 0 4px">
                          {label.text}
                        </LegendLabel>
                      </LegendItem>
                    ))}
                  </div>
                )}
              </LegendLinear>
              <style>{`
                .legend {
                  line-height: 0.9em;
                  color: #000;
                  font-size: 10px;
                  padding: 10px 10px;
                  float: left;
                  border: 1px solid rgba(255, 255, 255, 0.3);
                  border-radius: 8px;
                  margin: 5px 5px;
                }
              `}</style>
            </div>
          </Box>
        </TitleBox>
        <CalendarPlot height={125} colorScale={colorScale} margin={margin} />
      </ThemeProvider>
    </Box>
  );
};

const CalendarPlot = ({ height, margin, colorScale }) => {
  const {
    showTooltip,
    hideTooltip,
    tooltipLeft,
    tooltipTop,
    tooltipData,
    tooltipOpen,
  } = useTooltip();

  const weekPadding = 4;
  const dayPadding = 4;
  const monthPadding = 16;

  const binSize = 10;

  const statsContext = useContext(StatsContext);
  const selectionContext = useContext(SelectionContext);
  const cal = statsContext.calendar;
  const [hoverDay, setHoverDay] = useState(null);

  const extent = statsContext.extent;
  const firstMonth = d3t.timeMonth.floor(extent[0]);
  const lastMonth = d3t.timeMonth.ceil(extent[1]);
  const numWeeks = d3t.timeMonday.count(firstMonth, lastMonth);
  const numMonths = d3t.timeMonth.count(firstMonth, lastMonth);

  const weekScale = (week) =>
    d3t.timeMonday.count(firstMonth, week) * (binSize + weekPadding) +
    d3t.timeMonth.count(firstMonth, week) * monthPadding;
  const dayScale = (day) => day * (binSize + dayPadding);

  const pathMonth = (firstDay) => {
    const firstMonday = d3t.timeMonday.ceil(firstDay);
    const lastDay = d3t.timeDay.offset(d3t.timeMonth.offset(firstDay, 1), -1);
    const lastSunday = d3t.timeSunday(lastDay);

    return (
      "M " +
      (weekScale(firstDay) - weekPadding / 2) +
      "," +
      (dayScale((firstDay.getDay() + 6) % 7) - dayPadding / 2) +
      " V " +
      (dayScale(6) + binSize + dayPadding / 2) +
      " H " +
      (weekScale(lastSunday) + binSize + weekPadding / 2) +
      " V " +
      (dayScale((lastDay.getDay() + 6) % 7) + binSize + dayPadding / 2) +
      (lastDay.getTime() != lastSunday.getTime()
        ? " h " + (binSize + weekPadding)
        : "") +
      " V " +
      (dayScale(0) - dayPadding / 2) +
      " H " +
      (weekScale(firstMonday) - weekPadding / 2) +
      (firstDay != firstMonday
        ? " V " +
          (dayScale((firstDay.getDay() + 6) % 7) - dayPadding / 2) +
          " Z"
        : "")
    );
  };

  return (
    cal.loaded && (
      <div
        style={{
          overflowX: "scroll",
          overflowY: "hidden",
          whiteSpace: "noWrap",
          width: "100%",
        }}
      >
        <svg
          width={
            numWeeks * (binSize + weekPadding) +
            numMonths * monthPadding +
            margin.left +
            margin.right
          }
          height={height}
        >
          <Group top={margin.top} left={margin.left}>
            {d3t.timeMonths(firstMonth, extent[1]).map((month) => (
              <Group key={`month-group-${d3tf.timeFormat("%Y-%b")(month)}`}>
                <text
                  key={`month-label-${d3tf.timeFormat("%Y-%b")(month)}`}
                  x={weekScale(d3t.timeMonday.ceil(month))}
                  y={-8}
                  fontSize={10}
                  textAnchor="left"
                >
                  {d3tf.timeFormat("%b")(month) == "Jan"
                    ? d3tf.timeFormat("%Y")(month)
                    : d3tf.timeFormat("%b")(month)}
                </text>
                {/*<path
                  key={`month-${d3tf.timeFormat("%Y-%b")(month)}`}
                  d={pathMonth(month)}
                  fill="#fff"
                  fillOpacity={0.1}
                  stroke={background}
                  strokeWidth={1}
                  strokeOpacity={0.1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
            />*/}
                {d3t
                  .timeDays(month, d3t.timeMonth.offset(month, 1))
                  .map((day) => (
                    <rect
                      key={`heatmap-rect-${d3tf.timeFormat("%Y-%m-%d")(day)}`}
                      className="visx-heatmap-rect"
                      width={day == hoverDay ? binSize + weekPadding : binSize}
                      height={day == hoverDay ? binSize + dayPadding : binSize}
                      x={weekScale(day)}
                      y={dayScale((day.getDay() + 6) % 7)}
                      fill={
                        cal.data.get(month)?.get(day)
                          ? colorScale(cal.data.get(month)?.get(day))
                          : "#fff"
                      }
                      stroke={
                        (hoverDay && day.getTime() === hoverDay.getTime()) ||
                        cal.activitiesByDate
                          .get(day)
                          ?.map((act) =>
                            selectionContext.selected.includes(act.id)
                          )
                          .reduce((a, b) => a || b, false)
                          ? colorScale(cal.data.get(month)?.get(day))
                          : background
                      }
                      strokeWidth={2}
                      onMouseEnter={(event) => {
                        setHoverDay(day);
                        const coords = {
                          x: event.nativeEvent.layerX,
                          y: event.nativeEvent.layerY,
                        };
                        showTooltip({
                          tooltipLeft: coords.x,
                          tooltipTop: coords.y,
                          tooltipData: cal.activitiesByDate.get(day),
                        });
                      }}
                      onMouseLeave={() => {
                        hideTooltip();
                        setHoverDay(null);
                      }}
                      onClick={() => {
                        selectionContext.setSelected(
                          cal.activitiesByDate.get(day).map((act) => act.id)
                        );
                      }}
                    />
                  ))}
              </Group>
            ))}
          </Group>
        </svg>
        {tooltipOpen && tooltipData && (
          <MultiIconTooltip
            top={tooltipTop}
            left={tooltipLeft}
            rows={tooltipData.map((activity) => ({
              textRight: activity.name,
              key: activity.id,
              icon: iconMap[activity.sport_type],
              color: colorMap[activity.sport_type],
              textLeft: cal.value.format(cal.value.fun(activity)),
            }))}
          />
        )}
      </div>
    )
  );
};

export default Calendar;
