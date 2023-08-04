import * as React from 'react';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Box from '@mui/material/Box';
import ListItemText from '@mui/material/ListItemText';
import Select from '@mui/material/Select';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
const { library, config } = require('@fortawesome/fontawesome-svg-core');
import { fas } from '@fortawesome/free-solid-svg-icons'
library.add(fas);
import { FilterContext } from '@/FilterContext';
import { categorySettings } from '@/settings';

export default function MultiSelect({open,name}) {
    const context = React.useContext(FilterContext);

  const selectChange = (event) => {
    const { value } = event.target;
    event.stopPropagation()
    const newFilter = value === 'string' ? value.split(',') : value;
    context.updateCategoryFilter(name,newFilter);
  };

  return (
    <Box sx={{width: 1, display: "flex", flexDirection: "row"}}>
        <IconButton 
            onClick={() => context.toggleCategory(name)}
            sx={{width:"30px", color:context.categories[name].active? categorySettings[name].color : "text.disabled"}}
        >
            <FontAwesomeIcon fontSize="medium" icon={categorySettings[name].icon} />
        </IconButton>
      <FormControl sx={{ m: 0, width: 1, mr: 1, visibility: open ? "visible" : "hidden" }} size="small">
        <InputLabel id={name+"-label"}>Types</InputLabel>
        <Select
          //id={name}
          //labelId={name+"-label"}
          multiple
          value={context.categories[name].filter}
          onChange={selectChange}
          input={<OutlinedInput label="Types" />}
          renderValue={(selected) => selected.join(', ')}
        >
          {categorySettings[name].alias.map((type) => (
            <MenuItem key={type} value={type}>
              <Checkbox checked={context.categories[name].filter.indexOf(type) > -1} />
              <ListItemText primary={type} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      </Box>
  );
}