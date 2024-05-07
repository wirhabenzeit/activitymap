import * as React from "react";

import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
  type SxProps,
} from "@mui/material";
import type {Value} from "~/contexts/Stats";

export function CustomSelect({
  propName,
  name,
  value,
  options,
  setState,
  sx,
  disabled,
}: {
  value: Value;
  options: Record<string, Value>;
  propName: string;
  name: string;
  setState: (value: Value) => void;
  sx?: SxProps;
  disabled?: boolean;
}) {
  return (
    <FormControl key={propName} sx={sx} disabled={disabled}>
      <InputLabel>{name}</InputLabel>
      <Select
        size="small"
        autoWidth
        id={propName}
        value={value.id}
        label={name}
        onChange={(event: SelectChangeEvent) => {
          const value = options[event.target.value];
          if (value && value != undefined) setState(value);
        }}
      >
        {Object.entries(options).map(
          ([key, aggregator]) => (
            <MenuItem value={key} key={key}>
              {aggregator.label}
            </MenuItem>
          )
        )}
      </Select>
    </FormControl>
  );
}
