'use client';

import { ListFilter, Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { PlaceSymbol } from '~/components/place-symbol';
import { Button } from '~/components/ui/button';
import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import {
  useDateFormat,
  useDisplayUnits,
  useFormattingLocale,
} from '~/hooks/use-display-preferences';
import { usePlaceLibrary } from '~/hooks/use-place-library';
import type { Activity } from '~/lib/activity';
import { placeKindLabel } from '~/lib/activity-places';
import { navigateToView } from '~/lib/app-views';
import { formatPreferredDate } from '~/lib/date-preferences';
import {
  applyTextFilter,
  matchRange,
  matchedPlaceName,
  searchActivities,
  selectFromSearch,
  textFilterCount,
} from '~/lib/header-search';
import { type LibraryPlace, searchLibraryPlaces } from '~/lib/place-library';
import { primaryPlaceKind } from '~/lib/place-symbols';
import { formatMeasurement } from '~/lib/units';
import { cn } from '~/lib/utils';
import { workspaceFor } from '~/lib/workspace';
import { aliasMap, categorySettings } from '~/settings/category';
import { store, useShallowStore } from '~/store';
import { useHeaderSearch } from '~/store/header-search';

const ACTIVITY_LIMIT = 4;
const PLACE_LIMIT = 3;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** The search button at the right end of the header. `/` or ⌘K / Ctrl+K open search too. */
export function HeaderSearchButton({ onBegin }: { onBegin: () => void }) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command =
        event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      const slash =
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTyping(event.target);
      if (!command && !slash) return;
      event.preventDefault();
      onBegin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBegin]);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11"
      aria-label="Search activities and places"
      title="Search (/)"
      data-testid="header-search-button"
      onClick={onBegin}
    >
      <Search />
    </Button>
  );
}

type Option =
  | { kind: 'activity'; activity: Activity }
  | { kind: 'place'; place: LibraryPlace }
  | { kind: 'filter' };

/** The header turned into a find field, a close button and, on Map and
 * Stats, the results panel below it. On List the rows narrow instead (see
 * `ActivityListView`), so List needs no library here. */
export function HeaderSearchBar() {
  const narrowsRows = useHeaderSearch((state) => state.narrowsRows);
  return narrowsRows ? <ListSearch /> : <PanelSearch />;
}

type FieldProps = {
  combobox?: { listId: string; activeId?: string };
  onArrow?: (step: 1 | -1) => void;
  onEnter: () => void;
  onEdit?: () => void;
  children?: React.ReactNode;
};

/** The field and the close button, shared by both hosts. */
function SearchField({
  combobox,
  onArrow,
  onEnter,
  onEdit,
  children,
}: FieldProps) {
  const { query, setQuery, end } = useHeaderSearch();
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
      <div
        data-testid="header-search-field"
        className="flex h-9 max-w-xl min-w-0 flex-1 origin-right items-center gap-2 rounded-full bg-white/15 px-3 duration-200 animate-in fade-in zoom-in-95"
      >
        <Search
          className="size-4 shrink-0 text-header-foreground/80"
          aria-hidden
        />
        <input
          ref={inputRef}
          role={combobox ? 'combobox' : undefined}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Find activities or places"
          aria-autocomplete={combobox ? 'list' : undefined}
          aria-expanded={combobox ? true : undefined}
          aria-controls={combobox?.listId}
          aria-activedescendant={combobox?.activeId}
          placeholder="Find activities or places"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-header-foreground outline-none placeholder:text-header-foreground/60 [&::-webkit-search-cancel-button]:hidden"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onEdit?.();
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              end();
            } else if (
              onArrow &&
              (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
              event.preventDefault();
              onArrow(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              onEnter();
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search text"
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-header-foreground/70 hover:text-header-foreground"
            onClick={() => {
              setQuery('');
              onEdit?.();
              inputRef.current?.focus();
            }}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0 duration-200 animate-in fade-in zoom-in-90"
        aria-label="Close search"
        data-testid="header-search-close"
        onClick={end}
      >
        <X />
      </Button>
      {children}
    </div>
  );
}

/** List: Enter makes the narrowing the text filter, like Filter beside the
 * match count. */
function ListSearch() {
  const { query, end } = useHeaderSearch();
  return (
    <SearchField
      onEnter={() => {
        if (!query.trim()) return;
        applyTextFilter(store, query, [], false);
        end();
      }}
    />
  );
}

function PanelSearch() {
  const { query, end } = useHeaderSearch();
  const pathname = usePathname();
  const router = useRouter();
  const listId = React.useId();
  const outsideActivities = workspaceFor(pathname) !== 'activities';
  const {
    query: { data: activities = [] },
    filterIDs,
  } = useBrowsingLibrary();
  const { library } = usePlaceLibrary();
  const current = useShallowStore((state) => state.search.trim());
  const deferredQuery = React.useDeferredValue(query);
  const trimmed = deferredQuery.trim();

  const foundActivities = React.useMemo(
    () => searchActivities(activities, trimmed),
    [activities, trimmed],
  );
  const foundPlaces = React.useMemo(
    () =>
      !trimmed || !library.userId
        ? { places: [], total: 0 }
        : searchLibraryPlaces(library, trimmed, 0, PLACE_LIMIT),
    [library, trimmed],
  );
  const fold = (value: string) => value.normalize('NFC').toLowerCase();
  const replaces =
    foundActivities.length > 0 && fold(current) !== fold(trimmed);
  const options: Option[] = [
    ...foundActivities
      .slice(0, ACTIVITY_LIMIT)
      .map((activity) => ({ kind: 'activity' as const, activity })),
    ...foundPlaces.places.map((place) => ({ kind: 'place' as const, place })),
    ...(replaces ? [{ kind: 'filter' as const }] : []),
  ];
  const [active, setActive] = React.useState(-1);
  const activeIndex = active < options.length ? active : -1;
  const panel = Boolean(trimmed);

  React.useEffect(() => {
    if (activeIndex >= 0)
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [listId, activeIndex]);

  const toMap = () => {
    end();
    if (pathname !== '/map') navigateToView(router, '/map');
  };
  const pickActivity = (activity: Activity) => {
    selectFromSearch(store, [activity.id]);
    toMap();
  };
  const pickPlace = (place: LibraryPlace) => {
    if (!library.userId) return;
    selectFromSearch(store, place.activityIds, {
      ...place,
      userId: library.userId,
    });
    toMap();
  };
  const filterToPlace = (place: LibraryPlace) => {
    if (!library.userId) return;
    store
      .getState()
      .setPlace({ id: place.id, name: place.name, userId: library.userId });
    if (pathname === '/map')
      store.getState().requestPlaceFly(place.latitude, place.longitude);
    if (outsideActivities) toMap();
    else end();
  };
  const applyFilter = () => {
    const text = query.trim();
    if (!text) return;
    applyTextFilter(store, text, activities, pathname === '/map');
    if (outsideActivities) toMap();
    else end();
  };
  const clearFilter = () => {
    store.getState().setSearch('');
    if (outsideActivities) toMap();
    else end();
  };
  const choose = (option: Option) => {
    if (option.kind === 'activity') pickActivity(option.activity);
    else if (option.kind === 'place') pickPlace(option.place);
    else applyFilter();
  };

  return (
    <SearchField
      combobox={
        panel
          ? {
              listId,
              activeId:
                activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined,
            }
          : undefined
      }
      onEdit={() => setActive(-1)}
      onArrow={
        panel
          ? (step) =>
              setActive(
                Math.max(-1, Math.min(options.length - 1, activeIndex + step)),
              )
          : undefined
      }
      onEnter={() => {
        // Results render from the deferred query; act only on what is on
        // screen.
        if (deferredQuery !== query) return;
        const option = options[activeIndex];
        if (option) choose(option);
        else if (replaces) applyFilter();
      }}
    >
      {panel && (
        <SearchResults
          listId={listId}
          query={trimmed}
          activities={foundActivities}
          places={foundPlaces}
          visible={filterIDs}
          current={current}
          replaces={replaces}
          count={
            replaces
              ? textFilterCount(store.getState(), activities, trimmed, true)
              : 0
          }
          activeIndex={activeIndex}
          setActive={setActive}
          onActivity={pickActivity}
          onPlace={pickPlace}
          onFilterToPlace={filterToPlace}
          onApplyFilter={applyFilter}
          onClearFilter={clearFilter}
        />
      )}
    </SearchField>
  );
}

function Highlighted({
  text,
  query,
  ignoringAccents = false,
}: {
  text: string;
  query: string;
  ignoringAccents?: boolean;
}) {
  const range = matchRange(text, query, ignoringAccents);
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="bg-transparent font-bold text-[var(--activity-accent)]">
        {text.slice(range[0], range[1])}
      </mark>
      {text.slice(range[1])}
    </>
  );
}

function SearchResults({
  listId,
  query,
  activities,
  places,
  visible,
  current,
  replaces,
  count,
  activeIndex,
  setActive,
  onActivity,
  onPlace,
  onFilterToPlace,
  onApplyFilter,
  onClearFilter,
}: {
  listId: string;
  query: string;
  activities: Activity[];
  places: { places: LibraryPlace[]; total: number };
  visible: number[];
  current: string;
  replaces: boolean;
  count: number;
  activeIndex: number;
  setActive: (index: number) => void;
  onActivity: (activity: Activity) => void;
  onPlace: (place: LibraryPlace) => void;
  onFilterToPlace: (place: LibraryPlace) => void;
  onApplyFilter: () => void;
  onClearFilter: () => void;
}) {
  const units = useDisplayUnits();
  const locale = useFormattingLocale();
  const dateFormat = useDateFormat();
  const visibleSet = React.useMemo(() => new Set(visible), [visible]);
  const shown = activities.slice(0, ACTIVITY_LIMIT);
  const placeOffset = shown.length;
  const filterIndex = placeOffset + places.places.length;
  const option = (index: number) => ({
    id: `${listId}-${index}`,
    role: 'option',
    'aria-selected': activeIndex === index,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseEnter: () => setActive(index),
  });
  const rowClass = (index: number) =>
    cn(
      'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-left',
      activeIndex === index && 'bg-accent',
    );

  return (
    <div
      className="absolute inset-x-2 top-14 z-10 ml-auto max-w-[520px] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl duration-150 animate-in fade-in slide-in-from-top-1"
      data-testid="header-search-results"
    >
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="max-h-[min(70dvh,560px)] overflow-y-auto py-1"
      >
        {shown.length > 0 && (
          <Group title="Activities" count={activities.length} />
        )}
        {shown.map((activity, index) => {
          const group = aliasMap[activity.sport_type];
          const Icon = group ? categorySettings[group].icon : undefined;
          const via = matchedPlaceName(activity, query);
          const hidden = !visibleSet.has(activity.id);
          return (
            <div
              key={activity.id}
              {...option(index)}
              data-testid={`header-search-activity-${activity.id}`}
              className={cn(rowClass(index), hidden && 'opacity-60')}
              onClick={() => onActivity(activity)}
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
                style={{
                  backgroundColor: group
                    ? categorySettings[group].color
                    : undefined,
                }}
                aria-hidden
              >
                {Icon && <Icon className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  <Highlighted text={activity.name} query={query} />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    activity.sport_type,
                    formatPreferredDate(
                      activity.start_date_local,
                      dateFormat,
                      locale,
                    ),
                    via && `via ${via}`,
                    hidden && 'hidden by filters',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums">
                <span className="block font-medium">
                  {formatMeasurement(
                    activity.distance,
                    'distance',
                    units,
                    locale,
                  )}
                </span>
                {activity.total_elevation_gain != null &&
                  activity.total_elevation_gain >= 1 && (
                    <span className="block text-muted-foreground">
                      ↑{' '}
                      {formatMeasurement(
                        activity.total_elevation_gain,
                        'elevation',
                        units,
                        locale,
                      )}
                    </span>
                  )}
              </span>
            </div>
          );
        })}
        {places.places.length > 0 && (
          <Group title="Places" count={places.total} />
        )}
        {places.places.map((place, i) => {
          const index = placeOffset + i;
          const latest = new Date(place.latestVisit).getUTCFullYear();
          return (
            <div
              key={place.id}
              {...option(index)}
              data-testid={`header-search-place-${place.id}`}
              className={rowClass(index)}
              onClick={() => onPlace(place)}
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
                aria-hidden
              >
                <PlaceSymbol
                  kind={primaryPlaceKind(place)}
                  className="size-4"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  <Highlighted
                    text={place.name}
                    query={query}
                    ignoringAccents
                  />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    placeKindLabel(place),
                    place.elevationM != null &&
                      formatMeasurement(
                        place.elevationM,
                        'elevation',
                        units,
                        locale,
                      ),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums">
                <span className="block font-medium">
                  {place.activityCount}{' '}
                  {place.activityCount === 1 ? 'visit' : 'visits'}
                </span>
                <span className="block text-muted-foreground">
                  {place.activityCount === 1 ? latest : `last ${latest}`}
                </span>
              </span>
              <button
                type="button"
                tabIndex={-1}
                title="Filter to this place"
                aria-label={`Filter to ${place.name}`}
                data-testid={`header-search-filter-place-${place.id}`}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onFilterToPlace(place);
                }}
              >
                <ListFilter className="size-4" />
              </button>
            </div>
          );
        })}
        {shown.length === 0 && places.places.length === 0 && (
          <p
            role="status"
            className="flex min-h-14 items-center justify-center px-3 text-sm text-muted-foreground"
          >
            No activities or places match “{query}”
          </p>
        )}
      </div>
      {(replaces || current) && (
        <div className="flex items-center gap-2 border-t px-1 py-1 text-sm">
          {replaces ? (
            <div
              {...option(filterIndex)}
              data-testid="header-search-apply-filter"
              className={cn(
                rowClass(filterIndex),
                'flex-1 text-[var(--activity-accent)]',
              )}
              onClick={onApplyFilter}
            >
              <ListFilter className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">Filter to “{query}”</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {count} {count === 1 ? 'activity' : 'activities'}
                  {current && ` · replaces “${current}”`}
                </span>
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5 text-muted-foreground">
              <ListFilter className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Filtered to “{current}”</span>
            </div>
          )}
          {current && (
            <button
              type="button"
              data-testid="header-search-clear-filter"
              aria-label={`Clear text filter “${current}”`}
              className="mr-2 inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[var(--activity-accent)]/10 px-3 text-[var(--activity-accent)] hover:bg-[var(--activity-accent)]/20"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClearFilter}
            >
              {replaces ? 'Clear' : 'Clear filter'}
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, count }: { title: string; count: number }) {
  return (
    <div
      role="presentation"
      className="flex items-baseline justify-between px-4 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground"
    >
      <span>{title}</span>
      <span className="font-normal tabular-nums">{count}</span>
    </div>
  );
}
