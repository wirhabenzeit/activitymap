import * as React from "react";
import LinkIcon from "@mui/icons-material/Link";
import { ActivityContext } from "@/ActivityContext";
import { MapContext } from "@/MapContext";
import { FilterContext } from "@/FilterContext";
import { ListContext } from "@/ListContext";

import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";

import { Switch, FormGroup, FormControlLabel } from "@mui/material";

import IconButton from "@mui/material/IconButton";

function ShareDialog({ open, handleClose }) {
  const activityContext = React.useContext(ActivityContext);
  const mapContext = React.useContext(MapContext);
  const listContext = React.useContext(ListContext);
  const filterContext = React.useContext(FilterContext);
  const [mapValue, setMapValue] = React.useState(true);
  const [listValue, setListValue] = React.useState(true);
  const [selectedValue, setSelectedValue] = React.useState(false);
  console.log(mapContext);
  var shareUrl =
    window.location.href +
    "?" +
    new URLSearchParams({
      ...(mapValue && {
        mapPosition: JSON.stringify(mapContext.position),
        baseMap: mapContext.baseMap,
        overlayMaps: JSON.stringify(mapContext.overlayMaps),
        threeDim: mapContext.threeDim,
      }),
      ...(listValue && {
        fullListState: JSON.stringify(listContext.full),
        compactListState: JSON.stringify(listContext.compact),
      }),
      ...(selectedValue &&
        filterContext.selected.length > 0 && {
          activities: filterContext.selected,
        }),
      ...((!selectedValue || filterContext.selected.length === 0) && {
        athlete: activityContext.athlete,
      }),
    }).toString();

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>Share Link</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Create a shareable link to this page, which will include either all or
          the currently selected activities.
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
            control={
              <Switch
                value={listValue}
                onChange={(e) => setListValue(e.target.checked)}
                defaultChecked
              />
            }
            label="Share current list settings"
          />
          <FormControlLabel
            disabled={filterContext.selected.length === 0}
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
                }}
              >
                <LinkIcon />
              </IconButton>
            ),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default ShareDialog;
