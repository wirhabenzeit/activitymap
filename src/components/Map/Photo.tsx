import {Marker} from "react-map-gl";
import {useStore} from "~/contexts/Zustand";
import {Avatar} from "@mui/material";
import {useMemo, useState} from "react";
import {useShallow} from "zustand/shallow";

export default function PhotoLayer() {
  const {photos, position, filterIDs} = useStore(
    useShallow((state) => ({
      photos: state.photos,
      position: state.position,
      filterIDs: state.filterIDs,
    }))
  );

  const displayPhotos = useMemo(() => {
    return photos.filter((photo) => {
      if (!photo.location?.[0] || !photo.location[1])
        return false;
      return filterIDs.includes(photo.activity_id!);
    });
  }, [photos, filterIDs]);

  return (
    position.zoom > 8 && (
      <>
        {displayPhotos.map((photo) => (
          <PhotoMarker
            longitude={photo.location![1]}
            latitude={photo.location![0]}
            key={photo.unique_id}
            zoom={position.zoom}
            urls={photo.urls}
            sizes={photo.sizes}
            activity_name={photo.activity_name!}
            activity_id={photo.activity_id!}
            caption={photo.caption ?? undefined}
          />
        ))}
      </>
    )
  );
}

function PhotoMarker({
  urls,
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
  caption?: string;
  zoom: number;
}) {
  const photoUrl = Object.values(urls)[0];
  const [hover, setHover] = useState(false);

  const {setSelected} = useStore(
    useShallow((state) => ({
      setSelected: state.setSelected,
    }))
  );

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
        alt={caption ?? activity_name}
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
