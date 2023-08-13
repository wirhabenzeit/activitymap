import * as React from "react";
import LinkIcon from "@mui/icons-material/Link";
import { ActivityContext } from "/src/contexts/ActivityContext";
import { MapContext } from "/src/contexts/MapContext";
import { SelectionContext } from "/src/contexts/SelectionContext";
import { ListContext } from "/src/contexts/ListContext";

import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";

import {
  Switch,
  FormGroup,
  FormControlLabel,
  Snackbar,
  IconButton,
  Portal,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

function ShareDialog({ open, handleClose }) {
  const activityContext = React.useContext(ActivityContext);
  const mapContext = React.useContext(MapContext);
  const selectionContext = React.useContext(SelectionContext);
  const [mapValue, setMapValue] = React.useState(true);
  const [selectedValue, setSelectedValue] = React.useState(false);
  const [infoOpen, setInfoOpen] = React.useState(false);

  const handleInfoClick = () => {
    setInfoOpen(true);
  };

  const handleInfoClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }

    setInfoOpen(false);
  };

  const action = (
    <React.Fragment>
      <IconButton
        size="small"
        aria-label="close"
        color="inherit"
        onClick={handleInfoClose}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </React.Fragment>
  );

  var shareUrl =
    window.location.origin +
    window.location.pathname +
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
            {/*<FormControlLabel
            control={
              <Switch
                value={listValue}
                onChange={(e) => setListValue(e.target.checked)}
                defaultChecked
              />
            }
            label="Share current list settings"
          />*/}
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
      <Portal></Portal>
    </>
  );
}

export default ShareDialog;
