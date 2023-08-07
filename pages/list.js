import * as React from "react";
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import {
  DataGrid,
  GridToolbarContainer,
  useGridApiContext,
  GridToolbarColumnsButton,
  GridToolbarDensitySelector,
  GridToolbarExport,
  GridFooterContainer,
} from "@mui/x-data-grid";
import Head from "next/head";
import { listSettings } from "@/settings";
import { ActivityContext } from "@/ActivityContext";
import { FilterContext } from "@/FilterContext";
import { ListContext } from "@/ListContext";
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
      Load More
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
      <LoadMoreButton />
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
    if (!activeCat.includes(data.properties.sport_type)) return false;
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
    <>
      <Head>
        <title>StravaMap - Activity List</title>
      </Head>
      <DataGrid
        rows={activityContext.geoJson.features.filter(customFilter)}
        columns={listSettings.columns}
        disableColumnMenu
        pageSizeOptions={[100]}
        density="compact"
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
    </>
  );
}
