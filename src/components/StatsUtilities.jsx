import React, { cloneElement } from "react";

import { TooltipWithBounds } from "@visx/tooltip";

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

export function TitleBox({ children }) {
  return (
    <Box
      sx={{
        height: "60px",
        width: 1,
        mt: 1,
        overflowX: "auto",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "noWrap",
      }}
    >
      {children.map((child) =>
        cloneElement(child, {
          sx: {
            ...child.sx,
            m: 1,
            display: "inline-flex",
            verticalAlign: "middle",
          },
        })
      )}
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
        value={value.id}
        label="Sport"
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
}) => (
  <TooltipWithBounds left={left} top={top}>
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
