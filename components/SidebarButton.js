import { useRef, useState } from "react";

import { Box, Popover } from "@mui/material";

export default function SidebarButton(props) {
  const buttonRef = useRef(null);

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
          width: "32px",
          height: "50px",
          display: "flex",
          alignItems: "center",
        }}
      >
        {props.button}
      </Box>
      <Box
        sx={{
          display: props.open ? "flex" : "none",
          alignItems: "center",
          width: "210px",
          height: "50px",
          pl: 0,
          pr: 2,
          py: 0.5,
        }}
      >
        {props.children}
      </Box>
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
              width: "210px",
              height: "50px",
              justifyContent: "center",
              alignItems: "center",
              pl: 0,
              pr: 2,
              py: 0.5,
            },
          },
        }}
      >
        {props.children}
      </Popover>
    </Box>
  );
}
