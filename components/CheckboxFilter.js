import * as React from "react";
import { IconButton } from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { library, config } = require("@fortawesome/fontawesome-svg-core");
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "@/components/Context/FilterContext";
import SidebarButton from "@/components/SidebarButton";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import { Cancel, Help, CheckCircle } from "@mui/icons-material";
import { categorySettings, binaryFilters } from "@/settings";

export default function CheckboxFilter({ open, name }) {
  const [openContent, setOpenContent] = React.useState(false);
  const filterContext = React.useContext(FilterContext);

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
            checked={filterContext.binary[name] === true}
            indeterminate={filterContext.binary[name] === undefined}
            onChange={(event) => {
              if (filterContext.binary[name] === undefined) {
                filterContext.setBinary(name, true);
              } else if (filterContext.binary[name] === true) {
                filterContext.setBinary(name, false);
              } else {
                filterContext.setBinary(name, undefined);
              }
            }}
          />
        }
      />
    </SidebarButton>
  );
}
