'use client';

import { Marker } from 'react-map-gl/mapbox';

import { PlaceSymbol } from '~/components/place-symbol';
import { usePlaceLibrary } from '~/hooks/use-place-library';
import type { LibraryPlace } from '~/lib/place-library';
import { primaryPlaceKind } from '~/lib/place-symbols';
import { useShallowStore } from '~/store';

/** The place filter, and a place picked in header search, on the map: an
 *  accent pin whose tip marks the place. Pointer events pass through to the
 *  routes and places beneath. */
export function PlaceFilterPin() {
  const { library } = usePlaceLibrary();
  const { place, searchPlace } = useShallowStore((state) => ({
    place: state.place,
    searchPlace: state.searchPlace,
  }));
  const resolve = (value: typeof place | null) =>
    value && value.userId === library.userId
      ? library.byId.get(value.id)
      : undefined;
  const filtered = resolve(place);
  const searched = resolve(searchPlace);
  return (
    <>
      {filtered && <Pin item={filtered} label="Place filter" />}
      {searched && searched.id !== filtered?.id && (
        <Pin item={searched} label="Found place" />
      )}
    </>
  );
}

function Pin({ item, label }: { item: LibraryPlace; label: string }) {
  return (
    <Marker
      longitude={item.longitude}
      latitude={item.latitude}
      anchor="bottom"
      style={{ zIndex: 3, pointerEvents: 'none' }}
    >
      <span
        role="img"
        aria-label={`${label}: ${item.name}`}
        data-testid={
          label === 'Place filter' ? 'place-filter-pin' : 'search-place-pin'
        }
        className="flex flex-col items-center drop-shadow-md"
      >
        <span className="flex size-8 items-center justify-center rounded-full border-2 border-white bg-[var(--activity-accent)] text-white">
          <PlaceSymbol kind={primaryPlaceKind(item)} className="size-5" />
        </span>
        <span className="-mt-0.5 size-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-[var(--activity-accent)]" />
      </span>
    </Marker>
  );
}
