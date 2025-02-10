'use client';

import React, { useState, useEffect, useCallback, RefObject } from 'react';

import FileSaver from 'file-saver';

import { Layer, MapRef, Source } from 'react-map-gl';

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
  Skeleton,
} from '@mui/material';

import proj4 from 'proj4';
import GeoJsonToGpx from '@dwayneparton/geojson-to-gpx';
import {
  Hiking as HikingIcon,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  Terrain as TerrainIcon,
  Copyright as CopyrightIcon,
  Link as LinkIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { type CustomLayerProps } from '~/settings/map';
import { useShallowStore } from '~/store';

const epsgCH =
  '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs';

const lineColor = [
  'match',
  ['get', 'type'],
  'mountain_hiking',
  'red',
  'alpine_tour',
  'purple',
  'snowshoe_tour',
  'blue',
  'ski_tour',
  'blue',
  'black',
];

const lineDashArray = [
  'match',
  ['get', 'style'],
  'dashed',
  ['literal', [2, 4]],
  'dotted',
  ['literal', [0, 2]],
  ['literal', [1, 0]],
];

export const LayerSAC: React.FC<CustomLayerProps> = ({ mapRef }) => {
  const { bbox } = useShallowStore((state) => ({
    bbox: state.bbox,
  }));
  const [cards, setCards] = useState([]);
  const [selection, setSelection] = useState([]);
  const [json, setJson] = useState({
    type: 'FeatureCollection',
    features: [],
  });
  const [activeStep, setActiveStep] = useState(0);
  const [activePhoto, setActivePhoto] = useState(0);

  const onClick = (e) => {
    const bbox = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];
    const selectedFeatures = mapRef.current
      .getMap()
      .queryRenderedFeatures(bbox, {
        layers: ['SAC'],
      });
    setSelection(selectedFeatures);
    console.log('SAC route selection', selectedFeatures);
  };

  console.log('LayerSAC render', bbox);

  useEffect(() => {
    console.log('Register click handler');
    mapRef.current.getMap().on('click', onClick);
  }, []);

  async function fetchGeoJSON() {
    const bboxCH = [
      ...proj4('EPSG:4326', epsgCH, [bbox._sw.lng, bbox._sw.lat]),
      ...proj4('EPSG:4326', epsgCH, [bbox._ne.lng, bbox._ne.lat]),
    ]
      .map((coord) => coord.toFixed(0))
      .join(',');
    const response = await fetch(
      `https://www.suissealpine.sac-cas.ch/api/1/route/layer?bbox=${bboxCH}`,
    );
    const geojson = await response.json();
    geojson.features = geojson.features.filter(
      (feature) => feature.geometry.type === 'LineString',
    );
    geojson.features = geojson.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: feature.geometry.coordinates.map((coord) =>
          proj4(epsgCH, 'EPSG:4326', coord),
        ),
      },
    }));
    console.log('Fetched ' + geojson.features.length + ' SAC routes');
    setJson(geojson);
  }

  useEffect(() => {
    const bboxArea =
      (bbox._ne.lat - bbox._sw.lat) * (bbox._ne.lng - bbox._sw.lng);
    console.log(bboxArea, mapRef.current.getMap().getZoom());
    if (bboxArea < 0.02 || mapRef.current.getMap().getZoom() > 12.5)
      fetchGeoJSON();
    else setJson({ type: 'FeatureCollection', features: [] });
  }, [bbox]);

  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
    setActivePhoto(0);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
    setActivePhoto(0);
  };

  async function fetchCards() {
    setCards(selection.map((feature) => undefined));
    setActiveStep(0);
    setActivePhoto(0);
    const responses = await Promise.all(
      selection.map((feature, id) =>
        fetchCard(id, feature.properties.route_id),
      ),
    );
  }

  useEffect(() => {
    console.log(cards);
  }, [cards]);

  async function fetchCard(id, route_id) {
    const url =
      'https://corsproxy.io/?' +
      encodeURIComponent(
        `https://www.sac-cas.ch/en/?type=1567765346410&tx_usersaccas2020_sac2020[routeId]=${route_id}&output_lang=en`,
      );
    const response = await fetch(url);
    const data = await response.json();
    console.log(data);
    setCards((cards) => cards.map((v, i) => (i === id ? data : v)));
    return data;
  }

  useEffect(() => {
    fetchCards();
  }, [selection]);

  return (
    <>
      <Source id="SAC" type="geojson" data={json} key="SACsource">
        <Layer
          id="SAC"
          key="SAClayer"
          type="line"
          layout={{
            'line-cap': 'round',
            'line-join': 'round',
          }}
          paint={{
            'line-color': lineColor,
            'line-width': 4,
            'line-opacity': 0.3,
            'line-dasharray': lineDashArray,
          }}
        />
        {cards.length > 0 && cards[activeStep] && (
          <Layer
            id="SACsel"
            key="SACsel"
            type="line"
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
            paint={{
              'line-color': lineColor,
              'line-width': 4,
              'line-opacity': 1,
              'line-dasharray': lineDashArray,
            }}
            filter={['in', 'route_id', cards[activeStep].id]}
          />
        )}
      </Source>
      <Paper
        elevation={3}
        sx={{
          zIndex: 2,
          position: 'absolute',
          left: '10px',
          //right: "0px",
          //marginLeft: "auto",
          //marginRight: "auto",
          width: '320px',
          bottom: '10px',
          margin: 'auto',
          visibility: cards.length > 0 ? 'visible' : 'hidden',
        }}
      >
        {cards.length > 0 && (
          <>
            <Card sx={{ width: 320, minHeight: 300 }}>
              {cards[activeStep] === undefined && (
                <Skeleton variant="rectangular" width={320} height={200} />
              )}
              {cards[activeStep] && cards[activeStep].photos.length > 0 && (
                <div
                  style={{
                    position: 'relative',
                    width: 320,
                    height: 200,
                  }}
                >
                  <Box
                    component="img"
                    src={
                      cards[activeStep].photos[activePhoto].photo.thumbnails[
                        '320x200'
                      ]
                    }
                    alt={cards[activeStep].photos[activePhoto].caption}
                    sx={{
                      m: 0,
                      p: 0,
                      objectFit: 'cover',
                      width: 320,
                      height: 200,
                    }}
                  />
                  <ImageListItemBar
                    subtitle={
                      <Typography
                        sx={{ whiteSpace: 'normal' }}
                        variant="caption"
                      >
                        {cards[activeStep].photos[activePhoto].caption}
                      </Typography>
                    }
                    actionIcon={
                      <Tooltip
                        title={
                          cards[activeStep].photos[activePhoto].photo.copyright
                        }
                        placement="top"
                      >
                        <CopyrightIcon
                          sx={{
                            mt: 0.5,
                            mr: 0.5,
                            color: 'white',
                          }}
                          fontSize="small"
                        />
                      </Tooltip>
                    }
                  />
                  <IconButton
                    sx={{
                      position: 'absolute',
                      top: '100px',
                      left: 0,
                      transform: 'translateY(-50%)',
                      color: 'white',
                    }}
                    disabled={activePhoto === 0}
                    onClick={() => setActivePhoto(activePhoto - 1)}
                  >
                    <KeyboardArrowLeft />
                  </IconButton>
                  <IconButton
                    sx={{
                      position: 'absolute',
                      top: '100px',
                      right: 0,
                      transform: 'translateY(-50%)',
                      color: 'white',
                    }}
                    disabled={
                      activePhoto === cards[activeStep].photos.length - 1
                    }
                    onClick={() => setActivePhoto(activePhoto + 1)}
                  >
                    <KeyboardArrowRight />
                  </IconButton>
                </div>
              )}
              <CardContent>
                {cards[activeStep] === undefined && (
                  <Skeleton variant="text" sx={{ fontSize: '2rem' }} />
                )}
                {cards[activeStep] && (
                  <Typography variant="h5" component="div">
                    {cards[activeStep].destination_poi.display_name}
                  </Typography>
                )}
                {cards[activeStep] && (
                  <>
                    <Chip
                      icon={<TerrainIcon />}
                      label={cards[activeStep].destination_poi.altitude + 'm'}
                      size="small"
                      sx={{ mx: 0.5 }}
                    />
                    <Chip
                      icon={<HikingIcon />}
                      label={cards[activeStep].main_difficulty}
                      size="small"
                      sx={{ mx: 0.5 }}
                    />
                  </>
                )}
                {cards[activeStep] === undefined && <Skeleton variant="text" />}
                {cards[activeStep] && (
                  <Typography
                    variant="body2"
                    component="div"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    {cards[activeStep].title}
                  </Typography>
                )}
              </CardContent>
              <CardActions sx={{ justifyContent: 'center', p: 0 }}>
                {cards[activeStep] === undefined && (
                  <Skeleton variant="rounded" width={200} height={10} />
                )}
                {cards[activeStep] && (
                  <>
                    <Button
                      size="small"
                      href={`https://www.sac-cas.ch/en/huts-and-tours/sac-route-portal/${cards[activeStep].destination_poi_id}/${cards[activeStep].type}/${cards[activeStep].id}`}
                      target="_blank"
                      startIcon={<LinkIcon />}
                    >
                      SAC
                    </Button>
                    <Button
                      size="small"
                      target="_blank"
                      startIcon={<DownloadIcon />}
                      onClick={() => {
                        const features = json.features.filter(
                          (feature) =>
                            feature.properties.route_id ===
                            cards[activeStep].id,
                        );
                        console.log(features);
                        const options = {
                          metadata: {
                            name: `${cards[activeStep].destination_poi.display_name}: ${cards[activeStep].title}`,
                            author: {
                              name: 'SAC Route Portal',
                              link: {
                                href: `https://www.sac-cas.ch/en/huts-and-tours/sac-route-portal/${cards[activeStep].destination_poi_id}/${cards[activeStep].type}/${cards[activeStep].id}`,
                              },
                            },
                          },
                        };
                        const gpx = GeoJsonToGpx(
                          {
                            type: 'FeatureCollection',
                            features,
                          },
                          options,
                        );
                        console.log(gpx);
                        const gpxString = new XMLSerializer().serializeToString(
                          gpx,
                        );
                        console.log(gpxString);
                        const file = new File([gpxString], 'test.gpx', {
                          type: 'text/xml;charset=utf-8',
                        });
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
                sx={{ maxWidth: 400, flexGrow: 1 }}
                nextButton={
                  <Button
                    size="small"
                    onClick={handleNext}
                    disabled={activeStep === cards.length - 1}
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
