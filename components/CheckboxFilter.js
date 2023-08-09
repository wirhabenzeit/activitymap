import * as React from "react";
import { useState, useEffect } from "react";
import { IconButton, TextField } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { library, config } = require("@fortawesome/fontawesome-svg-core");
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "@/components/Context/FilterContext";
import SidebarButton from "@/components/SidebarButton";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import { Cancel, Circle, Help, CheckCircle } from "@mui/icons-material";
import { filterSettings, categorySettings, binaryFilters } from "@/settings";
console.log(categorySettings);

export default function CheckboxFilter({ open, name }) {
  const [openContent, setOpenContent] = React.useState(false);
  const filterContext = React.useContext(FilterContext);
  const [value, setValue] = useState(filterContext.binary[name]);

  useEffect(() => filterContext.setBinary(name, value), [value]);

  return (
    <SidebarButton
      open={open}
      contentOpen={openContent}
      setContentOpen={setOpenContent}
      button={
        <IconButton
          sx={{
            width: "30px",
            mx: "1px",
            color: value === undefined ? "text.disabled" : "primary",
          }}
          onClick={() => {
            setValue(undefined);
            filterContext.setBinary(name, undefined);
          }}
        >
          <FontAwesomeIcon fontSize="medium" icon={binaryFilters[name].icon} />
        </IconButton>
      }
    >
      <FormControlLabel
        label={binaryFilters[name].label}
        labelPlacement="start"
        control={
          <Checkbox
            sx={{ mr: 1 }}
            icon={<Cancel />}
            color="default"
            checkedIcon={<CheckCircle />}
            indeterminateIcon={<Help />}
            checked={value}
            indeterminate={value === undefined}
            onChange={(event) => {
              console.log(value);
              if (value === undefined) {
                setValue(true);
              } else if (value) {
                setValue(false);
              } else {
                setValue(undefined);
              }
            }}
          />
        }
      />
    </SidebarButton>
  );
}
