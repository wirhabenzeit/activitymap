import { useContext, useState } from "react";
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

import { MapContext } from "/src/contexts/MapContext";
import { mapSettings } from "../../settings";

export function LayerSwitcher(props) {
  const mapContext = useContext(MapContext);
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const handleClick = (event) => {
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
          ...props.sx,
        }}
        elevation={1}
      >
        <IconButton onClick={handleClick} sx={{ p: "3px" }}>
          <MapIcon fontSize="10px" />
        </IconButton>
        <Divider />
        <IconButton
          sx={{ p: "3px" }}
          onClick={() => {
            if (mapContext.threeDim)
              props.mapRef.current.easeTo({ pitch: 0, duration: 1000 });
            else props.mapRef.current.easeTo({ pitch: 60, duration: 1000 });
            mapContext.toggleThreeDim();
          }}
        >
          <ThreeDimIcon
            fontSize="10px"
            color={mapContext.threeDim ? "primary" : "disabled"}
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
          "&& .MuiList-root": { py: 0.5 },
        }}
      >
        <MenuList dense>
          {Object.entries(mapSettings)
            .filter(([key, val]) => val.overlay === false)
            .map(([key, val]) => (
              <MenuItem
                key={key}
                value={key}
                onClick={() => mapContext.setBaseMap(key)}
              >
                {mapContext.baseMap !== key && (
                  <ListItemText inset> {key} </ListItemText>
                )}
                {mapContext.baseMap === key && (
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
            .filter(([key, val]) => val.overlay === true)
            .map(([key, val]) => (
              <MenuItem
                key={key}
                value={key}
                onClick={() => mapContext.toggleOverlayMap(key)}
              >
                {!mapContext.overlayMaps.includes(key) && (
                  <ListItemText inset> {key} </ListItemText>
                )}
                {mapContext.overlayMaps.includes(key) && (
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
