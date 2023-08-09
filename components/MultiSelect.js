import * as React from "react";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import IconButton from "@mui/material/IconButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { library, config } = require("@fortawesome/fontawesome-svg-core");
import { fas } from "@fortawesome/free-solid-svg-icons";
library.add(fas);
import { FilterContext } from "@/components/Context/FilterContext";
import { categorySettings } from "@/settings";
import SidebarButton from "@/components/SidebarButton";

export default function MultiSelect({ open, name }) {
  const context = React.useContext(FilterContext);

  const selectChange = (event) => {
    const { value } = event.target;
    event.stopPropagation();
    const newFilter = value === "string" ? value.split(",") : value;
    context.updateCategoryFilter(name, newFilter);
  };

  const [contentOpen, setContentOpen] = React.useState(false);
  const [selectOpen, setSelectOpen] = React.useState(false);
  return (
    <SidebarButton
      open={open}
      contentOpen={contentOpen}
      setContentOpen={setContentOpen}
      onMouseLeave={() => {
        if (!selectOpen) setContentOpen(false);
      }}
      button={
        <IconButton
          onClick={() => context.toggleCategory(name)}
          onDoubleClick={() => context.setOnlyCategory(name)}
          sx={{
            width: "30px",
            color: context.categories[name].active
              ? categorySettings[name].color
              : "text.disabled",
          }}
        >
          <FontAwesomeIcon
            fontSize="medium"
            icon={categorySettings[name].icon}
          />
        </IconButton>
      }
    >
      <FormControl
        sx={{
          mr: 2,
          width: 1,
          minWidth: "150px",
        }}
        size="small"
        variant="standard"
      >
        <InputLabel id={name + "-label"}>{name}</InputLabel>
        <Select
          //id={name}
          //labelId={name+"-label"}
          multiple
          value={context.categories[name].filter}
          onChange={selectChange}
          renderValue={(selected) => selected.join(", ")}
          open={selectOpen}
          onOpen={(event) => setSelectOpen(true)}
          onClose={(event) => {
            setContentOpen(false);
            setSelectOpen(false);
          }}
          MenuProps={{
            sx: {
              "&& .Mui-selected": {
                backgroundColor: categorySettings[name].color + "20",
              },
              "&& .MuiList-root": { padding: 0 },
            },
          }}
          style={{ fontSize: "0.8rem" }}
        >
          {categorySettings[name].alias.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </SidebarButton>
  );
}
