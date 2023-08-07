import { Box, Paper } from "@mui/material";

export default function SidebarButton(props) {
  return (
    <Box
      sx={{ width: 1, display: "flex", flexDirection: "row" }}
      onMouseEnter={() => {
        console.log("mouse enter");
        props.setContentOpen(true);
      }}
      onMouseLeave={
        "onMouseLeave" in props
          ? props.onMouseLeave
          : () => {
              console.log("mouse leave");
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
          position: "fixed",
          left: "32px",
          padding: 0,
          width: "210px",
          height: "50px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          visibility: props.contentOpen || props.open ? "visible" : "hidden",
        }}
      >
        {props.content}
      </Paper>
    </Box>
  );
}
