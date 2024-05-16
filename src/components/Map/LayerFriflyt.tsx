"use client";

import {useState, useEffect, type FC} from "react";
import {Layer, Source} from "react-map-gl";
import FileSaver from "file-saver";
import * as d3 from "d3";
import shp from "shpjs";

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
  ImageListItemBar,
} from "@mui/material";

import GeoJsonToGpx from "@dwayneparton/geojson-to-gpx";
import {
  Grid3x3 as HashIcon,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  Straighten as DistanceIcon,
  Link as LinkIcon,
  Download as DownloadIcon,
} from "@mui/icons-material";
import {useStore} from "~/contexts/Zustand";
import {type CustomLayerProps} from "~/settings/map";

export const LayerFriflyt: React.FC<CustomLayerProps> = ({
  mapRef,
}) => {
  const {bbox} = useStore((state) => ({
    bbox: state.bbox,
  }));
  const [cards, setCards] = useState([]);
  const [activeStep, setActiveStep] = useState(0);
  const [selection, setSelection] = useState([]);
  const [json, setJson] = useState({
    type: "FeatureCollection",
    features: [],
  });
  const [collections, setCollections] = useState({});

  const onClick = (e) => {
    const bbox = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];
    const selectedFeatures = mapRef.current
      .getMap()
      .queryRenderedFeatures(bbox, {
        layers: ["Friflyt"],
      });

    setSelection(selectedFeatures);
    setActiveStep(0);
    setCards(
      selectedFeatures.map((x) => {
        const link =
          "link" in x.properties
            ? JSON.parse(x.properties.link)
            : {};
        const properties = {
          ...x.properties,
          title: undefined,
          shortTitle: undefined,
          ...link,
          id: x.properties.id,
        };
        return properties;
      })
    );
  };

  useEffect(() => {
    mapRef.current.getMap().on("click", onClick);

    return () => {
      mapRef.current.getMap().off("click", onClick);
    };
  }, []);

  useEffect(() => {
    setJson({
      type: "FeatureCollection",
      features: Object.values(collections).flat(),
    });
  }, [collections]);

  async function fetchGeoJSON() {
    const response = await fetch(
      "https://corsproxy.io/?" +
        encodeURIComponent(
          `https://api.friflyt.no/api/v4/mapdata?zoom=${mapRef.current
            .getMap()
            .getZoom()
            .toFixed(0)}&offset=0&limit=500&latBottom=${
            bbox._sw.lat
          }&latTop=${bbox._ne.lat}&lngLeft=${
            bbox._sw.lng
          }&lngRight=${bbox._ne.lng}`
        )
    );
    const json = await response.json();

    for (const entry of json.source) {
      if (entry.kategori == "Ski" && "asset" in entry) {
        if (entry.title in collections) continue;

        const response = await fetch(entry.asset);
        const arrayBuffer = await response.arrayBuffer();
        const shpfile = await shp(arrayBuffer);

        const featureMap = new d3.InternMap(
          entry.properties.map((x) => [
            parseInt(x.featureId),
            x,
          ])
        );

        const features = shpfile.features.map(
          (feature, id) => ({
            ...feature,
            properties: {
              ...feature.properties,
              ...featureMap.get(id + 1),
              id: id + 1,
              collection: entry.title,
              uniqueId: entry.title + "_" + (id + 1),
            },
          })
        );

        setCollections((collections) => ({
          ...collections,
          [entry.title]: features,
        }));
      }
    }
  }

  useEffect(() => {
    const bboxArea =
      (bbox._ne.lat - bbox._sw.lat) *
      (bbox._ne.lng - bbox._sw.lng);
    if (
      bboxArea < 0.02 ||
      mapRef.current.getMap().getZoom() > 6
    )
      fetchGeoJSON();
    else setJson({type: "FeatureCollection", features: []});
  }, [bbox]);

  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  return (
    <>
      <Source
        id="Friflyt"
        type="geojson"
        data={json}
        key="Friflytsource"
      >
        <Layer
          id="Friflyt"
          key="Friflytlayer"
          type="line"
          layout={{
            "line-cap": "round",
            "line-join": "round",
          }}
          paint={{
            "line-width": 4,
            "line-opacity": 0.3,
          }}
        />
        {cards.length > 0 && cards[activeStep] && (
          <Layer
            id="Friflytsel"
            key="Friflytsellayer"
            type="line"
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
            paint={{
              "line-color": "red",
              "line-width": 4,
              "line-opacity": 1,
            }}
            filter={[
              "in",
              "uniqueId",
              cards[activeStep].uniqueId,
            ]}
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
          visibility:
            cards.length > 0 ? "visible" : "hidden",
        }}
      >
        {cards.length > 0 && (
          <>
            <Card sx={{width: 320}}>
              {"image" in cards[activeStep] && (
                <div
                  style={{
                    position: "relative",
                    width: 320,
                    height: 200,
                  }}
                >
                  <Box
                    component="img"
                    src={cards[activeStep].image.url}
                    alt={cards[activeStep].image.alt}
                    sx={{
                      m: 0,
                      p: 0,
                      objectFit: "cover",
                      width: 320,
                      height: 200,
                    }}
                  />
                  <ImageListItemBar
                    subtitle={
                      <Typography
                        sx={{whiteSpace: "normal"}}
                        variant="caption"
                      >
                        {cards[activeStep].image.alt}
                      </Typography>
                    }
                  />
                </div>
              )}
              <CardContent>
                <Typography variant="h5" component="div">
                  {cards[activeStep]?.title != undefined &&
                    cards[activeStep].title}
                  {cards[activeStep] &&
                    cards[activeStep].title == undefined &&
                    "Unnamed Tour"}
                </Typography>
                {cards[activeStep] && (
                  <>
                    <Chip
                      icon={<DistanceIcon />}
                      label={
                        (
                          cards[activeStep].SHAPE_Leng /
                          1000
                        ).toFixed(1) + "km"
                      }
                      size="small"
                      sx={{mx: 0.5, px: 0.5}}
                    />
                    <Chip
                      icon={<HashIcon />}
                      label={
                        cards[activeStep].collection +
                        ("TURNUMMER" in cards[activeStep]
                          ? cards[activeStep].TURNUMMER
                          : cards[activeStep].TURNR)
                      }
                      size="small"
                      sx={{mx: 0.5}}
                    />
                  </>
                )}
                {cards[activeStep]?.shortTitle != undefined && (
                    <Typography
                      variant="body2"
                      component="div"
                      color="text.secondary"
                      sx={{mt: 0.5}}
                    >
                      {cards[activeStep].shortTitle}
                    </Typography>
                  )}
              </CardContent>
              <CardActions
                sx={{justifyContent: "center", p: 0}}
              >
                {cards[activeStep] && (
                  <>
                    {"canonical" in cards[activeStep] && (
                      <Button
                        size="small"
                        href={cards[activeStep].canonical}
                        target="_blank"
                        startIcon={<LinkIcon />}
                      >
                        Friflyt
                      </Button>
                    )}
                    <Button
                      size="small"
                      target="_blank"
                      startIcon={<DownloadIcon />}
                      onClick={() => {
                        const features =
                          json.features.filter(
                            (feature) =>
                              feature.properties
                                .uniqueId ===
                              cards[activeStep].uniqueId
                          );
                        const options = {
                          metadata: {
                            name: cards[activeStep].title,
                            author: {
                              name: "Friflyt",
                              link: {
                                href: cards[activeStep]
                                  .canonical,
                              },
                            },
                          },
                        };
                        const gpx = GeoJsonToGpx(
                          {
                            type: "FeatureCollection",
                            features,
                          },
                          options
                        );
                        const gpxString =
                          new XMLSerializer().serializeToString(
                            gpx
                          );
                        const file = new File(
                          [gpxString],
                          `${cards[activeStep].title}.gpx`,
                          {
                            type: "text/xml;charset=utf-8",
                          }
                        );
                        FileSaver.saveAs(file);
                      }}
                    >
                      GPX
                    </Button>
                  </>
                )}
              </CardActions>
            </Card>
            {cards.length > 1 && (
              <MobileStepper
                variant="dots"
                steps={cards.length}
                position="static"
                activeStep={activeStep}
                sx={{maxWidth: 400, flexGrow: 1}}
                nextButton={
                  <Button
                    size="small"
                    onClick={handleNext}
                    disabled={
                      activeStep === cards.length - 1
                    }
                  >
                    Next <KeyboardArrowRight />
                  </Button>
                }
                backButton={
                  <Button
                    size="small"
                    onClick={handleBack}
                    disabled={activeStep === 0}
                  >
                    <KeyboardArrowLeft /> Back
                  </Button>
                }
              />
            )}
          </>
        )}
      </Paper>
    </>
  );
};
