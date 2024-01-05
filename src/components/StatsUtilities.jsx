import React, { cloneElement, useMemo, useSyncExternalStore } from "react";

import { Divider } from "@mui/material";

import { Tooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { ParentSize } from "@visx/responsive";

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
  Slider,
  Table,
  TableCell,
  TableBody,
  TableRow,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

export function addAlpha(color, opacity) {
  const _opacity = Math.round(Math.min(Math.max(opacity || 1, 0), 1) * 255);
  return color + _opacity.toString(16).toUpperCase();
}

export function TitleBox({ children, sx }) {
  return (
    <Box
      sx={{
        height: "64px",
        width: "100%",
        overflowX: "scroll",
        overflowY: "hidden",
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-around",
        gap: 1,
        //whiteSpace: "noWrap",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function LegendPlot({ plot, settings, legendRef, settingsOpen }) {
  return (
    <Box
      sx={{
        p: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <ParentSize>
        {({ width, height }) => (
          <>
            {cloneElement(plot, {
              width,
              height: settingsOpen ? height - 60 : height,
            })}
            <Box
              sx={{
                width: "100%",
                height: "60px",
                display: settingsOpen ? "flex" : "none",
                borderTop: 1,
                borderColor: "divider",
                flexShrink: 0,
              }}
            >
              <div
                ref={legendRef}
                key="legend"
                style={{
                  display: "inline-flex",
                  verticalAlign: "top",
                  height: "40px",
                  margin: "10px",
                }}
              />
              <Divider
                orientation="vertical"
                sx={{
                  display: "inline-flex",
                  verticalAlign: "top",
                  mx: "10px",
                }}
              />
              <Box
                sx={{
                  verticalAlign: "top",
                  flexGrow: 1,
                  flexDirection: "row-reverse",
                  display: "flex",
                  gap: "10px",
                  py: "10px",
                  pr: "10px",
                }}
              >
                {settings}
              </Box>
            </Box>
          </>
        )}
      </ParentSize>
    </Box>
  );
}

export const symmetricDifference = (arrayA, arrayB) => {
  const setA = new Set(arrayA);
  const setB = new Set(arrayB);

  const diffA = Array.from(setA).filter((x) => !setB.has(x));
  const diffB = Array.from(setB).filter((x) => !setA.has(x));

  return [...diffA, ...diffB];
};

export function CustomSelect({
  propName,
  name,
  value,
  options,
  setState,
  headers,
  sx,
  disabled,
}) {
  return (
    <FormControl key={propName} sx={sx} disabled={disabled}>
      <InputLabel>{name}</InputLabel>
      <Select
        size="small"
        autoWidth
        value={value.id}
        label={name}
        sx={{ minWidth: "100px" }}
        onChange={(event) =>
          setState({
            [propName]: options[event.target.value],
          })
        }
      >
        {!headers &&
          Object.entries(options).map(([key, aggregator]) => (
            <MenuItem value={key} key={key}>
              {aggregator.label}
            </MenuItem>
          ))}
        {headers &&
          headers.reduce(
            (prev, header) => [
              ...prev,
              <ListSubheader key={header.title}>{header.title}</ListSubheader>,
              ...Object.entries(options)
                .filter(([key, agg]) => header.filter(agg))
                .map(([key, aggregator]) => (
                  <MenuItem value={key} key={key}>
                    {aggregator.label}
                  </MenuItem>
                )),
            ],
            []
          )}
      </Select>
    </FormControl>
  );
}

export function CustomPicker({
  propName,
  options,
  value,
  range,
  disabled,
  setState,
  sx,
}) {
  return (
    <ButtonGroup variant="outlined" key={propName} sx={sx}>
      <Button
        disabled={disabled || !value.highlight || value.selected == range[0]}
        onClick={(e) => {
          setState({
            [propName]: options.byYear(value.selected - 1),
          });
        }}
      >
        -
      </Button>
      <Button
        disabled={disabled}
        onClick={(e) => {
          if (value.highlight)
            setState({
              [propName]: options.all(value.selected),
            });
          else
            setState({
              [propName]: options.byYear(value.selected),
            });
        }}
      >
        {value.label}
      </Button>
      <Button
        disabled={disabled || !value.highlight || value.selected == range[1]}
        onClick={(e) => {
          setState({
            [propName]: options.byYear(value.selected + 1),
          });
        }}
      >
        +
      </Button>
    </ButtonGroup>
  );
}

export const IconTooltip = ({
  icon = "child-reaching",
  textLeft,
  textRight,
  color = "#eeeeee",
  left,
  top,
  style,
}) => {
  return (
    <TooltipWithBounds
      left={left}
      top={top}
      style={{ ...defaultStyles, ...style }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
        }}
      >
        {textLeft && (
          <Typography
            sx={{
              mr: 1,
              fontSize: "small",
            }}
          >
            {textLeft}
          </Typography>
        )}
        {icon && <FontAwesomeIcon fontSize="small" icon={icon} color={color} />}
        {textRight && (
          <Typography
            sx={{
              ml: 1,
              fontSize: "small",
            }}
          >
            {textRight}
          </Typography>
        )}
      </Box>
    </TooltipWithBounds>
  );
};

export const MultiIconTooltip = ({
  rows,
  left,
  top,
  style,
  withBounds = true,
}) => {
  const table = (
    <Table size="small">
      <TableBody>
        {rows.map(({ textLeft, textRight, icon, color, key }) => (
          <TableRow
            key={key}
            sx={{ "td, th": { border: 0, px: "2px", py: 0 } }}
          >
            <TableCell align="right">
              {textLeft && (
                <Typography sx={{ fontSize: "small", color: "#666" }}>
                  {textLeft}
                </Typography>
              )}
            </TableCell>
            <TableCell align="center">
              {icon && (
                <FontAwesomeIcon fontSize="small" icon={icon} color={color} />
              )}
            </TableCell>
            <TableCell align="left" sx={{ whiteSpace: "nowrap" }}>
              {textRight && (
                <Typography sx={{ fontSize: "small", color: "#666" }}>
                  {textRight}
                </Typography>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  if (withBounds)
    return (
      <TooltipWithBounds
        left={left}
        top={top}
        style={{
          ...defaultStyles,
          ...style,
        }}
      >
        {table}
      </TooltipWithBounds>
    );
  else
    return (
      <Tooltip
        left={left}
        top={top}
        style={{
          ...defaultStyles,
          ...style,
        }}
      >
        {table}
      </Tooltip>
    );
};

export const ChipTooltip = ({
  color = "#eeeeee",
  icon,
  textLeft,
  textRight,
  sx,
}) => {
  const theme = useTheme();
  return (
    <Chip
      sx={{
        backgroundColor: theme.palette.background.paper,
        border: 1,
        borderColor: color,
        ...sx,
      }}
      size="small"
      label={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
          }}
        >
          {textLeft && (
            <Typography
              sx={{
                mr: 1,
                fontSize: "small",
              }}
            >
              {textLeft}
            </Typography>
          )}
          {icon && (
            <FontAwesomeIcon fontSize="small" icon={icon} color={color} />
          )}
          {textRight && (
            <Typography
              sx={{
                ml: 1,
                fontSize: "small",
              }}
            >
              {textRight}
            </Typography>
          )}
        </Box>
      }
      variant="filled"
    />
  );
};

function subscribe(callback) {
  window.addEventListener("resize", callback);
  return () => {
    window.removeEventListener("resize", callback);
  };
}

export function useDimensions(ref) {
  const dimensions = useSyncExternalStore(subscribe, () =>
    JSON.stringify({
      width: ref.current?.offsetWidth ?? 0, // 0 is default width
      height: ref.current?.offsetHeight ?? 0, // 0 is default height
    })
  );
  return useMemo(() => JSON.parse(dimensions), [dimensions]);
}

export function movingWindow(N) {
  return (values) => {
    if (!values || values.length < N) {
      return values;
    }
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - N);
      const end = Math.min(values.length, i + N + 1);
      const subArray = values.slice(start, end);
      const sum = subArray.reduce((a, b) => a + b);
      const average = sum / subArray.length;
      result.push(average);
    }
    return result;
  };
}

export function gaussianAvg(N) {
  return (values) => {
    if (!values || values.length < N) {
      return values;
    }
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - N);
      const end = Math.min(values.length, i + N + 1);
      //const subArray = values.slice(start, end);
      var newResult = 0;
      var normalizer = 0;
      for (let j = start; j < end; j++) {
        const weight = Math.exp(-Math.pow(2 * (i - j), 2) / (1 + N * N));
        newResult += values[j] * weight;
        normalizer += weight;
      }
      result.push(newResult / normalizer);
    }
    return result;
  };
}
