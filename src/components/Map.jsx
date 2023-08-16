import { useState, useContext, useCallback, useMemo, useEffect } from "react";

import { Paper } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { useTheme } from "@mui/material/styles";

import ReactMapGL, {
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  useControl,
  Layer,
  Source,
} from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { MapContext } from "/src/contexts/MapContext";
import { ActivityContext } from "/src/contexts/ActivityContext";
import { SelectionContext } from "/src/contexts/SelectionContext";
import { FilterContext } from "/src/contexts/FilterContext";
import { ListContext } from "/src/contexts/ListContext";

import { mapSettings, categorySettings, listSettings } from "../settings";

import { DownloadControl } from "/src/components/Controls/DownloadControl";
import { SelectionControl } from "/src/components/Controls/SelectionControl";
import { LayerSwitcher } from "/src/components/Controls/LayerSwitcher";

function Download(props) {
  useControl(() => new DownloadControl(), {
    position: props.position,
  });
  return null;
}

function Selection(props) {
  const selectionContext = useContext(SelectionContext);

  useControl(
    () =>
      new SelectionControl({
        mapRef: props.mapRef,
        layers: ["routeLayerBG", "routeLayerBGsel"],
        source: "routeSource",
        selectionHandler: (sel) => selectionContext.setSelected(sel),
      })
  );
}

function RouteLayer() {
  const filterContext = useContext(FilterContext);
  const selectionContext = useContext(SelectionContext);
  const activityContext = useContext(ActivityContext);

  console.log(
    `routeLayer render ${filterContext.filterIDs.length}/${activityContext.geoJson.features.length} rows`
  );

  const theme = useTheme();

  const color = ["match", ["get", "sport_type"]];
  Object.entries(categorySettings).forEach(([key, value]) => {
    value.alias.forEach((alias) => {
      color.push(alias, value.color);
    });
  });
  color.push("#000000");

  const filter = ["in", "id", ...filterContext.filterIDs];
  const selectedFilter = ["in", "id", ...selectionContext.selected];
  const unselectedFilter = ["!in", "id", ...selectionContext.selected];
  const filterAll = ["all", filter, unselectedFilter];
  const filterSel = ["all", filter, selectedFilter];
  const filterHigh = ["==", "id", selectionContext.highlighted];
  return (
    <Source data={activityContext.geoJson} id="routeSource" type="geojson">
      <Layer
        source="routeSource"
        id="routeLayerBG"
        type="line"
        paint={{ "line-color": "black", "line-width": 4 }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
        filter={filterAll}
      />
      <Layer
        source="routeSource"
        id="routeLayerFG"
        type="line"
        paint={{ "line-color": color, "line-width": 2 }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
        filter={filterAll}
      />
      <Layer
        source="routeSource"
        id="routeLayerBGsel"
        type="line"
        paint={{ "line-color": "black", "line-width": 6 }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
        filter={filterSel}
      />
      <Layer
        source="routeSource"
        id="routeLayerMIDsel"
        type="line"
        paint={{ "line-color": color, "line-width": 4 }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
        filter={filterSel}
      />
      <Layer
        source="routeSource"
        id="routeLayerFGsel"
        type="line"
        paint={{ "line-color": "white", "line-width": 2 }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
        filter={filterSel}
      />
      <Layer
        source="routeSource"
        id="routeLayerHigh"
        type="line"
        paint={{
          "line-color": theme.palette.primary.light,
          "line-width": 6,
          "line-opacity": 0.4,
        }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
        filter={filterHigh}
      />
    </Source>
  );
}

function Map({ mapRef }) {
  const [cursor, setCursor] = useState("auto");
  const onMouseEnter = useCallback(() => setCursor("pointer"), []);
  const onMouseLeave = useCallback(() => setCursor("auto"), []);
  const map = useContext(MapContext);
  const [viewport, setViewport] = useState(map.position);
  const activityContext = useContext(ActivityContext);
  const filterContext = useContext(FilterContext);
  const selectionContext = useContext(SelectionContext);
  const listContext = useContext(ListContext);

  const controls = useMemo(
    () => (
      <>
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-right" />
        <FullscreenControl position="top-right" />
        <Download position="top-right" context={map} />
        <Selection position="top-right" mapRef={mapRef} />
        <LayerSwitcher
          sx={{
            position: "absolute",
            top: 10,
            left: 10,
          }}
          mapRef={mapRef}
        />
      </>
    ),
    [map]
  );

  const overlayMaps = useMemo(
    () => (
      <>
        {map.overlayMaps.map((mapName) => {
          if (mapSettings[mapName].type == "custom") {
            const CustomLayer = mapSettings[mapName].component;
            return (
              <CustomLayer
                bbox={map.position.bbox}
                mapRef={mapRef}
                key="SACrouteLayer"
              />
            );
          } else
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
      </>
    ),
    [map]
  );

  const routes = useMemo(
    () => <RouteLayer />,
    [activityContext.geoJson, filterContext]
  );

  return (
    <>
      <ReactMapGL
        reuseMaps
        styleDiffing={false}
        ref={mapRef}
        boxZoom={false}
        {...viewport}
        onMove={(evt) => setViewport(evt.viewState)}
        onMoveEnd={(evt) => {
          console.log(evt);
          map.setPosition(mapRef.current.getMap().getBounds(), evt.viewState);
        }}
        projection="globe"
        mapStyle={
          mapSettings[map.baseMap].type == "vector"
            ? mapSettings[map.baseMap].url
            : undefined
        }
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
        cursor={cursor}
        terrain={{
          source: "mapbox-dem",
          exaggeration: map.threeDim ? 1.5 : 0,
        }}
        interactiveLayerIds={["routeLayerBG", "routeLayerBGsel", "SAC"]}
      >
        {mapSettings[map.baseMap].type == "raster" && (
          <Source
            type="raster"
            tiles={[mapSettings[map.baseMap].url]}
            tileSize={256}
          >
            <Layer id="baseMap" type="raster" paint={{ "raster-opacity": 1 }} />
          </Source>
        )}
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />
        {controls}
        {overlayMaps}
        {activityContext.loaded && routes}
      </ReactMapGL>
      <Paper
        elevation={3}
        sx={{
          zIndex: 2,
          position: "absolute",
          left: "40px",
          maxWidth: "800px",
          height: selectionContext.selected.length > 7 ? "210px" : "auto",
          right: "10px",
          width: "calc(100% - 50px)",
          bottom: "30px",
          margin: "auto",
          visibility:
            selectionContext.selected.length > 0 ? "visible" : "hidden",
        }}
      >
        <DataGrid
          hideFooter={true}
          sx={{
            ".MuiDataGrid-iconButtonContainer": {
              visibility:
                selectionContext.selected.length > 0
                  ? "inherit"
                  : "hidden !important",
            },
            ".MuiDataGrid-columnSeparator": {
              visibility:
                selectionContext.selected.length > 0
                  ? "inherit"
                  : "hidden !important",
            },
          }}
          rowHeight={35}
          disableColumnMenu={true}
          rows={selectionContext.selected.map(
            (key) => activityContext.activityDict[key]
          )}
          autoHeight={selectionContext.selected.length <= 7}
          initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
          columns={listSettings(activityContext).columns}
          disableColumnFilter
          density="compact"
          sortModel={listContext.compact.sortModel}
          onSortModelChange={(model) =>
            listContext.setSortModel("compact", model)
          }
          columnVisibilityModel={listContext.compact.columnVisibilityModel}
          onColumnVisibilityModelChange={(newModel) =>
            listContext.setColumnVisibilityModel("compact", newModel)
          }
          onRowClick={(row, params) => {
            console.log(row.id + " clicked");
            console.log(mapRef.current);
            selectionContext.setHighlighted(row.id);
            mapRef.current?.fitBounds(
              activityContext.activityDict[row.id].bbox,
              {
                padding: 100,
              }
            );
          }}
        />
      </Paper>
    </>
  );
}

export default Map;
