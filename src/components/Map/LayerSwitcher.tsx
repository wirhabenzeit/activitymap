import {
  useState,
  type MutableRefObject,
  type MouseEvent,
} from "react";
import {
  MenuItem,
  Box,
  IconButton,
  Menu,
  ListItemText,
  MenuList,
  Divider,
  Paper,
  ListItemIcon,
} from "@mui/material";
import {
  Map as MapIcon,
  Check as CheckIcon,
  ThreeDRotation as ThreeDimIcon,
} from "@mui/icons-material";
import type {SxProps, Theme} from "@mui/material/styles";

import {useStore} from "~/contexts/Zustand";

import {mapSettings} from "~/settings/map";
import {type MapRef} from "react-map-gl";

export function LayerSwitcher({
  sx,
  mapRef,
}: {
  sx: SxProps<Theme>;
  mapRef: MutableRefObject<MapRef | null>;
}) {
  const {
    threeDim,
    toggleThreeDim,
    overlayMaps,
    baseMap,
    toggleOverlayMap,
    setBaseMap,
  } = useStore((state) => ({
    threeDim: state.threeDim,
    toggleThreeDim: state.toggleThreeDim,
    overlayMaps: state.overlayMaps,
    baseMap: state.baseMap,
    toggleOverlayMap: state.toggleOverlayMap,
    setBaseMap: state.setBaseMap,
  }));

  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const handleClick = (
    event: MouseEvent<HTMLAnchorElement, MouseEvent>
  ) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Box>
      <Paper
        sx={{
          p: 0,
          width: "30px",
          borderRadius: 1,
          ...sx,
        }}
        elevation={1}
      >
        <IconButton onClick={handleClick} sx={{p: "3px"}}>
          <MapIcon fontSize="medium" />
        </IconButton>
        <Divider />
        <IconButton
          sx={{p: "3px"}}
          onClick={() => {
            if (threeDim)
              mapRef.current?.easeTo({
                pitch: 0,
                duration: 1000,
              });
            else
              mapRef.current?.easeTo({
                pitch: 60,
                duration: 1000,
              });
            toggleThreeDim();
          }}
        >
          <ThreeDimIcon
            fontSize="medium"
            color={threeDim ? "primary" : "disabled"}
          />
        </IconButton>
      </Paper>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
        sx={{
          "&& .MuiList-root": {py: 0.5},
        }}
      >
        <MenuList dense>
          {Object.entries(mapSettings)
            .filter(([, val]) => val.overlay === false)
            .map(([key]) => (
              <MenuItem
                key={key}
                value={key}
                onClick={() => setBaseMap(key)}
              >
                {baseMap !== key && (
                  <ListItemText inset> {key} </ListItemText>
                )}
                {baseMap === key && (
                  <>
                    <ListItemIcon>
                      <CheckIcon />
                    </ListItemIcon>
                    {key}
                  </>
                )}
              </MenuItem>
            ))}
          <Divider />
          {Object.entries(mapSettings)
            .filter(([, val]) => val.overlay === true)
            .map(([key]) => (
              <MenuItem
                key={key}
                value={key}
                onClick={() => toggleOverlayMap(key)}
              >
                {!overlayMaps.includes(key) && (
                  <ListItemText inset> {key} </ListItemText>
                )}
                {overlayMaps.includes(key) && (
                  <>
                    <ListItemIcon>
                      <CheckIcon />
                    </ListItemIcon>
                    {key}
                  </>
                )}
              </MenuItem>
            ))}
        </MenuList>
      </Menu>
    </Box>
  );
}
