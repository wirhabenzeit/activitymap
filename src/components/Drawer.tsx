"use client";
import {
  useRef,
  useState,
  useEffect,
  type ReactElement,
} from "react";

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
  type SelectChangeEvent,
} from "@mui/material";
import {
  Cancel,
  Help,
  CheckCircle,
} from "@mui/icons-material";
import {useTheme, styled} from "@mui/material/styles";

import {FaMagnifyingGlass} from "react-icons/fa6";

import {
  filterSettings,
  binaryFilters,
} from "~/settings/filter";
import {categorySettings} from "~/settings/category";
import {useStore} from "~/contexts/Zustand";
import {useShallow} from "zustand/shallow";

export function CheckboxFilter({
  name,
}: {
  name: keyof typeof binaryFilters;
}) {
  const [openContent, setOpenContent] = useState(false);
  const {binary, setBinary} = useStore(
    useShallow((state) => ({
      binary: state.binary,
      setBinary: state.setBinary,
    }))
  );

  const onClick = () => {
    if (binary[name] === undefined) {
      setBinary(name, true);
    } else if (binary[name] === true) {
      setBinary(name, false);
    } else {
      setBinary(name, undefined);
    }
  };

  return (
    <SidebarButton
      contentOpen={openContent}
      setContentOpen={setOpenContent}
      button={
        <IconButton
          size="small"
          color={
            binary[name] === undefined
              ? "default"
              : binary[name]
                ? "info"
                : "error"
          }
          onClick={onClick}
          sx={{
            width: "30px",
            mx: "1px",
          }}
        >
          {binaryFilters[name].icon}
        </IconButton>
      }
    >
      <FormControlLabel
        label={binaryFilters[name].label}
        labelPlacement="start"
        control={
          <Checkbox
            sx={{mr: 1}}
            icon={<Cancel />}
            color="default"
            checkedIcon={<CheckCircle />}
            indeterminateIcon={<Help />}
            checked={binary[name] === true}
            indeterminate={binary[name] === undefined}
            onChange={onClick}
          />
        }
      />
    </SidebarButton>
  );
}

export function MultiSelect({
  name,
}: {
  name: keyof typeof categorySettings;
}) {
  const {updateCategory, toggleCategory, categories} =
    useStore(
      useShallow((state) => ({
        updateCategory: state.updateCategory,
        toggleCategory: state.toggleCategory,
        categories: state.categories,
      }))
    );

  const selectChange = (
    event: SelectChangeEvent<string[]>
  ) => {
    const {value} = event.target;
    event.stopPropagation();
    console.log(value);
    const newFilter =
      typeof value === "string" ? value.split(",") : value;
    updateCategory(name, newFilter);
  };

  const [contentOpen, setContentOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);

  return (
    <SidebarButton
      contentOpen={contentOpen}
      setContentOpen={setContentOpen}
      onMouseLeave={() => {
        if (!selectOpen) setContentOpen(false);
      }}
      button={
        <IconButton
          onClick={() => toggleCategory(name)}
          sx={{
            width: "30px",
            color: categories[name].active
              ? categorySettings[name].color
              : "text.disabled",
          }}
          size="small"
        >
          {categorySettings[name].icon}
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
          multiple
          value={categories[name].filter}
          onChange={(event: SelectChangeEvent<string[]>) =>
            selectChange(event)
          }
          renderValue={(selected: string[]) =>
            selected.join(", ")
          }
          open={selectOpen}
          onOpen={() => setSelectOpen(true)}
          onClose={() => {
            setContentOpen(false);
            setSelectOpen(false);
          }}
          MenuProps={{
            sx: {
              "&& .Mui-selected": {
                backgroundColor:
                  categorySettings[name].color + "20",
              },
              "&& .MuiList-root": {padding: 0},
            },
          }}
          style={{fontSize: "0.8rem"}}
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

const useDebounce = (value: string, delay = 500) => {
  const [debouncedValue, setDebouncedValue] = useState("");
  const timerRef = useRef<NodeJS.Timeout | null>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(
      () => setDebouncedValue(value),
      delay
    );

    return () => {
      if (timerRef.current !== null)
        clearTimeout(timerRef.current);
    };
  }, [value, delay]);

  return debouncedValue;
};

export function SearchBox() {
  const [openSearch, setOpenSearch] = useState(false);
  const {search, setSearch} = useStore(
    useShallow((state) => ({
      search: state.search,
      setSearch: state.setSearch,
    }))
  );

  const [text, setText] = useState(search);
  const debouncedSearch = useDebounce(text, 300);

  useEffect(() => {
    setSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  return (
    <SidebarButton
      contentOpen={openSearch}
      setContentOpen={setOpenSearch}
      button={
        <IconButton
          color={search === "" ? "default" : "info"}
          sx={{
            width: "30px",
            mx: "1px",
          }}
          size="small"
          onClick={() => {
            setSearch("");
          }}
        >
          <FaMagnifyingGlass />
        </IconButton>
      }
    >
      <TextField
        sx={{width: "200px", mr: 1, mt: 0.5}}
        margin="none"
        size="small"
        label="Title/Description"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
    </SidebarButton>
  );
}

const Slider = styled(MuiSlider)(({theme}) => ({
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
      color:
        theme.palette.mode === "dark" ? "#fff" : "#000",
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

export function ValueSlider({
  name,
}: {
  name: keyof typeof filterSettings;
}) {
  const [openSlider, setOpenSlider] = useState(false);
  const {values, setValueFilter, filterRanges} = useStore(
    useShallow((state) => ({
      values: state.values,
      setValueFilter: state.setValueFilter,
      filterRanges: state.filterRanges,
    }))
  );
  const [value, setValue] = useState(values[name]);

  const verifyValue = (
    value: number[] | number | undefined,
    scale?: (x: number) => number
  ): [number, number] | undefined => {
    if (
      value === undefined ||
      typeof value === "number" ||
      value.length != 2 ||
      value[0] === undefined ||
      value[1] === undefined
    )
      return undefined;
    if (scale) return [scale(value[0]), scale(value[1])];
    return [value[0], value[1]];
  };

  const minmax = filterRanges[name];
  const scale =
    minmax == undefined
      ? undefined
      : (x: number) =>
          minmax[0] +
          (minmax[1] - minmax[0]) *
            filterSettings[name].scale(
              (x - minmax[0]) / (minmax[1] - minmax[0])
            );

  useEffect(
    () => setValue(filterRanges[name]),
    [filterRanges, name]
  );

  return (
    <SidebarButton
      contentOpen={openSlider}
      setContentOpen={setOpenSlider}
      button={
        <IconButton
          color={
            minmax == undefined ||
            value == undefined ||
            minmax.every((v, i) => v === value[i])
              ? "default"
              : "primary"
          }
          size="small"
          sx={{
            width: "30px",
            mx: "1px",
          }}
          onClick={() => {
            setValue(minmax);
            setValueFilter(
              name,
              verifyValue(minmax, scale)
            );
          }}
        >
          {filterSettings[name].icon}
        </IconButton>
      }
    >
      {scale &&
        value != undefined &&
        minmax != undefined && (
          <Slider
            getAriaLabel={() => name}
            sx={{width: "160px", mx: 3, mt: 1}}
            min={minmax[0]}
            max={minmax[1]}
            scale={scale}
            valueLabelFormat={(value) =>
              filterSettings[name].tooltip(value)
            }
            value={value}
            onChange={(event, newValue) => {
              setValue(verifyValue(newValue));
            }}
            onChangeCommitted={(event, newValue) => {
              setValueFilter(
                name,
                verifyValue(newValue, scale)
              );
            }}
            size="small"
            valueLabelDisplay="on"
          />
        )}
    </SidebarButton>
  );
}

const SidebarButton = ({
  children,
  onMouseLeave,
  contentOpen,
  setContentOpen,
  button,
}: {
  children: React.ReactNode;
  onMouseLeave?: () => void;
  contentOpen: boolean;
  setContentOpen: (open: boolean) => void;
  button: ReactElement;
}) => {
  const buttonRef = useRef(null);
  const theme = useTheme();
  const open = useStore((state) => state.drawerOpen);
  const [delayOpen, setDelayOpen] = useState(open);

  useEffect(() => {
    if (open) {
      setDelayOpen(true);
    } else {
      setTimeout(() => {
        setDelayOpen(false);
      }, theme.transitions.duration.leavingScreen);
    }
  }, [open, theme.transitions.duration.leavingScreen]);

  return (
    <Box
      ref={buttonRef}
      sx={{width: 1, display: "flex"}}
      onMouseEnter={() => {
        setContentOpen(true);
      }}
      onMouseLeave={
        onMouseLeave
          ? onMouseLeave
          : () => {
              setContentOpen(false);
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
        {button}
      </Box>
      {delayOpen && (
        <Fade
          in={open}
          timeout={
            theme.transitions.duration.enteringScreen
          }
        >
          <Box
            sx={{
              alignItems: "center",
              width: "210px",
              height: "50px",
              p: 0,
            }}
          >
            {children}
          </Box>
        </Fade>
      )}
      {!open && (
        <Popover
          sx={{pointerEvents: "none"}}
          id="settingPopover"
          open={!open && contentOpen}
          onClose={() => setContentOpen(false)}
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
          {children}
        </Popover>
      )}
    </Box>
  );
};

export const DrawerHeader = styled("div")(({theme}) => {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0, 1),
    minHeight: theme.customValues.toolbarHeight,
  };
});
