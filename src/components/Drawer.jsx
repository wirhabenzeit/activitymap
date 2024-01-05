import { useRef, useState, useEffect, useContext } from "react";

import {
  Box,
  Popover,
  Fade,
  IconButton,
  Slider as MuiSlider,
  TextField,
  InputLabel,
  FormControl,
  MenuItem,
  Select,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import { Cancel, Help, CheckCircle } from "@mui/icons-material";
import { useTheme, styled } from "@mui/material/styles";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

import { FilterContext } from "/src/contexts/FilterContext";

import { filterSettings, categorySettings, binaryFilters } from "../settings";

export function CheckboxFilter({ open, name }) {
  const [openContent, setOpenContent] = useState(false);
  const filterContext = useContext(FilterContext);

  return (
    <SidebarButton
      open={open}
      contentOpen={openContent}
      setContentOpen={setOpenContent}
      button={
        <IconButton
          disabled={filterContext.binary[name] === undefined}
          sx={{
            width: "30px",
            mx: "1px",
          }}
          onClick={() => {
            console.log("setBinary");
            filterContext.setBinary(name, undefined);
          }}
        >
          <FontAwesomeIcon fontSize="small" icon={binaryFilters[name].icon} />
        </IconButton>
      }
    >
      <FormControlLabel
        label={binaryFilters[name].label}
        labelPlacement="start"
        control={
          <Checkbox
            sx={{ mr: 1 }}
            icon={<Cancel />}
            color="default"
            checkedIcon={<CheckCircle />}
            indeterminateIcon={<Help />}
            checked={filterContext.binary[name] === true}
            indeterminate={filterContext.binary[name] === undefined}
            onChange={(event) => {
              if (filterContext.binary[name] === undefined) {
                filterContext.setBinary(name, true);
              } else if (filterContext.binary[name] === true) {
                filterContext.setBinary(name, false);
              } else {
                filterContext.setBinary(name, undefined);
              }
            }}
          />
        }
      />
    </SidebarButton>
  );
}

export function MultiSelect({ open, name }) {
  const context = useContext(FilterContext);

  const selectChange = (event) => {
    const { value } = event.target;
    event.stopPropagation();
    const newFilter = value === "string" ? value.split(",") : value;
    context.updateCategoryFilter(name, newFilter);
  };

  const [contentOpen, setContentOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);

  return (
    <SidebarButton
      open={open}
      contentOpen={contentOpen}
      setContentOpen={setContentOpen}
      onMouseLeave={() => {
        if (!selectOpen) setContentOpen(false);
      }}
      button={
        <IconButton
          onClick={() => context.toggleCategory(name)}
          onDoubleClick={() => context.setOnlyCategory(name)}
          sx={{
            width: "30px",
            color: context.categories[name].active
              ? categorySettings[name].color
              : "text.disabled",
          }}
        >
          <FontAwesomeIcon
            fontSize="medium"
            icon={categorySettings[name].icon}
          />
        </IconButton>
      }
    >
      <FormControl
        sx={{
          mr: 2,
          ml: 0,
          width: "200px",
        }}
        size="small"
        variant="standard"
      >
        <InputLabel id={name + "-label"}>
          {categorySettings[name].name}
        </InputLabel>
        <Select
          //id={name}
          //labelId={name+"-label"}
          multiple
          value={context.categories[name].filter}
          onChange={selectChange}
          renderValue={(selected) => selected.join(", ")}
          open={selectOpen}
          onOpen={(event) => setSelectOpen(true)}
          onClose={(event) => {
            setContentOpen(false);
            setSelectOpen(false);
          }}
          MenuProps={{
            sx: {
              "&& .Mui-selected": {
                backgroundColor: categorySettings[name].color + "20",
              },
              "&& .MuiList-root": { padding: 0 },
            },
          }}
          style={{ fontSize: "0.8rem" }}
        >
          {categorySettings[name].alias.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </SidebarButton>
  );
}

export function SearchBox({ open }) {
  const [openSearch, setOpenSearch] = useState(false);
  const filterContext = useContext(FilterContext);

  return (
    <SidebarButton
      open={open}
      contentOpen={openSearch}
      setContentOpen={setOpenSearch}
      button={
        <IconButton
          disabled={filterContext.search === ""}
          sx={{
            width: "30px",
            mx: "1px",
          }}
          onClick={() => {
            filterContext.setSearch("");
          }}
        >
          <FontAwesomeIcon fontSize="medium" icon="magnifying-glass" />
        </IconButton>
      }
    >
      <TextField
        sx={{ width: "200px", mr: 1, mt: 0.5 }}
        margin="none"
        size="small"
        label="Activity Title"
        value={filterContext.search}
        onChange={(event) => {
          filterContext.setSearch(event.target.value);
        }}
      />
    </SidebarButton>
  );
}

const Slider = styled(MuiSlider)(({ theme }) => ({
  '& .MuiSlider-markLabel[data-index="0"]': {
    //transform: "translateX(0%)",
  },
  '& .MuiSlider-markLabel[data-index="1"]': {
    //transform: "translateX(-100%)",
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
  '& .MuiSlider-thumb[data-index="0"] > span': {
    transform: "translateX(0%)",
    top: 10,
  },
  '& .MuiSlider-thumb[data-index="1"] > span': {
    transform: "translateX(0%)",
    top: -20,
  },
}));

export function ValueSlider({ open, name }) {
  const [openSlider, setOpenSlider] = useState(false);
  const filterContext = useContext(FilterContext);
  const [value, setValue] = useState(filterContext.values[name]);

  const minmax = filterContext.filterRanges[name];
  const min = minmax[0];
  const max = minmax[1];
  const scale = !("scale" in filterSettings[name])
    ? (x) => x
    : (x) =>
        min + (max - min) * filterSettings[name].scale((x - min) / (max - min));

  useEffect(() => {
    if (value[0] === undefined) setValue(filterContext.filterRanges[name]);
  }, [filterContext.filterRanges[name]]);

  return (
    <SidebarButton
      open={open}
      contentOpen={openSlider}
      setContentOpen={setOpenSlider}
      button={
        <IconButton
          disabled={minmax.every((v, i) => v === value[i])}
          sx={{
            width: "30px",
            mx: "1px",
          }}
          onClick={() => {
            setValue(minmax);
            filterContext.updateValueFilter(name, minmax.map(scale));
          }}
        >
          <FontAwesomeIcon fontSize="medium" icon={filterSettings[name].icon} />
        </IconButton>
      }
    >
      <Slider
        getAriaLabel={() => name}
        sx={{ width: "160px", mx: 3, mt: 1 }}
        min={min}
        max={max}
        scale={scale}
        valueLabelFormat={(value) => filterSettings[name].tooltip(value)}
        value={value}
        onChange={(event, newValue) => {
          setValue(newValue);
        }}
        onChangeCommitted={(event, newValue) => {
          filterContext.updateValueFilter(name, newValue.map(scale));
        }}
        size="small"
        valueLabelDisplay="on"
      />
    </SidebarButton>
  );
}

function SidebarButton({ inlineProps = {}, popoverProps = {}, ...props }) {
  const buttonRef = useRef(null);
  const theme = useTheme();
  const [delayOpen, setDelayOpen] = useState(props.open);

  useEffect(() => {
    if (props.open) {
      setDelayOpen(true);
    } else {
      setTimeout(() => {
        setDelayOpen(false);
      }, theme.transitions.duration.leavingScreen);
    }
  }, [props.open]);

  return (
    <Box
      ref={buttonRef}
      sx={{ width: 1, display: "flex" }}
      onMouseEnter={() => {
        props.setContentOpen(true);
      }}
      onMouseLeave={
        "onMouseLeave" in props
          ? props.onMouseLeave
          : () => {
              props.setContentOpen(false);
            }
      }
    >
      <Box
        sx={{
          height: "50px",
          display: "flex",
          alignItems: "center",
        }}
      >
        {props.button}
      </Box>
      {delayOpen && (
        <Fade
          in={props.open}
          timeout={theme.transitions.duration.enteringScreen}
        >
          <Box
            sx={{
              alignItems: "center",
              width: "210px",
              height: "50px",
              p: 0,
            }}
          >
            {props.children}
          </Box>
        </Fade>
      )}
      {!props.open && (
        <Popover
          sx={{ pointerEvents: "none" }}
          id="settingPopover"
          open={!props.open && props.contentOpen}
          onClose={() => props.setContentOpen(false)}
          anchorEl={buttonRef.current}
          anchorOrigin={{
            vertical: "center",
            horizontal: "right",
          }}
          transformOrigin={{
            vertical: "center",
            horizontal: "left",
          }}
          slotProps={{
            paper: {
              sx: {
                pointerEvents: "auto",
                justifyContent: "center",
                alignItems: "center",
                maxWidth: "220px",
                p: 1,
              },
            },
          }}
        >
          {props.children}
        </Popover>
      )}
    </Box>
  );
}
