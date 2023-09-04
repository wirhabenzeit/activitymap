import React, {
  useContext,
  cloneElement,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { useSpring, animated } from "@react-spring/web";

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
import { Brush } from "@visx/brush";
import { Zoom, applyMatrixToPoint } from "@visx/zoom";

import { useTooltip, TooltipWithBounds, withTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";

import { StatsContext } from "../../contexts/StatsContext";
import { SelectionContext } from "../../contexts/SelectionContext";

import { Typography, Box, Slider } from "@mui/material";
import { useTheme } from "@mui/material/styles";

const initialTransform = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
  skewX: 0,
  skewY: 0,
};

import { timelineSettingsVisx } from "../../settings";

import { TitleBox, CustomSelect, IconTooltip } from "../StatsUtilities.jsx";

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
      y: 0,
      scale: 1,
    });

    useEffect(() => {
      setCurrentExtent(statsContext.extent);
    }, [statsContext.extent]);
    const [isDragging, setIsDragging] = useState(false);

    /*useGesture(
      {
        onDragStart: ({ event }) => {
          if (!(event instanceof KeyboardEvent)) setIsDragging(true);
        },
        onDrag: ({ event, pinching, cancel }) => {
          if (pinching) {
            cancel();
            setIsDragging(false);
          } else if (!(event instanceof KeyboardEvent)) {
            console.log("drag", event);
          }
        },
        onDragEnd: () => setIsDragging(false),
        onPinch: (event) => {
          const zoomFactor = event.movement[0] > 1 ? 1.1 : 0.9;
          setCurrentExtent((extent) => {
            const extentS = extent.map((d) => d.getTime());
            const totalLength = extentS[1] - extentS[0];
            const centerPt =
              extentS[0] +
              (totalLength *
                (event.origin[0] -
                  topChartRef.current.getBoundingClientRect().left)) /
                innerWidth;
            const newExtentS = [
              (extentS[0] - centerPt) / zoomFactor + centerPt,
              (extentS[1] - centerPt) / zoomFactor + centerPt,
            ];
            return newExtentS.map((d) => new Date(d));
          });
        },
        onWheel: ({ event, active, pinching }) => {
          if (
            // Outside of Safari, the wheel event is fired together with the pinch event
            pinching ||
            // currently onWheelEnd emits one final wheel event which causes 2x scale
            // updates for the last tick. ensuring that the gesture is active avoids this
            !active
          ) {
            return;
          }
          event.preventDefault();
          console.log("scroll", event.initial, event.direction);
        },
      },
      {
        target: topChartRef,
        eventOptions: { passive: false },
        drag: { filterTaps: true },
        pinch: { threshold: 0.1 },
      }
    );*/

    useGesture(
      {
        // onHover: ({ active, event }) => console.log('hover', event, active),
        // onMove: ({ event }) => console.log('move', event),
        onDrag: ({ pinching, cancel, offset: [x, y], ...rest }) => {
          if (pinching) return cancel();
          setTransform((transform) => ({ ...transform, x, y }));
        },
        onPinch: ({
          origin: [ox, oy],
          first,
          movement: [ms],
          offset: [s, a],
          memo,
        }) => {
          if (first) {
            const { width, height, x, y } =
              topChartRef.current.getBoundingClientRect();
            const tx = ox - x;
            memo = [transform.x, tx];
            console.log("pinch", memo, ms, s, a);
          }

          const x = memo[0] - (ms - 1) * (memo[1] - memo[0]);
          setTransform((transform) => ({ ...transform, scale: s, x }));
          return memo;
        },
      },
      {
        target: topChartRef,
        drag: { from: () => [transform.x, transform.y] },
        pinch: { scaleBounds: { min: 1, max: 10 }, rubberband: false },
      }
    );

    useEffect(() => {
      console.log(transform);
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

    function constrain(transformMatrix, prevTransformMatrix) {
      const newDomain = getZoomExtent(transformMatrix);
      if (
        newDomain[1] - newDomain[0] >
        statsContext.extent[1] - statsContext.extent[0]
      )
        return prevTransformMatrix;
      if (newDomain[0] < statsContext.extent[0])
        return { ...transformMatrix, translateX: 0 };
      if (newDomain[1] > statsContext.extent[1])
        return {
          ...transformMatrix,
          translateX: innerWidth * (1 - transformMatrix.scaleX),
        };
      return transformMatrix;
    }

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
                <Box width="150px" key="windowSize">
                  <Slider
                    {...statsContext.timelineVisx.timePeriod.averaging}
                    slotProps={{ markLabel: { fontSize: "0.8rem" } }}
                    sx={{ mb: 1 }}
                    size="small"
                    valueLabelDisplay="off"
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
                </Box>
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