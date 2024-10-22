"use client";

import {
  useState,
  useCallback,
  useMemo,
  type FC,
  createRef,
} from "react";

import {IconButton, Paper} from "@mui/material";
import {DataGrid} from "@mui/x-data-grid";
import {useTheme} from "@mui/material/styles";

import ReactMapGL, {
  NavigationControl,
  GeolocateControl,
  FullscreenControl,
  Layer,
  Source,
  type MapRef,
  type SkyLayer,
} from "react-map-gl";

const skyLayer: SkyLayer = {
  id: "sky",
  type: "sky",
  paint: {
    "sky-type": "atmosphere",
    "sky-atmosphere-sun": [0.0, 0.0],
    "sky-atmosphere-sun-intensity": 15,
  },
};
import {useShallow} from "zustand/shallow";

import Overlay from "~/components/Map/Overlay";

import "mapbox-gl/dist/mapbox-gl.css";

import {useStore} from "~/contexts/Zustand";

import {
  type CustomLayerProps,
  mapSettings,
} from "~/settings/map";
import {categorySettings} from "~/settings/category";
import {listSettings} from "~/settings/list";

import {Download} from "~/components/Map/DownloadControl";
import {Selection} from "~/components/Map/SelectionControl";
import {LayerSwitcher} from "~/components/Map/LayerSwitcher";
import type {Activity} from "~/server/db/schema";
import PhotoLayer from "~/components/Map/Photo";
import {CameraAlt} from "@mui/icons-material";
import {type MapboxEvent} from "mapbox-gl";
import type mapboxgl from "mapbox-gl";

function RouteLayer() {
  const {filterIDs} = useStore(
    useShallow((state) => ({
      filterIDs: state.filterIDs,
    }))
  );
  const {selected, highlighted, geoJson} = useStore(
    useShallow((state) => ({
      selected: state.selected,
      highlighted: state.highlighted,
      geoJson: state.geoJson,
    }))
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
    threeDim,
    showPhotos,
    togglePhotos,
  } = useStore(
    useShallow((state) => ({
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
      threeDim: state.threeDim,
      showPhotos: state.showPhotos,
      togglePhotos: state.togglePhotos,
    }))
  );

  const mapRefLoc = createRef<MapRef>();

  const loaded = useStore(
    useShallow((state) => state.loaded)
  );
  const [viewport, setViewport] = useState(mapPosition);

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
  const rows = selected
    .map((key) => activityDict[key])
    .filter((x) => x != undefined);

  return (
    <>
      <ReactMapGL
        reuseMaps={true}
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
        //optimizeForTerrain={true}
        //onLoad={(event: MapboxEvent) => console.log(event)}
        projection={
          "globe" as unknown as mapboxgl.Projection
        }
        mapStyle={
          mapSettingBase.type === "vector"
            ? mapSettingBase.url
            : undefined
        }
        terrain={{
          source: "mapbox-dem",
          exaggeration: threeDim ? 1.5 : 0,
        }}
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
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />
        <Layer {...skyLayer} />
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-right" />
        <FullscreenControl position="top-right" />
        <Overlay position="top-right">
          <Download />
        </Overlay>
        <Selection />
        <Overlay position="top-left">
          <LayerSwitcher />
        </Overlay>
        <Overlay position="top-left">
          <Paper
            sx={{
              p: 0,
              width: "29px",
              borderRadius: 1,
            }}
            elevation={1}
          >
            <IconButton onClick={togglePhotos}>
              <CameraAlt
                fontSize="small"
                sx={{mt: "2px"}}
                color={showPhotos ? "primary" : "inherit"}
              />
            </IconButton>
          </Paper>
        </Overlay>
        {overlayMaps}
        {loaded && <RouteLayer />}
        {loaded && showPhotos && <PhotoLayer />}
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
          display: selected.length > 0 ? "block" : "none",
          //visibility:
          //  selected.length > 0 ? "visible" : "hidden",
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
            console.log("Updating activity", updatedRow);
            const verifiedActivity =
              await updateActivity(updatedRow);
            return verifiedActivity;
          }}
          onProcessRowUpdateError={(error) =>
            console.error(error)
          }
          rowHeight={35}
          disableColumnMenu={false}
          rows={rows}
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
