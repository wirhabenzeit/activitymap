'use client';

import { MapPin, Type, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PlaceDetail } from '~/components/place-detail';
import { usePlaceLibrary } from '~/hooks/use-place-library';
import { navigateToView } from '~/lib/app-views';
import { store, useShallowStore } from '~/store';
import { applyFilters } from '~/store/filter';

const chip =
  'inline-flex min-w-0 max-w-full items-center rounded-full border border-primary/20 bg-primary/10 text-primary';
const remove =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring';

/** The text and place filters, as removable chips while they are on. Header
 * search sets them; the place chip opens the place's details. */
export function TextPlaceFilterChips() {
  const { search, place, setSearch, setPlace } = useShallowStore((state) => ({
    search: state.search.trim(),
    place: state.place,
    setSearch: state.setSearch,
    setPlace: state.setPlace,
  }));
  const { library, activities } = usePlaceLibrary();
  const router = useRouter();
  const [inspecting, setInspecting] = useState(false);
  const selected = place?.userId === library.userId ? place : undefined;
  const detail =
    inspecting && selected ? library.byId.get(selected.id) : undefined;
  if (!search && !selected) return null;

  const show = (destination: 'map' | 'list') => {
    store.getState().setOnlySelected(false);
    if (destination === 'map') {
      store.setState({ showPlaces: true });
      store
        .getState()
        .requestRouteFit(
          (activities ?? [])
            .filter((activity) => applyFilters(store.getState(), activity))
            .map((activity) => activity.id),
        );
    }
    setInspecting(false);
    navigateToView(router, destination === 'map' ? '/map' : '/list');
  };

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {search && (
        <span data-testid="text-filter-chip" className={chip}>
          <span
            className="flex min-h-7 min-w-0 items-center gap-1 pl-2 text-xs"
            title={`Name or visited place contains “${search}”`}
          >
            <Type className="size-3 shrink-0" aria-hidden />
            <span className="truncate">“{search}”</span>
          </span>
          <button
            type="button"
            className={remove}
            aria-label={`Remove text filter: ${search}`}
            onClick={() => setSearch('')}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
      {selected && (
        <span data-testid="selected-place-token" className={chip}>
          <button
            type="button"
            className="flex min-h-7 min-w-0 cursor-pointer items-center gap-1 pl-2 text-left text-xs underline-offset-2 hover:underline disabled:cursor-default"
            disabled={!library.byId.has(selected.id)}
            onClick={() => setInspecting(true)}
            aria-label={`Place: ${selected.name}. View details`}
            title={selected.name}
          >
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{selected.name}</span>
          </button>
          <button
            type="button"
            className={remove}
            aria-label={`Remove place filter: ${selected.name}`}
            onClick={() => setPlace(undefined)}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
      {selected && !library.byId.has(selected.id) && (
        <p className="w-full text-xs text-muted-foreground">
          No activities for this place.
        </p>
      )}
      <PlaceDetail
        place={detail}
        onClose={() => setInspecting(false)}
        onShowActivities={() => show('list')}
        onShowMap={() => show('map')}
      />
    </div>
  );
}
