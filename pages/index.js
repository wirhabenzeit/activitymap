import React, { Component, useState, useCallback } from "react";
import ReactMapGL, {
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  useControl,
  Layer,
  Source,
} from "react-map-gl";
import { MapContext } from "@/MapContext";
import "mapbox-gl/dist/mapbox-gl.css";
import { mapSettings } from "@/settings";
import { LayerSwitcherControl } from "@/components/Controls/LayerSwitcherControl";
import { DownloadControl } from "@/components/Controls/DownloadControl";
import { ActivityContext } from "@/ActivityContext";
import { FilterContext } from "@/FilterContext";
import { ListContext } from "@/ListContext";
import { categorySettings } from "@/settings";
import { listSettings } from "@/settings";
import { Paper } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";

function LayerSwitcher(props) {
  useControl(() => new LayerSwitcherControl(props.context), {
    position: props.position,
  });
  return null;
}

function Download(props) {
  useControl(() => new DownloadControl(props.context), {
    position: props.position,
  });
  return null;
}

function RouteSource(props) {
  return (
    <Source data={props.data.geoJson} id="routeSource" type="geojson">
      {props.children}
    </Source>
  );
}

function RouteLayer(props) {
  const color = ["match", ["get", "type"]];
  Object.entries(categorySettings).forEach(([key, value]) => {
    value.alias.forEach((alias) => {
      color.push(alias, value.color);
    });
  });
  color.push("#000000");
  const categoryFilter = [
    "in",
    "type",
    ...Object.values(props.filter.categories)
      .map((category) => category.filter)
      .flat(),
  ];
  const valueFilter = ["all"];
  Object.entries(props.filter.values).forEach(([key, value]) => {
    if (value[0] !== undefined) {
      valueFilter.push([">=", key, value[0]]);
      valueFilter.push(["<=", key, value[1]]);
    }
  });
  const selectedFilter = ["in", "id", ...props.filter.selected];
  const unselectedFilter = ["!in", "id", ...props.filter.selected];
  const filterAll = ["all", categoryFilter, valueFilter, unselectedFilter];
  const filterSel = ["all", categoryFilter, valueFilter, selectedFilter];
  return (
    <>
      <Layer
        source="routeSource"
        id="routeLayerBG"
        type="line"
        paint={{ "line-color": "black", "line-width": 4 }}
        filter={filterAll}
      >
        {props.children}
      </Layer>
      <Layer
        source="routeSource"
        id="routeLayerFG"
        type="line"
        paint={{ "line-color": color, "line-width": 2 }}
        filter={filterAll}
      >
        {props.children}
      </Layer>
      <Layer
        source="routeSource"
        id="routeLayerBGsel"
        type="line"
        paint={{ "line-color": color, "line-width": 4 }}
        filter={filterSel}
      >
        {props.children}
      </Layer>
      <Layer
        source="routeSource"
        id="routeLayerFGsel"
        type="line"
        paint={{ "line-color": "white", "line-width": 2 }}
        filter={filterSel}
      >
        {props.children}
      </Layer>
    </>
  );
}

function Map() {
  const [cursor, setCursor] = useState("auto");
  const onMouseEnter = useCallback(() => setCursor("pointer"), []);
  const onMouseLeave = useCallback(() => setCursor("auto"), []);
  const map = React.useContext(MapContext);
  const filter = React.useContext(FilterContext);
  const activities = React.useContext(ActivityContext);
  const listState = React.useContext(ListContext);

  return (
    <>
      <ReactMapGL
        projection="globe"
        {...map.position}
        onMove={(evt) => map.updateMapPosition(evt.viewState)}
        mapStyle={mapSettings[map.baseMap].url}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        cursor={cursor}
        interactiveLayerIds={["routeLayerBG", "routeLayerBGsel"]}
        onClick={(evt) =>
          filter.setSelected(evt.features.map((feature) => feature.id))
        }
      >
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-right" />
        <FullscreenControl position="top-right" />
        <Download position="top-right" context={map} />
        <LayerSwitcher position="top-left" context={map} />
        {map.overlayMaps.map((mapName) => {
          return (
            <Source
              key={mapName + "source"}
              id={mapName}
              type="raster"
              tiles={[mapSettings[mapName].url]}
              tileSize={256}
            >
              <Layer
                key={mapName + "layer"}
                id={mapName}
                type="raster"
                paint={{ "raster-opacity": mapSettings[mapName].opacity }}
              />
            </Source>
          );
        })}

        <RouteSource data={activities}>
          <RouteLayer filter={filter} />
        </RouteSource>
      </ReactMapGL>
      <Paper
        elevation={3}
        sx={{
          zIndex: 2,
          position: "absolute",
          left: "0px",
          right: "0px",
          bottom: "30px",
          width: 0.8,
          margin: "auto",
          alignContent: "center",
          display: filter.selected.length > 0 ? "block" : "none",
        }}
      >
        <DataGrid
          rows={activities.geoJson.features.filter((data) =>
            filter.selected.includes(data.id)
          )}
          autoHeight={true}
          disableRowSelectionOnClick
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          pageSizeOptions={[10, 50, 100]}
          columns={listSettings.columns}
          disableColumnFilter
          density="compact"
          sortModel={listState.compact.sortModel}
          onSortModelChange={(model) =>
            listState.setSortModel("compact", model)
          }
          columnVisibilityModel={listState.compact.columnVisibilityModel}
          onColumnVisibilityModelChange={(newModel) =>
            listState.setColumnVisibilityModel("compact", newModel)
          }
        />
      </Paper>
    </>
  );
}

export default Map;
