"use client";

import {useState} from "react";
import {
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
  type SnackbarCloseReason,
} from "@mui/material";
import {
  IosShare as ShareIcon,
  Link as LinkIcon,
  Close as CloseIcon,
} from "@mui/icons-material";
import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";
library.add(fas);

import {useStore} from "~/contexts/Zustand";

export function Share() {
  const [open, setOpen] = useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <IconButton sx={{mx: 2}} onClick={handleClickOpen}>
        <ShareIcon />
      </IconButton>
      <ShareDialog
        shareOpen={open}
        setShareOpen={setOpen}
      />
    </>
  );
}

function ShareDialog({
  shareOpen,
  setShareOpen,
}: {
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
}) {
  const {selected} = useStore((state) => ({
    selected: state.selected,
  }));
  const [mapValue, setMapValue] = useState(true);
  const [selectedValue, setSelectedValue] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const handleInfoClose = (
    event: React.SyntheticEvent | Event,
    reason: SnackbarCloseReason
  ) => {
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
      onClick={() => setInfoOpen(true)}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  );

  const shareUrl = "https://strava.com/";

  return (
    <>
      <Snackbar
        open={infoOpen}
        anchorOrigin={{
          vertical: "top",
          horizontal: "center",
        }}
        autoHideDuration={1000}
        onClose={handleInfoClose}
        message="Copied to clipboard"
        action={action}
      />
      <Dialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        slotProps={{backdrop: {style: {opacity: 0.1}}}}
      >
        <DialogTitle>Share Link</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Create a shareable link to this page, which will
            include either all or the currently selected
            activities.
          </DialogContentText>
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  value={mapValue}
                  onChange={(e) =>
                    setMapValue(e.target.checked)
                  }
                  defaultChecked
                />
              }
              label="Share current map settings"
            />
            <FormControlLabel
              disabled={selected.length === 0}
              control={
                <Switch
                  value={selectedValue}
                  onChange={(e) =>
                    setSelectedValue(e.target.checked)
                  }
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
                    setInfoOpen(true);
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
