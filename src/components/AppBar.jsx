import * as React from "react";
import { ThemeProvider, styled, createTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import MuiAppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MapIcon from "@mui/icons-material/Map";
import Menu from "@mui/material/Menu";
import { Tabs, Tab } from "@mui/material";
import Avatar from "@mui/material/Avatar";
import { ActivityContext } from "/src/contexts/ActivityContext";

import IconButton from "@mui/material/IconButton";
import Cookies from "js-cookie";
import ShareIcon from "@mui/icons-material/IosShare";
import ShareDialog from "/src/components/ShareDialog";

function LoginButton() {
  return (
    <IconButton
      href={`https://www.strava.com/oauth/authorize?client_id=${
        import.meta.env.VITE_STRAVA_CLIENT_ID
      }&response_type=code&redirect_uri=${
        window.location.href
      }&approval_prompt=auto&scope=read,activity:read`}
      color="inherit"
      sx={{ p: 0 }}
    >
      <img src="/src/assets/btn_strava.svg" />
    </IconButton>
  );
}

function ShareButton() {
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
      <ShareDialog open={open} handleClose={handleClose} />
    </>
  );
}

export function User() {
  const activityContext = React.useContext(ActivityContext);
  return (
    <>
      {activityContext.loaded &&
        Cookies.get("athlete") &&
        !activityContext.guestMode && (
          <>
            <ShareButton />
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
