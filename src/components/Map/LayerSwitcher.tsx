import {useState, type MouseEvent} from "react";
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

import {useStore} from "~/contexts/Zustand";

import {mapSettings} from "~/settings/map";
import {useMap} from "react-map-gl";

export function LayerSwitcher() {
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

  const map = useMap();

  if (map.current == undefined) return;

  const [anchorEl, setAnchorEl] =
    useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Box>
      <Paper
        sx={{
          p: 0,
          width: "29px",
          borderRadius: 1,
        }}
        elevation={1}
      >
        <IconButton
          onClick={(event) =>
            setAnchorEl(event.currentTarget)
          }
        >
          <MapIcon fontSize="small" sx={{mt: "3px"}} />
        </IconButton>
        <Divider />
        <IconButton
          onClick={() => {
            if (threeDim)
              map.current?.easeTo({
                pitch: 0,
                duration: 1000,
              });
            else
              map.current?.easeTo({
                pitch: 60,
                duration: 1000,
              });
            toggleThreeDim();
          }}
        >
          <ThreeDimIcon
            fontSize="small"
            sx={{mt: "3px"}}
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
