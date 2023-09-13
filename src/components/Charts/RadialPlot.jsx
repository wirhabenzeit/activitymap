import React, {
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { useGesture } from "@use-gesture/react";

import * as d3 from "d3-array";
import * as d3f from "d3-force";
import * as d3tf from "d3-time-format";
import * as d3t from "d3-time";
import * as d3sc from "d3-scale-chromatic";

import { scaleTime, scaleLinear, scaleSqrt, scaleLog } from "@visx/scale";

import { Group } from "@visx/group";
import { LineRadial } from "@visx/shape";
import { LinearGradient } from "@visx/gradient";
import { AreaStack, AreaClosed, Line } from "@visx/shape";
import { curveBasisOpen } from "@visx/curve";
import { localPoint } from "@visx/event";
import { Axis, AxisLeft } from "@visx/axis";
import { GridColumns, GridRows, GridRadial, GridAngle } from "@visx/grid";

import { StatsContext } from "../../contexts/StatsContext";

import { animated, useSpring } from "@react-spring/web";

const green = "#e5fd3d";
export const blue = "#aeeef8";
const darkgreen = "#dff84d";
export const background = "#744cca";
const darkbackground = "#603FA8";
const strokeColor = "#744cca";
const springConfig = {
  tension: 20,
};

import {
  Typography,
  Box,
  Slider as MuiSlider,
  ButtonGroup,
  Button,
  Grid,
} from "@mui/material";
import {
  useTheme,
  styled,
  ThemeProvider,
  createTheme,
} from "@mui/material/styles";

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

import { timelineSettingsVisx } from "../../settings";

import {
  TitleBox,
  CustomSelect,
  IconTooltip,
  MultiIconTooltip,
  symmetricDifference,
  useDimensions,
} from "../StatsUtilities.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const Radial = () => {
  const statsContext = useContext(StatsContext);
  const ref = useRef(null);
  const { width, height } = useDimensions(ref);
  const tl = statsContext.timelineVisx;
  const groups = timelineSettingsVisx.groups;
  const values = timelineSettingsVisx.values;
  const theme = createTheme({
    palette: {
      mode: "dark",
    },
  });

  const margin = useMemo(
    () => ({
      top: 20,
      left: 60,
      right: 30,
      bottom: 30,
    }),
    []
  );

  return (
    <Box
      sx={{
        height: 400,
        width: "100%",
        position: "relative",
        background: "linear-gradient(#204051, #3b6978)",
        borderRadius: "20px",
      }}
      ref={ref}
    >
      <ThemeProvider theme={theme}>
        <TitleBox sx={{ pt: 1, pl: 1 }}>
          <Typography
            variant="h6"
            key="heading"
            color={theme.palette.text.primary}
          >
            Yearly Timeline
          </Typography>
          <CustomSelect
            key="group"
            propName="group"
            value={tl.group}
            name="Group"
            options={groups}
            setState={statsContext.setTimelineVisx}
          />
          <CustomSelect
            key="value"
            propName="value"
            value={tl.value}
            name="Y"
            options={values}
            setState={statsContext.setTimelineVisx}
          />
          <CustomSelect
            key="timePeriod"
            propName="timePeriod"
            value={tl.timePeriod}
            name="X"
            options={timelineSettingsVisx.timePeriods}
            setState={statsContext.setTimelineVisx}
          />
        </TitleBox>
        <RadialPlot width={width} height={330} margin={margin} />
      </ThemeProvider>
    </Box>
  );
};

const RadialPlot = ({
  width,
  height,
  window,
  transform,
  zoomAroundPoint,
  setTranslate,
  margin,
  animate,
}) => {
  const statsContext = useContext(StatsContext);
  const tl = statsContext.radialTimeline;
  const theme = useTheme();

  const yScale = scaleLinear({
    domain: tl.valueExtent,
  });

  const firstDay = parseInt(d3tf.timeFormat("%j")(statsContext.extent[0]));
  const numDays = d3t.timeDay.count(...statsContext.extent);

  const xScale = scaleTime({
    range: [
      (firstDay / 365) * 2 * Math.PI,
      ((firstDay + numDays) / 365) * 2 * Math.PI,
    ],
    domain: statsContext.extent.map(d3t.timeDay),
  });

  const lineRef = useRef(null);
  const [lineLength, setLineLength] = useState(0);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const padding = 20;

  const spring = useSpring({
    frame: shouldAnimate ? 0 : 1,
    config: springConfig,
    onRest: () => setShouldAnimate(false),
  });

  // set line length once it is known after initial render
  const effectDependency = lineRef.current;
  useEffect(() => {
    if (lineRef.current) {
      setLineLength(lineRef.current.getTotalLength());
    }
  }, [effectDependency]);

  if (width < 10) return null;

  // Update scale output to match component dimensions
  yScale.range([0, height / 2 - padding]);
  const reverseYScale = yScale.copy().range(yScale.range().reverse());
  const handlePress = () => setShouldAnimate(true);

  return (
    statsContext.radialTimeline.loaded && (
      <svg
        width={width}
        height={height}
        onClick={() => setShouldAnimate(!shouldAnimate)}
      >
        <LinearGradient id="line-gradient">
          {d3.range(0, 101, 10).map((d) => (
            <stop
              key={d}
              offset={d + "%"}
              stopColor={d3sc.interpolateSpectral(d / 100)}
            />
          ))}
        </LinearGradient>
        <rect width={width} height={height} fill={background} rx={14} />
        <Group top={height / 2} left={width / 2}>
          <GridAngle
            scale={xScale}
            outerRadius={height / 2 - padding}
            stroke={green}
            strokeWidth={1}
            strokeOpacity={0.3}
            strokeDasharray="5,2"
            tickValues={d3t.timeMonth.range(
              new Date(2020, 0, 1),
              new Date(2020, 11, 31)
            )}
          />
          <GridRadial
            scale={yScale}
            numTicks={5}
            stroke={blue}
            strokeWidth={1}
            fill={blue}
            fillOpacity={0.1}
            strokeOpacity={0.2}
          />
          <AxisLeft
            top={-height / 2 + padding}
            scale={reverseYScale}
            numTicks={5}
            tickStroke="none"
            tickLabelProps={{
              fontSize: 8,
              fill: blue,
              fillOpacity: 1,
              textAnchor: "middle",
              dx: "1em",
              dy: "-0.5em",
              stroke: strokeColor,
              strokeWidth: 0.5,
              paintOrder: "stroke",
            }}
            tickFormat={statsContext.radialTimeline.value.format}
            hideAxisLine
          />
          <LineRadial
            data={tl.data}
            angle={(d) => xScale(d.date)}
            radius={(d) => yScale(d.movingAvg)}
            curve={curveBasisOpen}
          >
            {({ path }) => {
              const d = path(tl.data) || "";
              return (
                <>
                  <animated.path
                    d={d}
                    ref={lineRef}
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    strokeLinecap="round"
                    fill="none"
                    stroke={animate ? darkbackground : "url(#line-gradient)"}
                  />
                  {shouldAnimate && (
                    <animated.path
                      d={d}
                      strokeWidth={2}
                      strokeOpacity={0.8}
                      strokeLinecap="round"
                      fill="none"
                      stroke="url(#line-gradient)"
                      strokeDashoffset={spring.frame.interpolate(
                        (v) => v * lineLength
                      )}
                      strokeDasharray={lineLength}
                    />
                  )}
                </>
              );
            }}
          </LineRadial>

          {/*[firstPoint, lastPoint].map((d, i) => {
          const cx = ((xScale(date(d)) ?? 0) * Math.PI) / 180;
          const cy = -(yScale(close(d)) ?? 0);
          return (
            <circle
              key={`line-cap-${i}`}
              cx={cx}
              cy={cy}
              fill={darkgreen}
              r={3}
            />
          );
        })*/}
        </Group>
      </svg>
    )
  );
};

export default Radial;
