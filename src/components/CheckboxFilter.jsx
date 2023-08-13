import * as React from "react";
import { IconButton } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
//import library from "@fortawesome/fontawesome-svg-core";
//import { fas } from "@fortawesome/free-solid-svg-icons";
import { FilterContext } from "/src/contexts/FilterContext";
import SidebarButton from "/src/components/SidebarButton";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import { Cancel, Help, CheckCircle } from "@mui/icons-material";
import { categorySettings, binaryFilters } from "../settings";

export default function CheckboxFilter({ open, name }) {
  const [openContent, setOpenContent] = React.useState(false);
  const filterContext = React.useContext(FilterContext);
  //filterContext.binary[name]const [value, setValue] = React.useState(filterContext.binary[name]);
  //const [value, setValue] = React.useState(undefined);

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
            color:
              filterContext.binary[name] === undefined
                ? "text.disabled"
                : "primary",
          }}
          onClick={() => {
            console.log("setBinary");
            filterContext.setBinary(name, undefined);
            //setValue(undefined);
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
            checked={filterContext.binary[name] === true}
            indeterminate={filterContext.binary[name] === undefined}
            onChange={(event) => {
              if (filterContext.binary[name] === undefined) {
                console.log("setBinary");
                filterContext.setBinary(name, true);
                //setValue(true);
              } else if (filterContext.binary[name] === true) {
                console.log("setBinary");
                filterContext.setBinary(name, false);
                //setValue(false);
              } else {
                console.log("setBinary");
                filterContext.setBinary(name, undefined);
                //setValue(undefined);
              }
            }}
          />
        }
      />
    </SidebarButton>
  );
}
