import * as React from "react";
import { useMemo, useState } from "react";
import { Box, Menu, MenuItem, Button } from "@mui/material";
import {
  DataGrid,
  GridToolbarContainer,
  useGridApiContext,
  GridToolbarColumnsButton,
  GridToolbarDensitySelector,
  GridFooterContainer,
} from "@mui/x-data-grid";
import { listSettings } from "../settings";
import { ActivityContext } from "/src/contexts/ActivityContext";
import { FilterContext } from "/src/contexts/FilterContext";
import { SelectionContext } from "/src/contexts/SelectionContext";
import { ListContext } from "/src/contexts/ListContext";
import { CheckBoxOutlineBlank, CheckBox } from "@mui/icons-material";
import { useGridRootProps } from "@mui/x-data-grid";
import { GridPagination } from "@mui/x-data-grid";
import { useGridSelector } from "@mui/x-data-grid";
import { selectedGridRowsCountSelector } from "@mui/x-data-grid";

export function LoadMoreButton() {
  const [disabled, setDisabled] = useState(false);
  const activityContext = React.useContext(ActivityContext);
  return (
    <Button
      onClick={async () => {
        const newActivities = await activityContext.loadMore();
        setDisabled(newActivities === 0);
      }}
      disabled={disabled}
    >
      Reload
    </Button>
  );
}

export function CustomFooterStatusComponent() {
  const activityContext = React.useContext(ActivityContext);
  const apiRef = useGridApiContext();
  const nSelected = useGridSelector(apiRef, selectedGridRowsCountSelector);
  const nTotal = apiRef.current.getRowsCount();
  return (
    <GridFooterContainer>
      <Box sx={{ p: 1, display: "flex" }}>
        {nSelected > 0 ? nSelected + "/" + nTotal : nTotal} Acts.
      </Box>
      <GridPagination />
    </GridFooterContainer>
  );
}

export default function List() {
  const activityContext = React.useContext(ActivityContext);
  const selectionContext = React.useContext(SelectionContext);
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
                value: selectionContext.selected.map((id) => id.toString()),
              },
            ],
      });
    };

    return (
      <GridToolbarContainer>
        <rootProps.slots.baseButton
          disabled={selectionContext.selected.length === 0}
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
      </GridToolbarContainer>
    );
  };

  return (
    <>
      <DataGrid
        rows={filter.filterIDs.map((key) => activityContext.activityDict[key])} //.filter((data) =>
        //  filter.filterIDs.includes(data.properties.id)
        //)}
        columns={listSettings(activityContext).columns}
        disableColumnMenu
        pageSizeOptions={[100]}
        density="compact"
        checkboxSelection
        disableColumnFilter
        slots={{ toolbar: CustomToolbar, footer: CustomFooterStatusComponent }}
        rowSelectionModel={selectionContext.selected}
        onRowSelectionModelChange={(newRowSelectionModel) => {
          selectionContext.setSelected(newRowSelectionModel);
        }}
        sortModel={listState.full.sortModel}
        onSortModelChange={(model) => listState.setSortModel("full", model)}
        columnVisibilityModel={listState.full.columnVisibilityModel}
        onColumnVisibilityModelChange={(newModel) =>
          listState.setColumnVisibilityModel("full", newModel)
        }
        //localeText={{footerRowSelected: (count) => `${count} activit${(count===1)?"y":"ies"} selected`}}
      />
    </>
  );
}
