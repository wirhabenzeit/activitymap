import { useRef, useState, cloneElement, useEffect } from "react";
import { Box, Popover, Fade } from "@mui/material";
import { useTheme } from "@mui/material/styles";

export default function SidebarButton({
  inlineProps = {},
  popoverProps = {},
  ...props
}) {
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
