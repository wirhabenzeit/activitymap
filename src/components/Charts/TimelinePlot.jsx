import React, {
  useContext,
  cloneElement,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { useGesture } from "@use-gesture/react";

import * as d3 from "d3-array";
import * as d3f from "d3-force";

import { scaleTime, scaleLinear } from "@visx/scale";

import { PatternLines } from "@visx/pattern";
import { LinearGradient } from "@visx/gradient";
import { Circle, AreaStack, AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { Axis } from "@visx/axis";
import { GridColumns, GridRows } from "@visx/grid";

import { useTooltip, TooltipWithBounds, withTooltip } from "@visx/tooltip";

import { StatsContext } from "../../contexts/StatsContext";
import { SelectionContext } from "../../contexts/SelectionContext";

import {
  Typography,
  Box,
  Slider as MuiSlider,
  ButtonGroup,
  IconButton,
  Button,
  Grid,
} from "@mui/material";
import { useTheme, styled } from "@mui/material/styles";
import {
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  ChevronRight,
  ChevronLeft,
} from "@mui/icons-material";

const Slider = styled(MuiSlider)(({ theme }) => ({
  "& .MuiSlider-markLabel": {
    //transform: "translateY(0.5rem)",
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

import { TitleBox, CustomSelect, IconTooltip } from "../StatsUtilities.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const selectedBrushStyle = {
  fill: `url(#brush_pattern)`,
  stroke: "#fff",
};

const TimelineVisx = withTooltip(
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
    const theme = useTheme();

    const groups = timelineSettingsVisx.groups;
    const values = timelineSettingsVisx.values;
    const averages = timelineSettingsVisx.averages;

    const groupNames = statsContext.timelineVisx.groups;
    const data = statsContext.timelineVisx.data;
    const color = statsContext.timelineVisx.group.color;

    const topChartRef = useRef(null);
    const [currentExtent, setCurrentExtent] = useState(statsContext.extent);
    const [transform, setTransform] = useState({
      x: 0,
      scale: 1,
    });

    useEffect(() => {
      setCurrentExtent(statsContext.extent);
    }, [statsContext.extent]);
    const [isDragging, setIsDragging] = useState(false);

    const zoomAroundPoint = (point, zoom, transform0 = undefined) => {
      if (transform0 === undefined) transform0 = transform;
      //const { x } = topChartRef.current.getBoundingClientRect();
      var scale = zoom * transform0.scale;
      var scale = Math.min(Math.max(1, scale), 50);
      var transformX =
        transform0.x - (scale / transform0.scale - 1) * (point - transform0.x);
      transformX = Math.min(Math.max(transformX, -innerWidth * (scale - 1)), 0);
      setTransform({
        scale: scale,
        x: transformX,
      });
    };

    const setTranslate = (translateX) =>
      setTransform((transform) => ({
        ...transform,
        x: Math.min(
          Math.max(
            translateX(transform.x),
            -innerWidth * (transform.scale - 1)
          ),
          0
        ),
      }));

    useGesture(
      {
        // onHover: ({ active, event }) => console.log('hover', event, active),
        // onMove: ({ event }) => console.log('move', event),
        onDrag: ({ pinching, cancel, offset: [x, y], ...rest }) => {
          if (pinching) return cancel();
          setTranslate(() => x);
        },
        onPinch: ({ origin: [ox, oy], first, movement: [ms], memo }) => {
          if (first) {
            memo = [
              transform.x,
              ox, //- topChartRef.current.getBoundingClientRect().x,
              transform.scale,
            ];
          }
          zoomAroundPoint(ox, ms, { scale: memo[2], x: memo[0] });
          return memo;
        },
        onWheel: ({ event, movement, active, pinching }) => {
          if (pinching || !active) return;
          if (
            transform.x < 0 &&
            transform.x > -innerWidth * (transform.scale - 1)
          )
            event.preventDefault();
          setTranslate((x) => x - movement[1] / 10);
        },
      },
      {
        target: topChartRef,
        drag: { from: () => [transform.x, transform.y], filterTaps: true },
        eventOptions: { passive: false },
        pinch: { rubberband: false },
      }
    );

    useEffect(() => {
      //console.log(transform);
      setCurrentExtent(
        getZoomExtent({
          scaleX: transform.scale,
          translateX: transform.x,
          translateY: 0,
          scaleY: transform.scale,
        })
      );
    }, [transform]);

    const getZoomExtent = useCallback((zoom) => {
      const domain = statsContext.extent;
      if (domain[0] === undefined) return domain;
      const domainS = domain.map((d) => d.getTime());
      const totalLength = domainS[1] - domainS[0];
      const zoomedLength = totalLength / zoom.scaleX;
      const zoomedDomainS = [
        domainS[0] - (zoom.translateX / innerWidth) * zoomedLength,
        domainS[0] +
          zoomedLength -
          (zoom.translateX / innerWidth) * zoomedLength,
      ];
      return zoomedDomainS.map((d) => new Date(d));
    });

    const [window, setWindow] = useState(
      statsContext.timelineVisx.averaging.window
    );

    const margin = useMemo(
      () => ({
        top: 100,
        left: 60,
        right: 30,
        bottom: 30,
      }),
      []
    );

    const innerHeight = height - margin.top - margin.bottom;

    const innerWidth = width - margin.left - margin.right;

    const topChartHeight = 0.85 * innerHeight;
    const separatorHeight = 15;
    const bottomChartHeight = innerHeight - topChartHeight - separatorHeight;

    const brushXScale = useMemo(
      () => scaleTime().domain(statsContext.extent).range([0, innerWidth]),
      [statsContext.extent, width, height, margin]
    );

    useEffect(() => {
      const movingAvg = new d3.InternMap(
        groupNames.map((g) => [
          g,
          timelineSettingsVisx.averages
            .movingAvg(window)
            .fun(data.map((d) => d.values.get(g))),
        ])
      );
      data.forEach((d, i) => {
        const iMovingAvg = new d3.InternMap(
          d3.map(movingAvg, ([k, g]) => [k, g[i]])
        );
        d.movingAvg = iMovingAvg;
      });
    }, [data, window]);

    const yScale = useMemo(
      () =>
        scaleLinear({
          range: [topChartHeight, 0],
          domain: [
            0,
            Math.max(
              ...data.map(({ date, movingAvg }) => d3.sum(movingAvg.values()))
            ),
          ],
          nice: true,
        }),
      [data, width, height, margin]
    );

    const brushYScale = useMemo(
      () =>
        scaleLinear({
          range: [bottomChartHeight, 0],
          domain: [
            0,
            Math.max(
              ...data.map(({ date, movingAvg }) => d3.sum(movingAvg.values()))
            ),
          ],
          nice: true,
        }),
      [data, width, height, margin]
    );

    const xScale = useMemo(
      () => scaleTime().domain(currentExtent).range([0, innerWidth]),
      [currentExtent, width, height, margin]
    );

    return (
      data.length > 0 && (
        <>
          <svg
            width="100%"
            height="100%"
            position="relative"
            style={{ touchAction: "none" }}
          >
            <LinearGradient
              id="area-background-gradient"
              from="#3b6978"
              to="#204051"
              key="area-background-gradient"
            />
            {groupNames.map((groupName) => (
              <LinearGradient
                key={groupName}
                id={`timeline-${groupName}`}
                from={color(groupName)}
                to={color(groupName)}
                fromOpacity={0.8}
                toOpacity={0.3}
              />
            ))}
            <rect
              x={0}
              y={0}
              width={width}
              height={height}
              rx={14}
              fill="url(#area-background-gradient)"
              key="bg"
            />
            <foreignObject
              width={width}
              height={height}
              x={10}
              y={10}
              position="absolute"
              key="title"
            >
              <TitleBox
                sx={{ position: "absolute", top: 0, left: 0 }}
                key="titleBox"
              >
                <Typography
                  variant="h6"
                  key="heading"
                  color={theme.palette.text.primary}
                >
                  Timeline
                </Typography>
                <CustomSelect
                  key="group"
                  propName="group"
                  value={statsContext.timelineVisx.group}
                  name="Sport"
                  options={groups}
                  setState={statsContext.setTimelineVisx}
                />
                <CustomSelect
                  key="value"
                  propName="value"
                  value={statsContext.timelineVisx.value}
                  name="Y"
                  options={values}
                  setState={statsContext.setTimelineVisx}
                />
                <CustomSelect
                  key="timePeriod"
                  propName="timePeriod"
                  value={statsContext.timelineVisx.timePeriod}
                  name="X"
                  options={timelineSettingsVisx.timePeriods}
                  setState={statsContext.setTimelineVisx}
                />
                <Box key="windowSize">
                  <Grid container spacing={2} alignItems="center">
                    <Grid item>
                      <FontAwesomeIcon
                        icon="chart-column"
                        color={theme.palette.text.primary}
                      />
                    </Grid>
                    <Grid item width="100px">
                      <Slider
                        {...statsContext.timelineVisx.timePeriod.averaging}
                        //slotProps={{ markLabel: { fontSize: "0.8rem" } }}
                        //sx={{ mb: 1 }}
                        marks={true}
                        size="small"
                        valueLabelDisplay="on"
                        value={window} //{statsContext.timelineVisx.averaging.window}
                        onChange={
                          (e, v) => setWindow(v) //statsContext.setTimelineVisx({averaging: averages.movingAvg(v),})
                        }
                        onChangeCommitted={(e, v) =>
                          statsContext.setTimelineVisx({
                            averaging: averages.movingAvg(v),
                          })
                        }
                      />
                    </Grid>
                    <Grid item>
                      <FontAwesomeIcon
                        icon="chart-area"
                        color={theme.palette.text.primary}
                      />
                    </Grid>
                  </Grid>
                </Box>
                <ButtonGroup size="small" key="zoom">
                  <Button
                    onClick={() => zoomAroundPoint(innerWidth / 2, 0.66)}
                    disabled={transform.scale <= 1}
                  >
                    <ZoomOutIcon />
                  </Button>
                  <Button
                    onClick={() => zoomAroundPoint(innerWidth / 2, 1.5)}
                    disabled={transform.scale >= 50}
                  >
                    <ZoomInIcon />
                  </Button>
                </ButtonGroup>
                <ButtonGroup size="small" key="translate">
                  <Button
                    disabled={transform.x >= 0}
                    onClick={() => setTranslate((x) => x + 50)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    disabled={
                      transform.x <= -innerWidth * (transform.scale - 1)
                    }
                    onClick={() => setTranslate((x) => x - 50)}
                  >
                    <ChevronRight />
                  </Button>
                </ButtonGroup>
              </TitleBox>
            </foreignObject>
            <Group key="lines" left={margin.left} top={margin.top}>
              <Axis
                orientation="top"
                scale={xScale}
                numTicks={5}
                hideAxisLine={true}
                hideTicks={true}
                tickLabelProps={{
                  fill: theme.palette.text.primary,
                  fontSize: 10,
                  textAnchor: "middle",
                }}
              />
              <Axis
                orientation="left"
                scale={yScale}
                top={0}
                numTicks={5}
                tickFormat={statsContext.timelineVisx.value.format}
                hideAxisLine={true}
                hideTicks={true}
                tickLabelProps={{
                  fill: theme.palette.text.primary,
                  fontSize: 10,
                  textAnchor: "end",
                }}
              />
              <GridRows
                scale={yScale}
                width={innerWidth}
                stroke={theme.palette.text.primary}
                strokeOpacity={0.1}
              />
              <GridColumns
                scale={xScale}
                height={topChartHeight}
                stroke={theme.palette.text.primary}
                strokeOpacity={0.1}
              />
              <AreaStack
                data={data.filter(({ date }) => {
                  const [x0, x1] = currentExtent.map((d) => d.getTime());
                  return date.getTime() >= x0 && date.getTime() <= x1;
                })}
                keys={groupNames}
                value={(d, key) => d.movingAvg.get(key)}
                x={(d) => xScale(d.data.date)}
                y0={(d) => yScale(d[0])}
                y1={(d) => yScale(d[1])}
                key="stack"
              >
                {({ stacks, path }) =>
                  stacks.map((stack) => (
                    <path
                      key={`stack-${stack.key}`}
                      d={path(stack) || ""}
                      fill={`url(#timeline-${stack.key})`}
                      stroke={theme.palette.text.primary}
                      strokeWidth={1}
                      strokeOpacity={0.1}
                    />
                  ))
                }
              </AreaStack>
              <rect
                width={innerWidth}
                height={topChartHeight}
                fill="transparent"
                ref={topChartRef}
                style={{
                  touchAction: "none",
                  cursor: isDragging ? "grabbing" : "grab",
                }}
                onDoubleClick={(event) => {
                  zoomAroundPoint(
                    event.clientX -
                      topChartRef.current.getBoundingClientRect().x,
                    1.5
                  );
                }}
              />
              {/*<rect
                      width={innerWidth}
                      height={topChartHeight}
                      rx={14}
                      fill="transparent"
                      style={{
                        cursor: zoom.isDragging ? "grabbing" : "grab",
                        touchAction: "none",
                      }}
                      ref={zoom.containerRef}
                      onTouchStart={zoom.dragStart}
                      onTouchMove={zoom.dragMove}
                      onTouchEnd={zoom.dragEnd}
                      onMouseDown={zoom.dragStart}
                      onMouseMove={zoom.dragMove}
                      onMouseUp={zoom.dragEnd}
                      onMouseLeave={() => {
                        if (zoom.isDragging) zoom.dragEnd();
                      }}
                      onDoubleClick={(event) => {
                        const point = localPoint(event) || { x: 0, y: 0 };
                        zoom.scale({ scaleX: 1.1, scaleY: 1.1, point });
                        console.log(zoom);
                      }}
                      onScroll={(event) => {
                        console.log(event.nativeEvent);
                        if (!event.deltaY) return;
                        var sign;
                        if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
                          sign = Math.sign(event.deltaY);
                        else sign = -Math.sign(event.deltaX);
                        zoom.translate({
                          translateX: sign * 10,
                        });
                      }}
                    />*/}
            </Group>
            <Group
              key="brush"
              top={topChartHeight + margin.top + separatorHeight}
              left={margin.left}
            >
              <Axis
                orientation="bottom"
                scale={brushXScale}
                top={bottomChartHeight}
                hideAxisLine={true}
                hideTicks={true}
                tickLabelProps={{
                  fill: theme.palette.text.primary,
                  fontSize: 10,
                  textAnchor: "middle",
                }}
              />
              {groupNames.map((groupName) => (
                <>
                  <AreaClosed
                    key={groupName}
                    curve={curveMonotoneX}
                    data={data}
                    x={(d) => brushXScale(d.date)}
                    y={(d) => brushYScale(d.movingAvg.get(groupName))}
                    yScale={brushYScale}
                    stroke={theme.palette.text.primary}
                    strokeWidth={1}
                    strokeOpacity={0.1}
                    fill={theme.palette.text.primary}
                    fillOpacity={0.2}
                  />
                  <AreaClosed
                    key={groupName + "-zoomed"}
                    curve={curveMonotoneX}
                    data={data.filter(({ date }) => {
                      const [x0, x1] = currentExtent.map((d) => d.getTime());
                      return date.getTime() >= x0 && date.getTime() <= x1;
                    })}
                    x={(d) => brushXScale(d.date)}
                    y={(d) => brushYScale(d.movingAvg.get(groupName))}
                    yScale={brushYScale}
                    stroke={theme.palette.text.primary}
                    strokeWidth={1}
                    strokeOpacity={0.1}
                    fill={theme.palette.text.primary}
                    fillOpacity={0.5}
                  />
                </>
              ))}
            </Group>
          </svg>
          {tooltipOpen &&
            tooltipData &&
            tooltipLeft != null &&
            tooltipTop != null && (
              <IconTooltip
                left={tooltipLeft}
                top={tooltipTop}
                {...tooltipData}
              />
            )}
        </>
      )
    );
  }
);

export default TimelineVisx;
