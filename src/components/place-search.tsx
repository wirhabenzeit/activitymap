'use client';

import { MapPin, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { PlaceDetail } from '~/components/place-detail';
import { PlaceSymbol } from '~/components/place-symbol';
import { Input } from '~/components/ui/input';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import { usePlaceLibrary } from '~/hooks/use-place-library';
import { placeKindLabel } from '~/lib/activity-places';
import { type LibraryPlace, searchLibraryPlaces } from '~/lib/place-library';
import { primaryPlaceKind } from '~/lib/place-symbols';
import { measurementScale, measurementUnit } from '~/lib/units';
import { store, useShallowStore } from '~/store';
import { applyFilters } from '~/store/filter';

export function PlaceSearch() {
  const { search, place, setSearch, setPlace } = useShallowStore((state) => ({
    search: state.search,
    place: state.place,
    setSearch: state.setSearch,
    setPlace: state.setPlace,
  }));
  const { library, activities } = usePlaceLibrary();
  const units = useDisplayUnits();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [inspection, setInspection] = useState<{
    id: string;
    userId: string;
  }>();
  const deferredSearch = useDeferredValue(search);
  const suggestionSearch = search.trim() === '' ? '' : deferredSearch;
  const suggestionsPending = suggestionSearch !== search;
  const suggestions = useMemo(
    () =>
      suggestionSearch.trim()
        ? searchLibraryPlaces(library, suggestionSearch)
        : { places: [], total: 0 },
    [library, suggestionSearch],
  );
  const activeIndex = Math.min(active, suggestions.places.length);
  const visible = open && Boolean(library.userId) && Boolean(search.trim());
  useEffect(() => {
    if (visible)
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [visible, listId, activeIndex]);
  const detail =
    inspection && inspection.userId === library.userId
      ? library.byId.get(inspection.id)
      : undefined;
  const selected = place?.userId === library.userId ? place : undefined;
  const choose = (item: LibraryPlace) => {
    if (!library.userId) return;
    // The suggestion consumes the name typed to find it. Subsequent text is
    // an independent activity-name constraint, combined with this chip by AND.
    store.setState({
      place: { id: item.id, name: item.name, userId: library.userId },
      search: '',
    });
    setOpen(false);
    setActive(0);
  };
  const show = (destination: 'map' | 'list') => {
    if (!detail) return;
    choose(detail);
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
    setInspection(undefined);
    router.push(destination === 'map' ? '/map' : '/list');
  };
  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div
        data-testid="place-search-field"
        className="flex min-h-9 min-w-0 items-center gap-1 rounded-md border border-input bg-transparent pr-1 pl-2 shadow-xs focus-within:ring-1 focus-within:ring-ring"
      >
        <Search
          className="pointer-events-none size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        {selected && (
          <div
            data-testid="selected-place-token"
            className={`inline-flex min-w-0 shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 text-primary ${search ? 'max-w-[45%]' : 'max-w-[60%]'}`}
          >
            <button
              type="button"
              className="flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1 pl-2 text-left text-xs underline-offset-2 hover:underline disabled:cursor-default"
              disabled={!library.byId.has(selected.id)}
              onClick={() =>
                setInspection({ id: selected.id, userId: selected.userId })
              }
              aria-label={`Place: ${selected.name}. View details`}
              title={selected.name}
            >
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{selected.name}</span>
            </button>
            <button
              type="button"
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
              title="Remove place filter"
              aria-label={`Remove place filter: ${selected.name}`}
              onClick={() => {
                setPlace(undefined);
                inputRef.current?.focus();
                setOpen(false);
              }}
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        )}
        <Input
          ref={inputRef}
          role="combobox"
          aria-label="Search activity names or choose a place"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? listId : undefined}
          aria-activedescendant={
            visible ? `${listId}-${activeIndex}` : undefined
          }
          placeholder={selected ? 'Activity name' : 'Activities or places'}
          className="h-8 w-0 min-w-0 flex-1 rounded-none border-0 px-1 shadow-none focus-visible:ring-0"
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              if (visible) {
                event.preventDefault();
                event.stopPropagation();
              }
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!search.trim()) return;
              event.preventDefault();
              setOpen(true);
              // Explicit keyboard selection uses the latest query even while
              // the deferred suggestion rendering is still catching up.
              const choices = suggestionsPending
                ? searchLibraryPlaces(library, search)
                : suggestions;
              setActive(
                Math.max(
                  0,
                  Math.min(
                    choices.places.length,
                    active + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              );
            }
            if (event.key === 'Enter' && visible) {
              event.preventDefault();
              const choices = suggestionsPending
                ? searchLibraryPlaces(library, search)
                : suggestions;
              const item =
                choices.places[Math.min(active, choices.places.length) - 1];
              if (item) choose(item);
              else setOpen(false);
            }
          }}
        />
        {search && (
          <button
            type="button"
            aria-label="Clear activity-name search"
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-accent"
            onClick={() => {
              setSearch('');
              setActive(0);
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {selected && !library.byId.has(selected.id) && (
        <p className="mt-1 text-xs text-muted-foreground">
          No activities for this place.
        </p>
      )}
      {visible && (
        <div className="absolute z-50 mt-1 w-full min-w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div
            id={listId}
            role="listbox"
            aria-label="Search choices"
            aria-busy={suggestionsPending}
            className="max-h-80 overflow-y-auto"
          >
            <div
              role="option"
              id={`${listId}-0`}
              aria-selected={activeIndex === 0}
              className={`cursor-pointer rounded p-2 text-sm ${activeIndex === 0 ? 'bg-accent' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setActive(0);
                setOpen(false);
              }}
            >
              Activity names{search.trim() ? `: “${search.trim()}”` : ''}
            </div>
            <p
              role="presentation"
              className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground"
            >
              Places
            </p>
            {suggestions.places.map((item, index) => (
              <div
                key={item.id}
                id={`${listId}-${index + 1}`}
                role="option"
                aria-selected={activeIndex === index + 1}
                aria-disabled={suggestionsPending}
                className={`flex cursor-pointer items-start gap-2 rounded p-2 text-sm ${activeIndex === index + 1 ? 'bg-accent' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index + 1)}
                onClick={() => {
                  if (!suggestionsPending) choose(item);
                }}
              >
                <PlaceSymbol
                  kind={primaryPlaceKind(item)}
                  className="mt-1 size-4 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-medium break-words">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {placeKindLabel(item)}
                    {item.elevationM != null
                      ? ` · ${Math.round(item.elevationM / measurementScale('elevation', units))} ${measurementUnit('elevation', units)}`
                      : ''}{' '}
                    · {item.activityCount}{' '}
                    {item.activityCount === 1 ? 'activity' : 'activities'}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {suggestions.total === 0 && !suggestionsPending && (
            <p
              role="status"
              className="px-2 py-1 text-xs text-muted-foreground"
            >
              No places found.
            </p>
          )}
        </div>
      )}
      <PlaceDetail
        place={detail}
        onClose={() => setInspection(undefined)}
        onShowActivities={() => show('list')}
        onShowMap={() => show('map')}
      />
    </div>
  );
}
