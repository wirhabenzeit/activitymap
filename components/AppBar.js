import * as React from "react";
import { ThemeProvider, styled, createTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import MuiAppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MapIcon from "@mui/icons-material/Map";
import Menu from "@mui/material/Menu";
import { Tabs, Tab } from "@mui/material";
import Avatar from "@mui/material/Avatar";
import { ActivityContext } from "@/components/Context/ActivityContext";

import IconButton from "@mui/material/IconButton";
import Link from "next/link";
import { useRouter } from "next/router";
import Cookies from "js-cookie";
import ShareIcon from "@mui/icons-material/IosShare";

import ShareDialog from "@/components/ShareDialog";
import { PropaneSharp } from "@mui/icons-material";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

function LoginButton() {
  return (
    <IconButton
      href={`https://www.strava.com/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${window.location.href}&approval_prompt=auto&scope=read,activity:read`}
      color="inherit"
      sx={{ p: 0 }}
    >
      <img src="btn_strava_connectwith_light.svg" />
    </IconButton>
  );
}

function ShareButton({ mapRef }) {
  const [open, setOpen] = React.useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <>
      <IconButton sx={{ mx: 2 }} onClick={handleClickOpen}>
        <ShareIcon />
      </IconButton>
      <ShareDialog open={open} handleClose={handleClose} mapRef={mapRef} />
    </>
  );
}

export function User({ mapRef }) {
  const activityContext = React.useContext(ActivityContext);
  return (
    <>
      {activityContext.loaded &&
        Cookies.get("athlete") &&
        !activityContext.guestMode && (
          <>
            <ShareButton mapRef={mapRef} />
            <UserSettings />
          </>
        )}
      {!activityContext.loaded && !activityContext.loading && <LoginButton />}
    </>
  );
}

function UserSettings() {
  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const activityContext = React.useContext(ActivityContext);

  return (
    <Box sx={{ flexGrow: 0 }}>
      <IconButton
        onClick={(e) => {
          setAnchorElUser(e.currentTarget);
        }}
        sx={{ p: 0 }}
      >
        <Avatar
          alt={activityContext.athlete_name}
          src={activityContext.athlete_img}
        />
      </IconButton>
      <Menu
        sx={{ mt: "45px" }}
        id="menu-appbar"
        anchorEl={anchorElUser}
        anchorOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        keepMounted
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        open={Boolean(anchorElUser)}
        onClose={() => {
          setAnchorElUser(null);
        }}
      >
        <MenuItem
          key="stravaLink"
          onClick={() => {
            setAnchorElUser(null);
          }}
        >
          <Link href={"https://strava.com/athletes/" + activityContext.athlete}>
            <Typography textAlign="center">Strava Profile</Typography>
          </Link>
        </MenuItem>
        <MenuItem
          key="logout"
          onClick={() => {
            setAnchorElUser(null);
          }}
        >
          <Typography
            textAlign="center"
            onClick={() => {
              Cookies.remove("athlete");
              location.reload();
            }}
          >
            Logout
          </Typography>
        </MenuItem>
      </Menu>
    </Box>
  );
}

export default function ResponsiveAppBar({
  open,
  setOpen,
  nav,
  drawerWidth,
  mapRef,
}) {
  const AppBar = styled(MuiAppBar, {
    shouldForwardProp: (prop) => prop !== "open",
  })(({ theme, open }) => ({
    zIndex: theme.zIndex.drawer + 1,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
    ...(open && {
      marginLeft: drawerWidth,
      width: `calc(100% - ${drawerWidth}px)`,
      transition: theme.transitions.create(["width", "margin"], {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.enteringScreen,
      }),
    }),
  }));

  return (
    <AppBar position="fixed" open={open}>
      <ThemeProvider theme={darkTheme}>
        <Toolbar sx={{ pl: { xs: 0, sm: 0 } }}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            onClick={() => {
              setOpen(true);
            }}
            edge="start"
            sx={{
              p: 0,
              mx: 0.25,
              ...(open && { display: "none" }),
            }}
          >
            <ChevronRightIcon />
          </IconButton>
          <MapIcon sx={{ mx: 1, display: { xs: "none", sm: "flex" } }} />
          <Typography
            variant="h6"
            noWrap
            component="a"
            href="/"
            sx={{
              mr: 2,
              fontWeight: 700,
              color: "inherit",
              textDecoration: "none",
              display: { xs: "none", sm: "flex" },
            }}
          >
            StravaMap
          </Typography>
          {nav}
          <Box sx={{ flexGrow: 1 }} />
          <User mapRef={mapRef} />
        </Toolbar>
      </ThemeProvider>
    </AppBar>
  );
}
