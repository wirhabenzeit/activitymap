'use client';

import { Marker } from 'react-map-gl/mapbox';
import { useMemo } from 'react';
import { useShallowStore } from '~/store';
import { usePhotos } from '~/hooks/use-photos';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import type { Photo } from '~/server/db/schema';
import { photoVariant, validPhotoLocation } from '~/lib/photo-gallery';
import { PhotoImage, PhotoLightbox } from '../list/photo';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export default function PhotoLayer() {
  const zoom = useShallowStore((state) => state.position.zoom);
  const { data: photos = [] } = usePhotos();
  const { filterIDs } = useFilteredActivities();
  const visible = useMemo(() => new Set(filterIDs), [filterIDs]);
  const galleries = useMemo(() => {
    const result = new Map<number, Photo[]>();
    for (const photo of photos) {
      const group = result.get(photo.activity_id) ?? [];
      group.push(photo);
      result.set(photo.activity_id, group);
    }
    return result;
  }, [photos]);

  return (
    zoom > 8 && (
      <>
        {photos
          .filter(
            (p) => visible.has(p.activity_id) && validPhotoLocation(p.location),
          )
          .map((photo) => (
            <PhotoMarker
              key={photo.unique_id}
              photo={photo}
              gallery={galleries.get(photo.activity_id) ?? []}
            />
          ))}
      </>
    )
  );
}

function PhotoMarker({ photo, gallery }: { photo: Photo; gallery: Photo[] }) {
  const setSelected = useShallowStore((state) => state.setSelected);
  if (!validPhotoLocation(photo.location)) return null;
  return (
    <Marker
      longitude={photo.location[1]}
      latitude={photo.location[0]}
      anchor="center"
      style={{ zIndex: 2 }}
      onClick={(e) => e.originalEvent.stopPropagation()}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-11 w-11 overflow-hidden rounded-lg border-2 border-white bg-black text-white shadow-md"
            aria-label={`Select ${photo.activity_name ?? 'activity'} and preview photo`}
            onClick={(e) => {
              e.stopPropagation();
              setSelected([photo.activity_id]);
            }}
          >
            <PhotoImage variant={photoVariant(photo, 'thumbnail')} alt="" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="z-[60] w-64 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-medium">
            {photo.activity_name ?? 'Activity photos'}
          </p>
          <p className="text-xs text-muted-foreground">View photos</p>
          <PhotoLightbox
            photos={gallery}
            title={photo.activity_name ?? 'Activity photos'}
            thumbnailID={photo.unique_id}
            className="h-24"
          />
        </PopoverContent>
      </Popover>
    </Marker>
  );
}
