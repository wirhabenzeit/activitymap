import { useRef, useState } from "react";

import { Box, Paper } from "@mui/material";

export default function SidebarButton(props) {
  const buttonRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  return (
    <Box
      ref={buttonRef}
      sx={{ width: 1, display: "flex" }}
      onMouseEnter={() => {
        const buttonPos = buttonRef.current.getBoundingClientRect();
        console.log(buttonPos);
        setPosition({ x: buttonPos.x, y: buttonPos.y });
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
      <Paper
        elevation={props.contentOpen && !props.open ? 3 : 0}
        sx={{
          zIndex: 10,
          ...(!props.open && {
            position: "fixed",
            left: "32px",
            top: position.y,
          }),
          ...(props.open && {
            position: "relative",
          }),
          width: "210px",
          height: "50px",
          display: props.contentOpen || props.open ? "block" : "none",
          justifyContent: "center",
          alignItems: "center",
          pl: 0,
          pr: 2,
          py: 0.5,
        }}
      >
        {props.children}
      </Paper>
    </Box>
  );
}
