"use client";

import {listSettings} from "~/settings/list";
import React, {useState} from "react";

import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from "@mui/material";
import {
  CheckBoxOutlineBlank,
  CheckBox,
  Refresh,
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
import {Activity} from "~/server/db/schema";

export function RefreshButton() {
  const {selected, loadFromStrava} = useStore((state) => ({
    selected: state.selected,
    loadFromStrava: state.loadFromStrava,
  }));

  return (
    <Tooltip
      title={
        selected
          ? "Refresh selected activities"
          : "Check for new activities"
      }
    >
      <span>
        <IconButton
          color={
            selected.length == 0 ? "inherit" : "primary"
          }
          onClick={async () => {
            const newAct =
              selected.length > 0
                ? await loadFromStrava({
                    ids: selected,
                    photos: true,
                  })
                : await loadFromStrava({photos: true});
          }}
        >
          <Refresh fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
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

const CustomToolbar = () => {
  const rootProps = useGridRootProps();
  const apiRef = useGridApiContext();
  const [checked, setChecked] = useState(false);

  const selected = useStore((state) => state.selected);

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
    <GridToolbarContainer sx={{flexWrap: "nowrap"}}>
      <rootProps.slots.baseButton
        disabled={selected.length === 0}
        id="selectedOnly"
        size="small"
        aria-label="Show Selected Only"
        startIcon={
          checked ? <CheckBox /> : <CheckBoxOutlineBlank />
        }
        onClick={switchHandler}
        {...rootProps.slotProps?.baseButton}
      >
        {checked ? "Selected" : "All"}
      </rootProps.slots.baseButton>
      <GridToolbarColumnsButton />
      <Box sx={{flexGrow: 1}} />
      <RefreshButton />
    </GridToolbarContainer>
  );
};

export default function List() {
  const {
    activityDict,
    filterIDs,
    selected,
    setSelected,
    fullList,
    setSortModel,
    setColumnVisibilityModel,
    updateActivity,
    loadFromStrava,
  } = useStore((state) => ({
    activityDict: state.activityDict,
    filterIDs: state.filterIDs,
    selected: state.selected,
    setSelected: state.setSelected,
    fullList: state.fullList,
    setSortModel: state.setSortModel,
    setColumnVisibilityModel: state.setColumnModel,
    updateActivity: state.updateActivity,
    loadFromStrava: state.loadFromStrava,
  }));
  const rows = filterIDs
    .map((key) => activityDict[key])
    .filter((x) => x != undefined) as Activity[];

  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    id: number;
  } | null>(null);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    const id = event.currentTarget.getAttribute("data-id");
    setContextMenu(
      contextMenu === null
        ? {
            mouseX: event.clientX - 2,
            mouseY: event.clientY - 4,
            id: Number(id),
          }
        : null
    );
  };

  const handleClose = () => {
    setContextMenu(null);
  };

  const refreshActivity = (id: number) => {
    loadFromStrava({
      ids: [id],
      photos: true,
    })
      .then(() => handleClose())
      .catch(console.error);
  };

  return (
    <>
      <DataGrid
        rows={rows}
        editMode="row"
        processRowUpdate={async (updatedRow: Activity) => {
          console.log("Updating activity", updatedRow);
          const verifiedActivity = await updateActivity(
            updatedRow
          );
          return verifiedActivity;
        }}
        onProcessRowUpdateError={(error) =>
          console.error(error)
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
          row: {
            onContextMenu: handleContextMenu,
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
      <Menu
        open={contextMenu !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? {
                top: contextMenu.mouseY,
                left: contextMenu.mouseX,
              }
            : undefined
        }
        slotProps={{
          root: {
            onContextMenu: (e) => {
              e.preventDefault();
              handleClose();
            },
          },
        }}
      >
        <MenuItem
          onClick={() =>
            contextMenu?.id
              ? refreshActivity(contextMenu.id)
              : null
          }
        >
          Refresh
        </MenuItem>
      </Menu>
    </>
  );
}
