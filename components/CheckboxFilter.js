import * as React from "react";
import { useState, useEffect } from "react";
import { IconButton, TextField } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { library, config } = require("@fortawesome/fontawesome-svg-core");
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "@/components/Context/FilterContext";
import SidebarButton from "@/components/SidebarButton";

export default function SearchBox({ open, name }) {
  const [openSearch, setOpenSearch] = React.useState(false);
  const filterContext = React.useContext(FilterContext);
  const [value, setValue] = useState(filterContext.search);

  useEffect(() => {
    const setSearch = setTimeout(() => {
      filterContext.setSearch(value);
    }, 500);

    return () => clearTimeout(setSearch);
  }, [value]);

  return (
    <SidebarButton
      open={open}
      contentOpen={openSearch}
      setContentOpen={setOpenSearch}
      button={
        <IconButton
          sx={{
            width: "30px",
            mx: "1px",
            color: value == "" ? "text.disabled" : "primary",
          }}
          onClick={() => {
            setValue("");
            filterContext.setSearch(name, "");
          }}
        >
          <FontAwesomeIcon fontSize="medium" icon="magnifying-glass" />
        </IconButton>
      }
    >
      <TextField
        sx={{ ml: 0.5, width: 1 }}
        margin="none"
        size="small"
        label="Activity Title"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
    </SidebarButton>
  );
}
