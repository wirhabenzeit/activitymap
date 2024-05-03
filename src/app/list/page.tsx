"use client";

import {listSettings} from "~/settings/list";

import {useState} from "react";

import {Box, Button} from "@mui/material";
import {
  CheckBoxOutlineBlank,
  CheckBox,
} from "@mui/icons-material";
import {
  DataGrid,
  GridToolbarContainer,
  useGridApiContext,
  GridToolbarColumnsButton,
  GridFooterContainer,
  useGridRootProps,
  GridPagination,
  useGridSelector,
  selectedGridRowsCountSelector,
} from "@mui/x-data-grid";

import type {
  GridRowSelectionModel,
  GridSortModel,
  GridColumnVisibilityModel,
} from "@mui/x-data-grid";

import {useStore} from "~/contexts/Zustand";

export function LoadMoreButton() {
  const [disabled, setDisabled] = useState(false);
  const loadMore = useStore(
    (state) => state.loadFromStrava
  );

  return (
    <Button
      onClick={async () => {
        const newActivities = await loadMore({
          photos: false,
        });
        setDisabled(newActivities === 0);
      }}
      disabled={disabled}
    >
      Reload
    </Button>
  );
}

function CustomFooterStatusComponent() {
  const apiRef = useGridApiContext();
  const nSelected = useGridSelector(
    apiRef,
    selectedGridRowsCountSelector
  );
  const nTotal = apiRef.current.getRowsCount();
  return (
    <GridFooterContainer>
      <Box sx={{p: 1, display: "flex"}}>
        {nSelected > 0 ? nSelected + "/" + nTotal : nTotal}{" "}
        Acts.
      </Box>
      <GridPagination />
    </GridFooterContainer>
  );
}

export default function List() {
  const {
    activityDict,
    filterIDs,
    selected,
    setSelected,
    fullList,
    setSortModel,
    setColumnVisibilityModel,
  } = useStore((state) => ({
    activityDict: state.activityDict,
    filterIDs: state.filterIDs,
    selected: state.selected,
    setSelected: state.setSelected,
    fullList: state.fullList,
    setSortModel: state.setSortModel,
    setColumnVisibilityModel: state.setColumnModel,
  }));
  const rows = filterIDs.map((key) => activityDict[key]);

  const CustomToolbar = () => {
    const rootProps = useGridRootProps();
    const apiRef = useGridApiContext();
    const [checked, setChecked] = useState(false);

    const switchHandler = () => {
      setChecked((checked) => !checked);
      apiRef.current.setFilterModel({
        items: checked
          ? []
          : [
              {
                field: "id",
                operator: "isAnyOf",
                value: selected.map((id) => id.toString()),
              },
            ],
      });
    };
    return (
      <GridToolbarContainer>
        <rootProps.slots.baseButton
          disabled={selected.length === 0}
          id="selectedOnly"
          size="small"
          aria-label="Show Selected Only"
          startIcon={
            checked ? (
              <CheckBox />
            ) : (
              <CheckBoxOutlineBlank />
            )
          }
          onClick={switchHandler}
          {...rootProps.slotProps?.baseButton}
        >
          {checked ? "Selected" : "All"}
        </rootProps.slots.baseButton>
        <GridToolbarColumnsButton />
      </GridToolbarContainer>
    );
  };

  return (
    <>
      <DataGrid
        rows={
          rows == undefined
            ? []
            : rows.length > 0
            ? rows
            : []
        }
        columns={listSettings.columns}
        disableColumnMenu
        pageSizeOptions={[100]}
        density="compact"
        checkboxSelection
        disableColumnFilter
        slots={{
          toolbar: CustomToolbar,
          footer: CustomFooterStatusComponent,
        }}
        slotProps={{
          columnsManagement: {
            autoFocusSearchField: false,
          },
        }}
        rowSelectionModel={selected}
        onRowSelectionModelChange={(
          newRowSelectionModel: GridRowSelectionModel
        ) => setSelected(newRowSelectionModel as number[])}
        sortModel={fullList.sortModel}
        onSortModelChange={(model: GridSortModel) =>
          setSortModel("full", model)
        }
        columnVisibilityModel={
          fullList.columnVisibilityModel
        }
        onColumnVisibilityModelChange={(
          newModel: GridColumnVisibilityModel
        ) => setColumnVisibilityModel("full", newModel)}
      />
    </>
  );
}
