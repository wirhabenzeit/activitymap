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

import { scaleTime, scaleLinear, scaleSqrt } from "@visx/scale";

import { LinearGradient } from "@visx/gradient";
import { AreaStack, AreaClosed, Line } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { Group } from "@visx/group";
import { Axis } from "@visx/axis";
import { GridColumns, GridRows } from "@visx/grid";

import { withTooltip } from "@visx/tooltip";

import { StatsContext } from "../../contexts/StatsContext";
import { SelectionContext } from "../../contexts/SelectionContext";

import {
  Typography,
  Box,
  Slider as MuiSlider,
  ButtonGroup,
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

import {
  TitleBox,
  CustomSelect,
  IconTooltip,
  MultiIconTooltip,
  symmetricDifference,
} from "../StatsUtilities.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

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
    const selectionContext = useContext(SelectionContext);
    const theme = useTheme();

    const groups = timelineSettingsVisx.groups;
    const values = timelineSettingsVisx.values;
    const averages = timelineSettingsVisx.averages;

    const groupNames = statsContext.timelineVisx.groups;
    const data = statsContext.timelineVisx.data;
    const color = statsContext.timelineVisx.group.color;

    const topChartRef = useRef(null);
    const bottomChartRef = useRef(null);
    const [currentExtent, setCurrentExtent] = useState(statsContext.extent);
    const [transform, setTransform] = useState({
      x: 0,
      scale: 1,
    });
    const [animatedPoints, setAnimatedPoints] = useState([]);
    const [hoverId, setHoverId] = useState(null);

    useEffect(() => {
      if (statsContext.extent[0] === undefined) return;
      setCurrentExtent((currentExtent) =>
        currentExtent[0] === undefined ? statsContext.extent : currentExtent
      );
    }, [statsContext.extent]);
    const [isDragging, setIsDragging] = useState(false);
    const [brushOver, setBrushOver] = useState(false);

    const handleSelection = useCallback(
      (event) => {
        if (hoverId !== null) {
          if (event.metaKey)
            selectionContext.setSelected((selected) => {
              return symmetricDifference(selected, [hoverId]);
            });
          else selectionContext.setSelected([hoverId]);
        }
      },
      [tooltipData]
    );

    const zoomAroundPoint = (point, zoom, transform0 = undefined) => {
      if (transform0 === undefined) transform0 = transform;
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

    const areaTooltip = ({ event }) => {
      var { x, y } = localPoint(event);
      const datum = data.filter(
        ({ date }) =>
          date.getTime() ===
          statsContext.timelineVisx.timePeriod
            .tick(xScale.invert(x - margin.left))
            .getTime()
      );
      const tooltipData = datum.length > 0 ? datum[0] : undefined;
      if (tooltipData) {
        const cumSum = d3.cumsum(tooltipData.movingAvg.values());
        tooltipData.cumMovingAvg = new d3.InternMap(
          d3.zip([...tooltipData.movingAvg.keys()], cumSum)
        );
        if (yScale(cumSum[cumSum.length - 1]) + margin.top <= y)
          showTooltip({
            tooltipData,
            tooltipLeft: x,
            tooltipTop: 0,
          });
        else hideTooltip();
      }
    };

    const rScale = useMemo(
      () =>
        scaleSqrt()
          .domain([0, statsContext.timelineVisx.valueExtent[1]])
          .range([1, 6]),
      [statsContext.timelineVisx.valueExtent]
    );

    useGesture(
      {
        onMove: areaTooltip,
        onDrag: ({ pinching, cancel, offset: [x, y], ...rest }) => {
          if (pinching) return cancel();
          setTranslate(() => x);
        },
        onDragStart: ({ event }) => setIsDragging(true),
        onDragEnd: ({ event }) => setIsDragging(false),
        onPinch: ({ origin: [ox, oy], first, movement: [ms], memo, event }) => {
          if (first) {
            memo = [
              transform.x,
              ox - topChartRef.current.getBoundingClientRect().x,
              transform.scale,
            ];
          }
          zoomAroundPoint(memo[1], ms, { scale: memo[2], x: memo[0] });
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
          areaTooltip({ event });
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
      console.log(brushOver);
    }, [brushOver]);
    useGesture(
      {
        onMove: ({ active, xy }) => {
          const pos = xy[0] - bottomChartRef.current.getBoundingClientRect().x;
          const brush = currentExtent.map((d) => brushXScale(d));
          if (Math.abs(pos - brush[0]) < 3) setBrushOver("left");
          else if (Math.abs(pos - brush[1]) < 3) setBrushOver("right");
          else if (pos > brush[0] && pos < brush[1]) setBrushOver("middle");
          else setBrushOver(false);
        },
        onDrag: ({
          offset: [x, y],
          initial: [x0, y0],
          xy: [x1, y1],
          first,
          memo,
        }) => {
          if (first) {
            const pos = x0 - bottomChartRef.current.getBoundingClientRect().x;
            const brush = currentExtent.map((d) => brushXScale(d));
            console.log("first", pos, brush);
            if (Math.abs(pos - brush[0]) < 3)
              memo = { mode: "left", transform: { ...transform } };
            else if (Math.abs(pos - brush[1]) < 3)
              memo = { mode: "right", transform: { ...transform } };
            else if (pos > brush[0] && pos < brush[1])
              memo = { mode: "middle", transform: { ...transform } };
            else memo = { mode: undefined, transform: { ...transform } };
          }
          if (memo.mode === "middle") {
            setTranslate(() => -x * transform.scale);
          } else if (memo.mode === "left")
            zoomAroundPoint(
              innerWidth,
              Math.min(
                1 / (1 + (memo.transform.scale * (x0 - x1)) / innerWidth),
                50 / memo.transform.scale
              ),
              memo.transform
            );
          else if (memo.mode === "right")
            zoomAroundPoint(
              0,
              Math.min(
                1 / (1 + (memo.transform.scale * (x1 - x0)) / innerWidth),
                50 / memo.transform.scale
              ),
              memo.transform
            );
          return memo;
        },
      },
      {
        target: bottomChartRef,
        drag: {
          filterTaps: true,
          from: () => [-transform.x / transform.scale, 0],
        },
        eventOptions: { passive: false },
        pinch: { rubberband: false },
      }
    );

    useEffect(() => {
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

    useEffect(() => {
      setWindow(statsContext.timelineVisx.averaging.window);
    }, [statsContext.timelineVisx.averaging.window]);

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
            .gaussianAvg(window)
            .fun(data.map((d) => d.values.get(g))),
        ])
      );
      data.forEach((d, i) => {
        const iMovingAvg = new d3.InternMap(
          d3.map(movingAvg, ([k, g]) => [k, g[i]])
        );
        d.movingAvg = iMovingAvg;
      });
    }, [window]);

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

    const pointData = useMemo(() => {
      const filteredData = statsContext.data.filter(
        (d) =>
          d.date.getTime() >= currentExtent[0].getTime() &&
          d.date.getTime() <= currentExtent[1].getTime()
      );
      if (statsContext.timelineVisx.value.sortable)
        filteredData.sort(
          (a, b) =>
            statsContext.timelineVisx.value.fun(b) -
            statsContext.timelineVisx.value.fun(a)
        );
      else d3.shuffle(filteredData);
      const topData = filteredData.slice(0, 100);
      return topData.map((d) => {
        const prevPoint = animatedPoints.filter((p) => p.data.id === d.id);
        return {
          x: xScale(d.date),
          x0: xScale(d.date),
          y: prevPoint.length > 0 ? prevPoint[0].y : 0,
          y0: 0,
          data: d,
        };
      });
    }, [statsContext.data, currentExtent, yScale]);

    useEffect(() => {
      const simulation = d3f
        .forceSimulation()
        .force(
          "x",
          d3f.forceX((d) => d.x0)
        )
        .force(
          "y",
          d3f.forceY((d) => 0)
        )
        .force(
          "collide",
          d3f.forceCollide(
            (d) =>
              rScale(statsContext.timelineVisx.value.fun(d.data)) +
              (d.data.id == hoverId ? 4 : 1)
          )
        );
      simulation.on("tick", () => {
        setAnimatedPoints([...simulation.nodes()]);
      });

      simulation.nodes([...pointData]);
      simulation.restart();
      return () => simulation.stop();
    }, [pointData, xScale, yScale, hoverId]);

    return (
      data.length > 0 && (
        <>
          <svg width="100%" height="100%" position="relative">
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
                  name="Group"
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
                <Box key="avg">
                  {!statsContext.timelineVisx.timePeriod.averaging.disabled && (
                    <Grid container spacing={2} alignItems="center" key="avg">
                      <Grid item>
                        <FontAwesomeIcon
                          icon="chart-column"
                          color={theme.palette.text.primary}
                        />
                      </Grid>
                      <Grid item width="100px">
                        <Slider
                          {...statsContext.timelineVisx.timePeriod.averaging}
                          marks={true}
                          size="small"
                          valueLabelDisplay="on"
                          value={window}
                          onChange={(e, v) => setWindow(v)}
                          onChangeCommitted={(e, v) =>
                            statsContext.setTimelineVisx({
                              averaging: averages.gaussianAvg(v),
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
                  )}
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
                  dy: "-0.25rem",
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
                curve={curveMonotoneX}
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
              {tooltipOpen && tooltipData && "cumMovingAvg" in tooltipData && (
                <Group>
                  <Line
                    from={{ x: tooltipLeft - margin.left, y: 0 }}
                    to={{ x: tooltipLeft - margin.left, y: topChartHeight }}
                    stroke={theme.palette.text.primary}
                    strokeWidth={2}
                    pointerEvents="none"
                    strokeDasharray="5,2"
                  />
                  {d3.map(tooltipData.cumMovingAvg, ([key, value]) => (
                    <circle
                      key={key}
                      cx={tooltipLeft - margin.left}
                      cy={yScale(value)}
                      r={4}
                      fill={color(key)}
                      fillOpacity={0.5}
                      stroke="#fff"
                      strokeOpacity={1}
                      strokeWidth={1}
                      pointerEvents="none"
                    />
                  ))}
                </Group>
              )}
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
                onMouseLeave={() => hideTooltip()}
              />
              {animatedPoints.map((d) => (
                <circle
                  key={d.data.id}
                  cx={d.x}
                  cy={d.y}
                  r={
                    rScale(statsContext.timelineVisx.value.fun(d.data)) +
                    (d.data.id == hoverId ? 3 : 0)
                  }
                  fill={statsContext.timelineVisx.group.color(
                    statsContext.timelineVisx.group.fun(d.data)
                  )}
                  fillOpacity={0.5}
                  stroke={
                    selectionContext.selected.includes(d.data.id)
                      ? "#000"
                      : "#fff"
                  }
                  strokeOpacity={1}
                  strokeWidth={2}
                  onMouseOver={(event) => {
                    setHoverId(d.data.id);
                    showTooltip({
                      tooltipData: { activity: d.data },
                      tooltipLeft: d.x + margin.left,
                      tooltipTop: d.y + margin.top,
                    });
                  }}
                  onMouseOut={() => {
                    setHoverId(null);
                    hideTooltip();
                  }}
                  onClick={handleSelection}
                />
              ))}
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
                key="brushAxis"
              />
              {groupNames.map((groupName) => (
                <React.Fragment key={groupName}>
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
                </React.Fragment>
              ))}
              <rect
                x={brushXScale(currentExtent[0])}
                y={0}
                width={
                  brushXScale(currentExtent[1]) - brushXScale(currentExtent[0])
                }
                height={bottomChartHeight}
                fill={theme.palette.text.primary}
                fillOpacity={0.1}
                stroke="transparent"
              />
              {[0, 1].map((i) => (
                <line
                  key={"brush" + i}
                  x1={brushXScale(currentExtent[i])}
                  x2={brushXScale(currentExtent[i])}
                  y1={0}
                  y2={bottomChartHeight}
                  stroke={theme.palette.text.primary}
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
              ))}
              <rect
                width={innerWidth}
                height={bottomChartHeight}
                fill="transparent"
                ref={bottomChartRef}
                style={{
                  touchAction: "none",
                  cursor:
                    brushOver == "middle"
                      ? "grab"
                      : brushOver == false
                      ? "default"
                      : "ew-resize",
                }}
              />
            </Group>
          </svg>
          {tooltipOpen && tooltipData && "activity" in tooltipData && (
            <div>
              <IconTooltip
                left={tooltipLeft}
                top={tooltipTop}
                withBounds={true}
                icon={statsContext.timelineVisx.group.icon(
                  statsContext.timelineVisx.group.fun(tooltipData.activity)
                )}
                textRight={tooltipData.activity.name}
                color={color(
                  statsContext.timelineVisx.group.fun(tooltipData.activity)
                )}
              />
            </div>
          )}
          {tooltipOpen &&
            tooltipData &&
            tooltipLeft != null &&
            tooltipTop != null &&
            "movingAvg" in tooltipData && (
              <div>
                <MultiIconTooltip
                  left={tooltipLeft}
                  top={tooltipTop + margin.top}
                  withBounds={true}
                  rows={d3.map(tooltipData.movingAvg, ([key, value]) => ({
                    icon: statsContext.timelineVisx.group.icon(key),
                    textLeft:
                      statsContext.timelineVisx.value.format(value) +
                      statsContext.timelineVisx.value.unit,
                    color: color(key),
                    key: key,
                  }))}
                />
                <MultiIconTooltip
                  left={tooltipLeft - 10}
                  top={margin.top + topChartHeight - 10}
                  style={{
                    transform: "translate(-50%,-50%)",
                    minWidth: "7rem",
                  }}
                  withBounds={false}
                  rows={[
                    {
                      icon: "calendar",
                      textRight: statsContext.timelineVisx.timePeriod.format(
                        tooltipData.date
                      ),
                      color: "#666",
                      key: "date",
                    },
                  ]}
                />
              </div>
            )}
        </>
      )
    );
  }
);

export default TimelineVisx;
