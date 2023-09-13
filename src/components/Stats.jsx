import React, {
  useContext,
  cloneElement,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import {
  scaleLinear,
  scaleLog,
  scaleSqrt,
  scaleOrdinal,
  scaleBand,
  scaleTime,
} from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
import { PatternLines } from "@visx/pattern";
import {
  LinearGradient,
  GradientTealBlue,
  GradientOrangeRed,
} from "@visx/gradient";
import { Circle, LinePath, AreaClosed, AreaStack } from "@visx/shape";
import { Group } from "@visx/group";
import { Axis, AxisLeft } from "@visx/axis";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { GridColumns, GridRows } from "@visx/grid";
import { GlyphStar } from "@visx/glyph";
import {
  AnimatedAxis,
  AnimatedGridRows,
  AnimatedGridColumns,
} from "@visx/react-spring";
import {
  Annotation,
  HtmlLabel,
  Label,
  Connector,
  CircleSubject,
  LineSubject,
} from "@visx/annotation";
import { useTooltip, TooltipWithBounds, withTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { voronoi } from "@visx/voronoi";
import { Brush } from "@visx/brush";
import BaseBrush, {
  BaseBrushState,
  UpdateBrush,
} from "@visx/brush/lib/BaseBrush";

import { StatsContext } from "../contexts/StatsContext";
import { ActivityContext } from "../contexts/ActivityContext";
import { SelectionContext } from "../contexts/SelectionContext";

function addAlpha(color, opacity) {
  const _opacity = Math.round(Math.min(Math.max(opacity || 1, 0), 1) * 255);
  return color + _opacity.toString(16).toUpperCase();
}
import {
  ListSubheader,
  Paper,
  ButtonGroup,
  Button,
  Skeleton,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Box,
  Unstable_Grid2 as Grid,
  Chip,
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
} from "../settings";

import {
  TitleBox,
  CustomSelect,
  CustomPicker,
  symmetricDifference,
  ChipTooltip,
  IconTooltip,
} from "./StatsUtilities.jsx";

import ViolinPlot from "./Charts/ViolinPlot.jsx";
import TimelinePlot from "./Charts/TimelinePlot.jsx";
import ScatterPlot from "./Charts/ScatterPlot.jsx";
import CalendarPlot from "./Charts/CalendarPlot.jsx";

import * as d3 from "d3-array";
import * as d3t from "d3-time";
import * as d3tf from "d3-time-format";
import * as d3sc from "d3-scale-chromatic";
import * as d3s from "d3-scale";
import { ThemeContext } from "@emotion/react";

export default function StatsView() {
  return (
    <Grid container>
      {/*<Grid xs={12} lg={8}>
        <Paper sx={{ height: 400 }}>
          <YearlySummary />
        </Paper>
      </Grid>
      <Grid xs={12} lg={4}>
        <Paper sx={{ height: 400 }}>
          <TypePie />
        </Paper>
      </Grid>*/}
      <Grid xs={12}>
        <CalendarPlot />
      </Grid>
      <Grid xs={12}>
        <TimelinePlot />
      </Grid>
      {/*<Grid xs={12}>
        <Paper sx={{ height: 200 }}>
          <ActivityCalendar />
        </Paper>
            </Grid>*/}
      <Grid xs={12}>
        <ScatterPlot />
      </Grid>
      <Grid xs={12}>
        <Box
          sx={{
            height: "400px",
            width: "100%",
            position: "relative",
          }}
        >
          <ParentSize>
            {({ width, height }) => (
              <ViolinPlot width={width} height={height} />
            )}
          </ParentSize>
        </Box>
      </Grid>
    </Grid>
  );
}
