import { Box, Paper } from "@mui/material";

export default function SidebarButton(props) {
  return (
    <Box
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
      <Paper
        elevation={props.contentOpen && !props.open ? 3 : 0}
        sx={{
          zIndex: 10,
          position: "absolute",
          left: "32px",
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
