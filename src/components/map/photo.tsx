import { Marker } from 'react-map-gl/mapbox';
import { useShallowStore } from '~/store';
import { Avatar, AvatarImage } from '../ui/avatar';
import { useMemo, useState } from 'react';

import { usePhotos } from '~/hooks/use-photos';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';

export default function PhotoLayer() {
  const { position } = useShallowStore((state) => ({
    position: state.position,
  }));

  const { data: photos = [] } = usePhotos();
  const { filterIDs } = useFilteredActivities();

  const displayPhotos = useMemo(() => {
    return photos.filter((photo) => {
      if (!photo.location?.[0] || !photo.location[1]) return false;
      return filterIDs.includes(photo.activity_id);
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
            urls={photo.urls ?? {}}
            sizes={photo.sizes ?? {}}
            activity_name={photo.activity_name!}
            activity_id={photo.activity_id}
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
}: {
  urls: Record<number, string>;
  sizes: Record<number, [number, number]>;
  longitude?: number;
  latitude?: number;
  activity_name: string;
  activity_id: number;
  caption?: string;
}) {
  const photoUrl = Object.values(urls)[0];
  const [hover, setHover] = useState(false);

  const { setSelected } = useShallowStore((state) => ({
    setSelected: state.setSelected,
  }));

  return (
    longitude &&
    latitude && (
      <Marker
        longitude={longitude}
        latitude={latitude}
        anchor="center"
        style={{ zIndex: hover ? 3 : 2, cursor: 'pointer' }}
        onClick={(e) => {
          e.originalEvent.stopPropagation();
          setSelected([activity_id]);
        }}
      >
        <Avatar
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className="size-8 border-2 border-white transition-all hover:size-32 overflow-auto"
        >
          <AvatarImage
            src={photoUrl}
            alt={caption ?? activity_name}
            className="w-full h-full object-cover"
          />
        </Avatar>
      </Marker>
    )
  );
}
