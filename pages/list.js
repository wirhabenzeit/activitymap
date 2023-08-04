import * as React from "react";
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import {
  DataGrid,
  GridToolbarContainer,
  useGridApiContext,
  GridToolbarColumnsButton,
  GridToolbarDensitySelector,
  GridToolbarExport,
  GridFooterContainer,
} from "@mui/x-data-grid";
import { listSettings } from "@/settings";
import { ActivityContext } from "@/ActivityContext";
import { FilterContext } from "@/FilterContext";
import { ListContext } from "@/ListContext";
import { CheckBoxOutlineBlank, CheckBox } from "@mui/icons-material";
import { useGridRootProps } from "@mui/x-data-grid";
import { GridPagination } from "@mui/x-data-grid";
import { useGridSelector } from "@mui/x-data-grid";
import { selectedGridRowsCountSelector } from "@mui/x-data-grid";

export function CustomFooterStatusComponent() {
  const apiRef = useGridApiContext();
  const nSelected = useGridSelector(apiRef, selectedGridRowsCountSelector);
  const nTotal = apiRef.current.getRowsCount();
  return (
    <GridFooterContainer>
      <Box sx={{ p: 1, display: "flex" }}>
        {nSelected > 0 ? nSelected + "/" + nTotal : nTotal} Activities
      </Box>
      <GridPagination />
    </GridFooterContainer>
  );
}

export default function List() {
  const activityContext = React.useContext(ActivityContext);
  const filter = React.useContext(FilterContext);
  const listState = React.useContext(ListContext);

  const CustomToolbar = () => {
    const rootProps = useGridRootProps();
    const apiRef = useGridApiContext();
    const [checked, setChecked] = useState(false);

    const switchHandler = (event) => {
      setChecked((checked) => !checked);
      apiRef.current.setFilterModel({
        items: checked
          ? []
          : [
              {
                field: "id",
                operator: "isAnyOf",
                value: filter.selected.map((id) => id.toString()),
              },
            ],
      });
    };

    return (
      <GridToolbarContainer>
        <rootProps.slots.baseButton
          disabled={filter.selected.length === 0}
          id="selectedOnly"
          size="small"
          aria-label="Show Selected Only"
          startIcon={checked ? <CheckBox /> : <CheckBoxOutlineBlank />}
          onClick={switchHandler}
          {...rootProps.slotProps?.baseButton}
        >
          {checked ? "Selected" : "All"}
        </rootProps.slots.baseButton>
        <GridToolbarColumnsButton />
        <GridToolbarDensitySelector />
        <GridToolbarExport />
      </GridToolbarContainer>
    );
  };

  const activeCat = [];
  Object.entries(filter.categories).forEach(([key, value]) => {
    activeCat.push(...value.filter);
  });
  const customFilter = (data) => {
    if (!activeCat.includes(data.properties.type)) return false;
    if (
      Object.entries(filter.values).some(
        ([key, value]) =>
          data.properties[key] < value[0] || data.properties[key] > value[1]
      )
    )
      return false;
    return true;
  };

  return (
    <DataGrid
      rows={activityContext.geoJson.features.filter(customFilter)}
      columns={listSettings.columns}
      pageSizeOptions={[100]}
      checkboxSelection
      disableColumnFilter
      slots={{ toolbar: CustomToolbar, footer: CustomFooterStatusComponent }}
      rowSelectionModel={filter.selected}
      onRowSelectionModelChange={(newRowSelectionModel) => {
        filter.setSelected(newRowSelectionModel);
      }}
      sortModel={listState.full.sortModel}
      onSortModelChange={(model) => listState.setSortModel("full", model)}
      columnVisibilityModel={listState.full.columnVisibilityModel}
      onColumnVisibilityModelChange={(newModel) =>
        listState.setColumnVisibilityModel("full", newModel)
      }
      //localeText={{footerRowSelected: (count) => `${count} activit${(count===1)?"y":"ies"} selected`}}
    />
  );
}
