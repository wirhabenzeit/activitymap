import React, {
  useContext,
  cloneElement,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { scaleLinear, scaleSqrt, scaleOrdinal } from "@visx/scale";

import { Circle } from "@visx/shape";
import { Group } from "@visx/group";
import { Axis, AxisLeft } from "@visx/axis";
import {
  AnimatedAxis,
  AnimatedGridRows,
  AnimatedGridColumns,
} from "@visx/react-spring";

import { useTooltip, TooltipWithBounds, withTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { voronoi } from "@visx/voronoi";

import { StatsContext } from "../../contexts/StatsContext";
import { SelectionContext } from "../../contexts/SelectionContext";

function addAlpha(color, opacity) {
  const _opacity = Math.round(Math.min(Math.max(opacity || 1, 0), 1) * 255);
  return color + _opacity.toString(16).toUpperCase();
}
import {
  Unstable_Grid2 as Grid,
  Chip,
  Box,
  Typography,
  Slider as MuiSlider,
} from "@mui/material";
import {
  useTheme,
  styled,
  ThemeProvider,
  createTheme,
} from "@mui/material/styles";

import {
  calendarSettings,
  pieSettings,
  timelineSettings,
  scatterSettings,
  mapStatSettings,
  boxSettings,
  violinSettings,
  timelineSettingsVisx,
} from "../../settings";

import {
  TitleBox,
  CustomSelect,
  CustomPicker,
  symmetricDifference,
  ChipTooltip,
  useDimensions,
  IconTooltip,
} from "../StatsUtilities.jsx";

import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3sc from "d3-scale-chromatic";
import * as d3s from "d3-scale";
import { ThemeContext } from "@emotion/react";

const Scatter = () => {
  const statsContext = useContext(StatsContext);
  const ref = useRef(null);
  const { width, height } = useDimensions(ref);

  const values = scatterSettings.values;

  const theme = createTheme({
    palette: {
      mode: "light",
    },
  });

  return (
    <Box
      sx={{
        height: 400,
        width: "100%",
        position: "relative",
        background: "linear-gradient(#EEF8FF, #D1F5FF)",
        borderRadius: "20px",
      }}
      ref={ref}
    >
      <ThemeProvider theme={theme}>
        <TitleBox sx={{ pt: 1, pl: 1 }}>
          <Typography variant="h6" key="heading">
            Scatter
          </Typography>
          <CustomSelect
            key="xValue"
            propName="xValue"
            value={statsContext.scatter.xValue}
            name="X"
            options={values}
            setState={statsContext.setScatter}
          />
          <CustomSelect
            key="yValue"
            propName="yValue"
            value={statsContext.scatter.yValue}
            name="Y"
            options={values}
            setState={statsContext.setScatter}
          />
          <CustomSelect
            key="size"
            propName="size"
            value={statsContext.scatter.size}
            name="Size"
            options={values}
            setState={statsContext.setScatter}
          />
        </TitleBox>
        <ScatterPlot width={width} height={330} />
      </ThemeProvider>
    </Box>
  );
};

const ScatterPlot = withTooltip(
  ({
    width,
    height,
    hideTooltip,
    showTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
  }) => {
    const statsContext = useContext(StatsContext);
    const selectionContext = useContext(SelectionContext);
    const data = statsContext.data;

    const svgRef = useRef(null);
    const margin = useMemo(
      () => ({ top: 20, left: 60, right: 30, bottom: 30 }),
      []
    );
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const color = (d) =>
      statsContext.scatter.group.color(statsContext.scatter.group.fun(d));

    const xScale = useMemo(
      () =>
        scaleLinear({
          range: [margin.left, innerWidth + margin.left],
          domain: d3.extent(data, statsContext.scatter.xValue.fun),
        }),
      [data, statsContext.scatter.xValue, width]
    );

    const yScale = useMemo(
      () =>
        scaleLinear({
          range: [innerHeight + margin.top, margin.top],
          domain: d3.extent(data, statsContext.scatter.yValue.fun),
          nice: true,
        }),
      [data, statsContext.scatter.yValue, height]
    );

    const rScale = useMemo(
      () =>
        scaleSqrt({
          range: [0, 5],
          domain: d3.extent(data, statsContext.scatter.size.fun),
        }),
      [data, statsContext.scatter.size]
    );

    const colorScale = useMemo(
      () =>
        scaleOrdinal({
          range: [...new Set(data.map(color))],
          domain: [...new Set(data.map(color))],
        }),
      [data]
    );

    const voronoiLayout = useMemo(
      () =>
        voronoi({
          x: (d) => xScale(statsContext.scatter.xValue.fun(d)) ?? 0,
          y: (d) => yScale(statsContext.scatter.yValue.fun(d)) ?? 0,
          width,
          height,
        })(data),
      [data, width, height, xScale, yScale]
    );

    let tooltipTimeout;

    const handleMouseMove = useCallback(
      (event) => {
        if (tooltipTimeout) clearTimeout(tooltipTimeout);
        if (!svgRef.current) return;

        const point = localPoint(svgRef.current, event);
        if (!point) return;
        const neighborRadius = 100;
        const closest = voronoiLayout.find(point.x, point.y, neighborRadius);
        if (closest) {
          showTooltip({
            tooltipLeft: xScale(statsContext.scatter.xValue.fun(closest.data)),
            tooltipTop: yScale(statsContext.scatter.yValue.fun(closest.data)),
            tooltipData: closest.data,
          });
        }
      },
      [xScale, yScale, showTooltip, voronoiLayout]
    );

    const handleMouseLeave = useCallback(() => {
      tooltipTimeout = window.setTimeout(() => {
        hideTooltip();
      }, 300);
    }, [hideTooltip]);

    const handleClick = useCallback(
      (event) => {
        if (!svgRef.current) return;

        if (tooltipData) {
          if (event.metaKey)
            selectionContext.setSelected((selected) => {
              return symmetricDifference(selected, [tooltipData.id]);
            });
          else selectionContext.setSelected([tooltipData.id]);
        }
      },
      [tooltipData]
    );

    return (
      <>
        {statsContext.loaded && statsContext.data.length > 0 && (
          <svg width="100%" height="100%" ref={svgRef} position="relative">
            <rect
              x={margin.left}
              y={margin.top}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseLeave}
              onClick={handleClick}
            />
            <AxisLeft
              scale={yScale}
              left={margin.left}
              numTicks={5}
              tickFormat={statsContext.scatter.yValue.formatAxis}
            />
            <AnimatedAxis
              orientation="bottom"
              scale={xScale}
              top={innerHeight + margin.top}
              tickFormat={statsContext.scatter.xValue.formatAxis}
              numTicks={4}
            />
            <AnimatedGridColumns
              top={margin.top}
              scale={xScale}
              height={innerHeight}
              strokeOpacity={0.1}
              stroke="#000"
              pointerEvents="none"
              numTicks={5}
            />
            <AnimatedGridRows
              left={margin.left}
              scale={yScale}
              width={innerWidth}
              strokeOpacity={0.1}
              stroke="#000"
              pointerEvents="none"
              numTicks={5}
            />
            <Group pointerEvents="none">
              {data.map((point, i) => (
                <g key={i}>
                  <Circle
                    cx={xScale(statsContext.scatter.xValue.fun(point))}
                    cy={yScale(statsContext.scatter.yValue.fun(point))}
                    r={
                      rScale(statsContext.scatter.size.fun(point)) +
                      (tooltipData === point ||
                      selectionContext.selected.includes(point.id)
                        ? 3
                        : 0)
                    }
                    fill={
                      selectionContext.selected.includes(point.id)
                        ? "white"
                        : colorScale(color(point))
                    }
                    fillOpacity={tooltipData === point ? 1 : 0.8}
                    stroke={colorScale(color(point))}
                    strokeWidth={2}
                  />
                </g>
              ))}
            </Group>
          </svg>
        )}
        {tooltipOpen &&
          tooltipData &&
          tooltipLeft != null &&
          tooltipTop != null && (
            <IconTooltip
              left={tooltipLeft}
              top={tooltipTop}
              color={color(tooltipData)}
              textLeft=""
              textRight={tooltipData.name}
            />
          )}
      </>
    );
  }
);

export default Scatter;
