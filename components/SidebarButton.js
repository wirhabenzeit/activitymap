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
          visibility: props.open ? "visible" : "hidden",
          alignItems: "center",
          width: "220px",
          height: "50px",
          p: 0,
          pb: 0.5,
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
    </Box>
  );
}
