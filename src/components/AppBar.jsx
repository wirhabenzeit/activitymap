import { useState, useContext } from "react";

import Cookies from "js-cookie";

import {
  Box,
  Link,
  Typography,
  MenuItem,
  Menu,
  List,
  ListItem,
  Tooltip,
  ListItemIcon,
  ListItemText,
  ListItemAvatar,
  CircularProgress,
  Avatar,
  IconButton,
  TextField,
  Dialog,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Switch,
  FormGroup,
  FormControlLabel,
  Snackbar,
} from "@mui/material";
import {
  IosShare as ShareIcon,
  Link as LinkIcon,
  Close as CloseIcon,
  Add as AddIcon,
  Logout as LogoutIcon,
} from "@mui/icons-material";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);

import { ActivityContext } from "/src/contexts/ActivityContext";
import { MapContext } from "/src/contexts/MapContext";
import { SelectionContext } from "/src/contexts/SelectionContext";

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
      <img src="btn_strava.svg" />
    </IconButton>
  );
}

function ShareButton() {
  const [open, setOpen] = useState(false);

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
  const activityContext = useContext(ActivityContext);
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
      {activityContext.loading && <CircularProgress color="inherit" />}
    </>
  );
}

function UserSettings() {
  const [anchorElUser, setAnchorElUser] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activityContext = useContext(ActivityContext);

  return (
    <>
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
            <Link
              color="inherit"
              href={"https://strava.com/athletes/" + activityContext.athlete}
              target="_blank"
              rel="noreferrer"
              underline="none"
            >
              <Typography textAlign="center">Strava Profile</Typography>
            </Link>
          </MenuItem>
          <MenuItem
            key="logout"
            onClick={() => {
              setAnchorElUser(null);
              setSettingsOpen(true);
            }}
          >
            <Typography textAlign="center">Settings</Typography>
          </MenuItem>
        </Menu>
      </Box>
      <SettingsDialog
        open={settingsOpen}
        handleClose={() => setSettingsOpen(false)}
      />
    </>
  );
}

function SettingsDialog({ open, handleClose }) {
  const activityContext = useContext(ActivityContext);
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);

  const handleInfoClick = () => {
    setInfoOpen(true);
  };

  const handleInfoClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }

    setInfoOpen(false);
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>User Settings</DialogTitle>
        <DialogContent>
          <List sx={{ width: "300px", pt: 0 }}>
            <ListItem
              disableGutters
              secondaryAction={
                <Box sx={{ position: "relative" }} edge="end">
                  <IconButton
                    aria-label="logout"
                    color="primary"
                    onClick={() => {
                      Cookies.remove("athlete");
                      location.reload();
                    }}
                  >
                    <Tooltip title="Logout">
                      <LogoutIcon />
                    </Tooltip>
                  </IconButton>
                </Box>
              }
            >
              <ListItemAvatar>
                <Avatar
                  alt={activityContext.athlete_name}
                  src={activityContext.athlete_img}
                />
              </ListItemAvatar>
              <ListItemText primary={activityContext.athlete_name} />
            </ListItem>
            <ListItem
              disableGutters
              secondaryAction={
                <Box sx={{ position: "relative" }} edge="end">
                  <Tooltip title="Load more activities">
                    <IconButton
                      disabled={disabled}
                      aria-label="save"
                      color="primary"
                      onClick={() => {
                        setLoading(true);
                        activityContext.loadMore().then((res) => {
                          setLoading(false);
                          if (res === 0) {
                            setDisabled(true);
                          }
                        });
                      }}
                    >
                      <AddIcon />
                    </IconButton>
                  </Tooltip>
                  {loading && (
                    <CircularProgress
                      size={32}
                      sx={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        zIndex: 1,
                      }}
                    />
                  )}
                </Box>
              }
            >
              <ListItemIcon>
                <FontAwesomeIcon fontSize="large" icon="child-reaching" />
              </ListItemIcon>
              <Tooltip title="Strava only allows to download 200 activities at a time">
                <ListItemText
                  primary="Activities"
                  secondary={activityContext.geoJson.features.length}
                />
              </Tooltip>
            </ListItem>
          </List>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShareDialog({ open, handleClose }) {
  const activityContext = useContext(ActivityContext);
  const mapContext = useContext(MapContext);
  const selectionContext = useContext(SelectionContext);
  const [mapValue, setMapValue] = useState(true);
  const [selectedValue, setSelectedValue] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const handleInfoClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }

    setInfoOpen(false);
  };

  const action = (
    <IconButton
      size="small"
      aria-label="close"
      color="inherit"
      onClick={handleInfoClose}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  );

  var shareUrl =
    window.location.origin +
    window.location.pathname +
    window.location.hash +
    "?" +
    new URLSearchParams({
      ...(mapValue && {
        position: JSON.stringify(mapContext.position),
        baseMap: JSON.stringify(mapContext.baseMap),
        overlayMaps: JSON.stringify(mapContext.overlayMaps),
        threeDim: JSON.stringify(mapContext.threeDim),
      }),
      ...(selectedValue &&
        selectionContext.selected.length > 0 && {
          activities: selectionContext.selected,
        }),
      ...((!selectedValue || selectionContext.selected.length === 0) && {
        athlete: activityContext.athlete,
      }),
    }).toString();

  return (
    <>
      <Snackbar
        open={infoOpen}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        autoHideDuration={1000}
        onClose={handleInfoClose}
        message="Copied to clipboard"
        action={action}
      />
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Share Link</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Create a shareable link to this page, which will include either all
            or the currently selected activities.
          </DialogContentText>
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  value={mapValue}
                  onChange={(e) => setMapValue(e.target.checked)}
                  defaultChecked
                />
              }
              label="Share current map settings"
            />
            <FormControlLabel
              disabled={selectionContext.selected.length === 0}
              control={
                <Switch
                  value={selectedValue}
                  onChange={(e) => setSelectedValue(e.target.checked)}
                />
              }
              label="Include only selected activities"
            />
          </FormGroup>
          <TextField
            margin="dense"
            id="url"
            value={shareUrl}
            name="Link"
            fullWidth
            InputProps={{
              endAdornment: (
                <IconButton
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl);
                    handleInfoClick();
                  }}
                >
                  <LinkIcon />
                </IconButton>
              ),
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
