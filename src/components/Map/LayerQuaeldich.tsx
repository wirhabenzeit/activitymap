"use client";

import {
  useState,
  useEffect,
  useCallback,
  RefObject,
} from "react";

import FileSaver from "file-saver";

import {
  Layer,
  Source,
  useMap,
  type MapboxMap,
} from "react-map-gl";

import * as togeojson from "@mapbox/togeojson";

import {
  Paper,
  Typography,
  Card,
  Box,
  CardContent,
  CardActions,
  Button,
  MobileStepper,
  Chip,
  IconButton,
  Tooltip,
  ImageListItemBar,
  List,
  ListItem,
  ListItemText,
  Skeleton,
} from "@mui/material";

import proj4 from "proj4";
import GeoJsonToGpx from "@dwayneparton/geojson-to-gpx";
import {
  Hiking as HikingIcon,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  Terrain as TerrainIcon,
  Copyright as CopyrightIcon,
  Link as LinkIcon,
  Download as DownloadIcon,
} from "@mui/icons-material";
import {BBox} from "geojson";
import {useStore} from "~/contexts/Zustand";
import {type CustomLayerProps} from "~/settings/map";

export const LayerQuaeldich: React.FC<CustomLayerProps> = ({
  mapRef,
}) => {
  const [card, setCard] = useState(null);
  const [json, setJson] = useState({
    type: "FeatureCollection",
    features: [],
  });
  const [routes, setRoutes] = useState({
    type: "FeatureCollection",
    features: [],
  });

  const onClick = async (e) => {
    const bbox = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];
    const selectedFeatures = mapRef.current
      .getMap()
      .queryRenderedFeatures(bbox, {
        layers: ["quaeldichLayer"],
      });
    if (selectedFeatures.length === 0) {
      setCard(null);
      setRoutes({type: "FeatureCollection", features: []});
      return;
    }
    const id = selectedFeatures[0].properties.id;
    const url =
      "https://corsproxy.io/?" +
      encodeURIComponent(
        `https://www.quaeldich.de/common/js/lookup-passkml.php?PassID=${id}`
      );
    const response = await fetch(url);
    const data = await response.json();
    setCard({...data, ...selectedFeatures[0].properties});
    getRoutes(data.kmls);
  };

  useEffect(() => {
    mapRef.current.getMap().on("click", onClick);
  }, []);

  const getRoute = async (url, id) => {
    const response = await fetch(url);
    const data = await response.text();
    const dom = new DOMParser().parseFromString(
      data,
      "text/xml"
    );
    const geojson = togeojson.kml(dom);
    const regExp = /\(([^)]+)\)/;
    const matches = regExp.exec(
      geojson.features[0].properties.name
    );
    setCard((card) => ({
      ...card,
      kml_infos: {
        ...card.kml_infos,
        [id]: {
          ...card.kml_infos[id],
          info: matches[1],
        },
      },
    }));
    geojson.features.forEach((feature) =>
      setRoutes((routes) => ({
        ...routes,
        features: [...routes.features, feature],
      }))
    );
  };

  const getRoutes = async (kmls) => {
    setRoutes({type: "FeatureCollection", features: []});
    Object.entries(kmls).forEach(async ([id, link]) => {
      const url =
        "https://corsproxy.io/?" +
        encodeURIComponent(
          "https://www.quaeldich.de/" + link
        );
      getRoute(url, id);
    });
  };

  useEffect(() => {
    fetch(
      "https://corsproxy.io/?" +
        encodeURIComponent(
          "https://www.quaeldich.de/common/js/paesse_json_v4.php"
        )
    )
      .then((response) => response.text())
      .then((data) => {
        const points = new Function(
          data + "\n return addressPoints;"
        )();
        const features = points.map((point) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [point[1], point[0]],
          },
          properties: {
            name: point[2],
            url: point[3],
            id: point[5],
            altitude: point[4],
            up2: point[6],
          },
        }));
        setJson({type: "FeatureCollection", features});
      });
  }, []);

  return (
    <>
      <Source
        id="quaeldichSource"
        type="geojson"
        data={json}
        key="quaeldichSource"
      >
        {mapRef.current.getMap().getZoom() > 10 && (
          <Layer
            id="quaeldichLayer"
            key="quaeldichlayer"
            type="circle"
            paint={{
              "circle-radius": 5,
              "circle-color": "#ff0000",
              "circle-stroke-width": 1,
              "circle-stroke-color": "#ffffff",
            }}
          />
        )}
      </Source>
      <Source
        id="quaeldichRoutesSource"
        type="geojson"
        data={routes}
        key="quaeldichRoutesSource"
      >
        {mapRef.current.getMap().getZoom() > 10 && (
          <Layer
            id="quaeldichRoutesLayer"
            key="quaeldichRouteslayer"
            type="line"
            paint={{
              "line-color": "#ff0000",
              "line-width": 2,
            }}
          />
        )}
      </Source>
      <Paper
        elevation={3}
        sx={{
          zIndex: 2,
          position: "absolute",
          left: "10px",
          //right: "0px",
          //marginLeft: "auto",
          //marginRight: "auto",
          width: "320px",
          bottom: "10px",
          margin: "auto",
          visibility: card != null ? "visible" : "hidden",
        }}
      >
        {card != null && (
          <Card sx={{width: 320, minHeight: 300}}>
            <CardContent>
              <Typography variant="h5" component="div">
                {card.name}
              </Typography>
              <Chip
                icon={<TerrainIcon />}
                label={card.altitude + "m"}
                size="small"
                sx={{mx: 0.5}}
              />
              <List dense>
                {Object.entries(card.kml_infos).map(
                  ([key, value]) =>
                    "href" in value && (
                      <ListItem key={key}>
                        <ListItemText
                          primary={value.output}
                          secondary={
                            "info" in value
                              ? value.info
                              : ""
                          }
                        />
                      </ListItem>
                    )
                )}
              </List>
            </CardContent>
            <CardActions
              sx={{justifyContent: "center", p: 0}}
            >
              <Button
                size="small"
                href={`https://www.quaeldich.de/paesse/${card.url}`}
                target="_blank"
                startIcon={<LinkIcon />}
              >
                Quäldich
              </Button>
            </CardActions>
          </Card>
        )}
      </Paper>
    </>
  );
};
