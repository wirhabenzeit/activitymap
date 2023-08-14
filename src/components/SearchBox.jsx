import * as React from "react";
import { useState, useEffect } from "react";
import { IconButton, TextField } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "/src/contexts/FilterContext";
import SidebarButton from "/src/components/SidebarButton";

export default function SearchBox({ open, name }) {
  const [openSearch, setOpenSearch] = React.useState(false);
  const filterContext = React.useContext(FilterContext);
  const [value, setValue] = useState(filterContext.search);

  /*useEffect(() => {
    const setSearch = setTimeout(() => {
      filterContext.setSearch(value);
    }, 500);

    return () => clearTimeout(setSearch);
  }, [value]);*/

  return (
    <SidebarButton
      open={open}
      contentOpen={openSearch}
      setContentOpen={setOpenSearch}
      button={
        <IconButton
          disabled={filterContext.search === ""}
          sx={{
            width: "30px",
            mx: "1px",
          }}
          onClick={() => {
            filterContext.setSearch("");
          }}
        >
          <FontAwesomeIcon fontSize="medium" icon="magnifying-glass" />
        </IconButton>
      }
    >
      <TextField
        sx={{ width: "200px", mr: 1, mt: 0.5 }}
        margin="none"
        size="small"
        label="Activity Title"
        value={filterContext.search}
        onChange={(event) => {
          filterContext.setSearch(event.target.value);
        }}
      />
    </SidebarButton>
  );
}
