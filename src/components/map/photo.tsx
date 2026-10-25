'use client';

import { Camera } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, useMap } from 'react-map-gl/mapbox';

import {
  type MapPhotoGroup,
  groupMapPhotos,
  mapPhotoPolicy,
} from '~/lib/map-photos';
import { photoVariant, validPhotoLocation } from '~/lib/photo-gallery';
import type { Photo } from '~/server/db/schema';
import { useShallowStore } from '~/store';

import { PhotoImage, PhotoLightbox } from '../list/photo';
import { MapMarkerPin } from './map-marker-pin';

export default function PhotoLayer({
  photos,
  visibleIDs,
}: {
  photos: Photo[];
  visibleIDs: number[];
}) {
  const scope = useShallowStore((s) =>
    JSON.stringify([s.user?.id, s.isGuest, s.guestMode]),
  );
  return <MapPhotos key={scope} photos={photos} visibleIDs={visibleIDs} />;
}

/** The same surface is exercised by the browser fixture with real Mapbox projection. */
export function MapPhotos({
  photos,
  visibleIDs,
}: {
  photos: Photo[];
  visibleIDs: number[];
}) {
  const { current: map } = useMap();
  const router = useRouter();
  const eligible = useMemo(() => {
    const visible = new Set(visibleIDs);
    return photos.filter((p) => visible.has(p.activity_id));
  }, [photos, visibleIDs]);
  const byID = useMemo(
    () => new Map(eligible.map((p) => [p.unique_id, p])),
    [eligible],
  );
  const [layout, setLayout] = useState<{
    groups: MapPhotoGroup[];
    thumbnails: boolean;
  }>({ groups: [], thumbnails: false });
  const [presentation, setPresentation] = useState<{
    id: string;
    ids: string[];
  } | null>(null);
  const invokingButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!map) return;
    const refresh = () => {
      const raw = map.getMap();
      const { clientWidth: width, clientHeight: height } = raw.getContainer();
      const zoom = raw.getZoom();
      const center = raw.getCenter().lng;
      const points = eligible.flatMap((p) => {
        if (!validPhotoLocation(p.location)) return [];
        // Project the nearest world copy when crossing the date line.
        const longitude =
          p.location[1] + 360 * Math.round((center - p.location[1]) / 360);
        const point = raw.project([longitude, p.location[0]]);
        return [{ id: p.unique_id, x: point.x, y: point.y }];
      });
      const next = {
        groups: groupMapPhotos(points, { width, height, zoom }),
        thumbnails: zoom >= mapPhotoPolicy.thumbnailZoom,
      };
      setLayout((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    refresh();
    map.on('load', refresh);
    map.on('style.load', refresh);
    map.on('moveend', refresh);
    map.on('resize', refresh);
    return () => {
      map.off('load', refresh);
      map.off('style.load', refresh);
      map.off('moveend', refresh);
      map.off('resize', refresh);
    };
  }, [map, eligible]);
  const gallery = presentation
    ? presentation.ids.flatMap((id) => byID.get(id) ?? [])
    : [];
  return (
    <>
      {layout.groups.map((group) => {
        const photo = byID.get(group.id);
        if (!photo || !validPhotoLocation(photo.location)) return null;
        const count = group.photoIDs.length;
        const zoomGroup = count > 1 && !layout.thumbnails;
        return (
          <Marker
            key={group.id}
            longitude={photo.location[1]}
            latitude={photo.location[0]}
            anchor="center"
            style={{ zIndex: 2 }}
            onClick={(e) => e.originalEvent.stopPropagation()}
          >
            <button
              type="button"
              data-map-photo={group.id}
              className="relative flex h-11 w-11 items-center justify-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={
                zoomGroup
                  ? `Zoom into ${count} photos`
                  : `View ${count > 1 ? `${count} photos` : 'photo'}: ${photo.activity_name ?? 'Activity'}`
              }
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (zoomGroup && map) {
                  map.easeTo({
                    center: [photo.location![1]!, photo.location![0]!],
                    zoom: Math.max(
                      map.getZoom() + 2,
                      mapPhotoPolicy.thumbnailZoom,
                    ),
                    duration: 450,
                  });
                  return;
                }
                invokingButton.current = e.currentTarget;
                setPresentation({
                  id: photo.unique_id,
                  ids:
                    count > 1
                      ? group.photoIDs
                      : eligible
                          .filter((p) => p.activity_id === photo.activity_id)
                          .map((p) => p.unique_id),
                });
              }}
            >
              <MapMarkerPin
                count={count}
                thumbnails={layout.thumbnails}
                data-photo-appearance={layout.thumbnails ? 'thumbnail' : 'pin'}
              >
                {layout.thumbnails ? (
                  <span className="absolute inset-0 overflow-hidden rounded-[5px]">
                    <PhotoImage
                      variant={photoVariant(photo, 'thumbnail')}
                      alt=""
                    />
                  </span>
                ) : (
                  <Camera size={14} aria-hidden="true" />
                )}
              </MapMarkerPin>
            </button>
          </Marker>
        );
      })}
      <PhotoLightbox
        photos={gallery}
        title="Map photos"
        hideThumbnails
        openPhotoID={presentation?.id ?? null}
        returnFocus={invokingButton}
        onPhotoIDChange={(id) =>
          setPresentation((old) => (id && old ? { ...old, id } : null))
        }
        onViewActivity={(photo) => {
          setPresentation(null);
          router.push(`/list?activity=${photo.activity_id}`);
        }}
      />
    </>
  );
}
