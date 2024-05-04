"use client";

import {
  useState,
  useCallback,
  useMemo,
  type FC,
  type RefObject,
  createRef,
} from "react";

import {Paper} from "@mui/material";
import {DataGrid} from "@mui/x-data-grid";
import {useTheme} from "@mui/material/styles";

import ReactMapGL, {
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  useControl,
  Layer,
  Source,
  type ControlPosition,
  type MapRef,
} from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import {useStore} from "~/contexts/Zustand";

import {
  type CustomLayerProps,
  mapSettings,
} from "~/settings/map";
import {categorySettings} from "~/settings/category";
import {listSettings} from "~/settings/list";

import {DownloadControl} from "~/components/Map/DownloadControl";
import {SelectionControl} from "~/components/Map/SelectionControl";
import {LayerSwitcher} from "~/components/Map/LayerSwitcher";
import type {Activity} from "~/server/db/schema";

function Download({position}: {position: ControlPosition}) {
  useControl(() => new DownloadControl(), {position});
  return null;
}

function Selection({mapRef}: {mapRef: RefObject<MapRef>}) {
  const {setSelected} = useStore((state) => ({
    setSelected: state.setSelected,
  }));

  useControl(
    () =>
      new SelectionControl({
        mapRef: mapRef,
        layers: ["routeLayerBG", "routeLayerBGsel"],
        source: "routeSource",
        selectionHandler: (sel: number[]) => {
          setSelected(Array.from(new Set(sel)));
        },
      })
  );
  return null;
}

function RouteLayer() {
  const {filterIDs} = useStore((state) => ({
    filterIDs: state.filterIDs,
  }));
  const {selected, highlighted, geoJson} = useStore(
    (state) => ({
      selected: state.selected,
      highlighted: state.highlighted,
      geoJson: state.geoJson,
    })
  );

  const theme = useTheme();

  const color: mapboxgl.Expression = [
    "match",
    ["get", "sport_type"],
  ];
  Object.entries(categorySettings).forEach(([, value]) => {
    value.alias.forEach((alias) => {
      color.push(alias, value.color);
    });
  });
  color.push("#000000");

  const filter = ["in", "id", ...filterIDs];
  const selectedFilter = ["in", "id", ...selected];
  const unselectedFilter = ["!in", "id", ...selected];
  const filterAll = ["all", filter, unselectedFilter];
  const filterSel = ["all", filter, selectedFilter];
  const filterHigh = ["==", "id", highlighted];
  return (
    <Source data={geoJson} id="routeSource" type="geojson">
      <Layer
        source="routeSource"
        id="routeLayerBG"
        type="line"
        paint={{"line-color": "black", "line-width": 4}}
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
        paint={{"line-color": color, "line-width": 2}}
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
        paint={{"line-color": "black", "line-width": 6}}
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
        paint={{"line-color": color, "line-width": 4}}
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
        paint={{"line-color": "white", "line-width": 2}}
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

function Map() {
  const [cursor, setCursor] = useState("auto");
  const onMouseEnter = useCallback(
    () => setCursor("pointer"),
    []
  );
  const onMouseLeave = useCallback(
    () => setCursor("auto"),
    []
  );

  const {
    selected,
    setHighlighted,
    activityDict,
    compactList,
    setSortModel,
    setColumnVisibilityModel,
    baseMap,
    overlays,
    mapPosition,
    setPosition,
    updateActivity,
  } = useStore((state) => ({
    selected: state.selected,
    setHighlighted: state.setHighlighted,
    activityDict: state.activityDict,
    compactList: state.compactList,
    setSortModel: state.setSortModel,
    setColumnVisibilityModel: state.setColumnModel,
    baseMap: state.baseMap,
    overlays: state.overlayMaps,
    mapPosition: state.position,
    setPosition: state.setPosition,
    updateActivity: state.updateActivity,
  }));

  const mapRefLoc = createRef<MapRef>();

  const loaded = useStore((state) => state.loaded);
  const [viewport, setViewport] = useState(mapPosition);

  const controls = useMemo(
    () => (
      <>
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-right" />
        <FullscreenControl position="top-right" />
        <Download position="top-right" />
        <Selection mapRef={mapRefLoc} />
        <LayerSwitcher
          sx={{
            position: "absolute",
            top: 10,
            left: 10,
          }}
          mapRef={mapRefLoc}
        />
      </>
    ),
    [mapRefLoc]
  );

  const overlayMaps = useMemo(
    () => (
      <>
        {overlays.map((mapName) => {
          const mapSetting = mapSettings[mapName];
          if (mapSetting == undefined) return;
          if (mapSetting.type == "custom") {
            const CustomLayer: FC<CustomLayerProps> =
              mapSetting.component;
            return (
              <CustomLayer
                key={mapName}
                mapRef={mapRefLoc}
              />
            );
          } else
            return (
              <Source
                key={mapName + "source"}
                id={mapName}
                type="raster"
                tiles={[mapSetting.url]}
                tileSize={256}
              >
                <Layer
                  key={mapName + "layer"}
                  id={mapName}
                  type="raster"
                  paint={{
                    "raster-opacity":
                      "opacity" in mapSetting
                        ? mapSetting.opacity!
                        : 1,
                  }}
                />
              </Source>
            );
        })}
      </>
    ),
    [overlays, mapRefLoc]
  );

  const mapSettingBase = mapSettings[baseMap]!;

  return (
    <>
      <ReactMapGL
        reuseMaps
        ref={mapRefLoc}
        styleDiffing={false}
        boxZoom={false}
        {...viewport}
        onMove={({viewState}) => setViewport(viewState)}
        onMoveEnd={({viewState}) => {
          if (mapRefLoc.current) {
            setPosition(
              viewState,
              mapRefLoc.current.getMap().getBounds()
            );
          }
        }}
        projection={{name: "mercator"}}
        mapStyle={
          mapSettingBase.type === "vector"
            ? mapSettingBase.url
            : undefined
        }
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        mapboxAccessToken={
          process.env.NEXT_PUBLIC_MAPBOX_TOKEN
        }
        cursor={cursor}
        interactiveLayerIds={[
          "routeLayerBG",
          "routeLayerBGsel",
          "SAC",
        ]}
      >
        {mapSettingBase != undefined &&
          mapSettingBase.type == "raster" && (
            <Source
              type="raster"
              tiles={[mapSettingBase.url]}
              tileSize={256}
            >
              <Layer
                id="baseMap"
                type="raster"
                paint={{"raster-opacity": 1}}
              />
            </Source>
          )}
        {controls}
        {overlayMaps}
        {loaded && <RouteLayer />}
      </ReactMapGL>
      <Paper
        elevation={3}
        sx={{
          zIndex: 2,
          position: "absolute",
          left: "40px",
          maxWidth: "800px",
          height: selected.length > 7 ? "210px" : "auto",
          right: "10px",
          width: "calc(100% - 50px)",
          bottom: "30px",
          margin: "auto",
          visibility:
            selected.length > 0 ? "visible" : "hidden",
        }}
      >
        <DataGrid
          hideFooter={true}
          sx={{
            ".MuiDataGrid-iconButtonContainer": {
              visibility:
                selected.length > 0
                  ? "inherit"
                  : "hidden !important",
            },
            ".MuiDataGrid-columnSeparator": {
              visibility:
                selected.length > 0
                  ? "inherit"
                  : "hidden !important",
            },
          }}
          editMode="row"
          processRowUpdate={async (
            updatedRow: Activity
          ) => {
            const verifiedActivity = await updateActivity({
              ...updatedRow,
              name: updateActivity.name.name,
            });
            console.log(
              "Returning activity",
              verifiedActivity
            );
            return verifiedActivity;
          }}
          onProcessRowUpdateError={(error) =>
            console.error(error)
          }
          rowHeight={35}
          disableColumnMenu={true}
          rows={selected.map((key) => activityDict[key])}
          autoHeight={selected.length <= 7}
          initialState={{
            pagination: {paginationModel: {pageSize: 100}},
          }}
          columns={listSettings.columns}
          disableColumnFilter
          density="compact"
          sortModel={compactList.sortModel}
          onSortModelChange={(model) =>
            setSortModel("compact", model)
          }
          columnVisibilityModel={
            compactList.columnVisibilityModel
          }
          onColumnVisibilityModelChange={(newModel) =>
            setColumnVisibilityModel("compact", newModel)
          }
          onRowClick={(row) => {
            const id = row.id as number;
            setHighlighted(id);
            const map = activityDict[id]?.map;
            if (!map) return;
            mapRefLoc.current?.fitBounds(map.bbox, {
              padding: 100,
            });
          }}
        />
      </Paper>
    </>
  );
}

export default Map;
