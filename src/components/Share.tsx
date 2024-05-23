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
import {type User} from "~/server/db/schema";

export function Share() {
  const [open, setOpen] = useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };
  const {selected, user, guest} = useStore((state) => ({
    selected: state.selected,
    user: state.user,
    guest: state.guest,
  }));

  if (!user || guest) return null;
  return (
    <>
      <IconButton sx={{mx: 0}} onClick={handleClickOpen}>
        <ShareIcon sx={{color: "white", opacity: 0.9}} />
      </IconButton>
      <ShareDialog
        shareOpen={open}
        setShareOpen={setOpen}
        selected={selected}
        user={user}
      />
    </>
  );
}

function ShareDialog({
  shareOpen,
  setShareOpen,
  selected,
  user,
}: {
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
  selected: number[];
  user: User;
}) {
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

  const shareUrl = new URL(window.location.href);
  if (selectedValue)
    shareUrl.searchParams.append(
      "activities",
      selected.join(",")
    );
  else shareUrl.searchParams.append("user", user.id);

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
