import {Marker, useMap} from "react-map-gl";
import {useStore} from "~/contexts/Zustand";
import {Avatar} from "@mui/material";
import {useMemo, useState} from "react";

import * as d3 from "d3-hexbin";
import {z} from "zod";
import {
  Circle,
  PhotoCameraRounded,
} from "@mui/icons-material";

export default function PhotoLayer() {
  const {photos, bbox, position} = useStore((state) => ({
    photos: state.photos,
    bbox: state.bbox,
    position: state.position,
  }));
  if (!bbox) return null;

  const displayPhotos = useMemo(() => {
    const width = bbox.getEast() - bbox.getWest();
    const height = bbox.getNorth() - bbox.getSouth();

    /*const hexbin = d3
      .hexbin()
      .radius(Math.min(width, height) / 5)
      .x((d) => d.location[1])
      .y((d) => d.location[0])
      .extent([
        [bbox.getWest(), bbox.getSouth()],
        [bbox.getEast(), bbox.getNorth()],
      ]);

    console.log(
      bbox.getEast() - bbox.getWest(),
      bbox.getNorth() - bbox.getSouth(),
      position.zoom
    );*/

    return photos.filter((photo) => {
      if (!photo.location) return false;
      return bbox.contains([
        photo.location[1],
        photo.location[0],
      ]);
    });

    /*const selectedPhotos = hexbin(photosInBounds).map(
      (photos) => photos[0]
    );*/
  }, [photos, bbox]);

  return (
    position.zoom > 8 && (
      <>
        {displayPhotos.map((photo) => (
          <PhotoMarker
            longitude={photo.location[1]}
            latitude={photo.location[0]}
            urls={photo.urls}
            sizes={photo.sizes}
            activity_id={photo.activity_id}
            activity_name={photo.activity_name}
            key={photo.unique_id}
            caption={photo.caption}
            zoom={position.zoom}
          />
        ))}
      </>
    )
  );
}

function PhotoMarker({
  urls,
  sizes,
  longitude,
  latitude,
  activity_name,
  activity_id,
  caption,
  zoom,
}: {
  urls: Record<number, string>;
  sizes: Record<number, [number, number]>;
  longitude: number;
  latitude: number;
  activity_name: string;
  activity_id: number;
  caption: string;
  zoom: number;
}) {
  const photoUrl = Object.values(urls)[0];
  const [hover, setHover] = useState(false);

  const {setSelected} = useStore((state) => ({
    setSelected: state.setSelected,
  }));

  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      anchor="center"
      style={{zIndex: hover ? 3 : 2, cursor: "pointer"}}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        setSelected([activity_id]);
      }}
    >
      <Avatar
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        alt={caption || activity_name}
        src={photoUrl}
        sx={{
          width: `${Math.min(80, Math.pow(2, zoom - 5))}px`,
          height: `${Math.min(
            80,
            Math.pow(2, zoom - 5)
          )}px`,
          //transform: "translate(0, 50%)",
          border: "2px solid white",
          "&:hover": {
            width: "100px",
            height: "100px",
          },
          transition: "all 0.2s",
        }}
      ></Avatar>
    </Marker>
  );
}
