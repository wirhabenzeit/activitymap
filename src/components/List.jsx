import { useMemo, useState, useContext } from "react";

import { Box, Button } from "@mui/material";
import { CheckBoxOutlineBlank, CheckBox } from "@mui/icons-material";
import {
  DataGrid,
  GridToolbarContainer,
  useGridApiContext,
  GridToolbarColumnsButton,
  GridToolbarDensitySelector,
  GridFooterContainer,
  useGridRootProps,
  GridPagination,
  useGridSelector,
  selectedGridRowsCountSelector,
} from "@mui/x-data-grid";

import { ActivityContext } from "/src/contexts/ActivityContext";
import { FilterContext } from "/src/contexts/FilterContext";
import { SelectionContext } from "/src/contexts/SelectionContext";
import { ListContext } from "/src/contexts/ListContext";

import { listSettings } from "../settings";

export function LoadMoreButton() {
  const [disabled, setDisabled] = useState(false);
  const activityContext = useContext(ActivityContext);
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
  const activityContext = useContext(ActivityContext);
  const selectionContext = useContext(SelectionContext);
  const filter = useContext(FilterContext);
  const listState = useContext(ListContext);

  const rows = useMemo(() => {
    return filter.filterIDs.map((key) => activityContext.activityDict[key]);
  }, [filter.filterIDs, activityContext.activityDict]);

  console.log(`List render: ${rows.length} rows`);

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
        rows={rows}
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
      />
    </>
  );
}
