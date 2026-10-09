'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json,
// one titled section per tile group (Now, This year, Patterns). Every tile
// respects sidebar activity filters while retaining the date history needed
// for its own reporting and comparison periods. The grid fills the full width with the regular
// layout's columns, so tiles widen on big screens. Only primary tiles get
// the large headline numerals.
//
// Expandable tiles open a URL-backed focus surface. The dashboard keeps its
// layout, scroll position and mounted controls underneath that surface.

import {
  useDisplayUnits,
  useDateFormat,
} from '~/hooks/use-display-preferences';
import { statsFormat } from './format';
import {
  Activity,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { useTheme } from 'next-themes';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import { useStatsFocus } from '~/hooks/use-stats-focus';

import { FilterScope, useStatsActivities } from './scope';
import {
  statsTileGroups,
  statsTileLayout,
  statsTiles,
  type StatsTile,
  type StatsTileID,
} from '~/settings/stats-tiles.generated';
import { type StatsActivity } from '~/lib/stats/tile-data';
import { placeBento, bentoRowMinimums } from '~/lib/stats/bento';
import { isStatsHistoryLoading } from '~/lib/stats/loading';
import { localToday } from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';

import { Measure } from './charts';
import { tilePalette } from './format';
import {
  faceOptionLabels,
  optionLabels,
  tileView,
  type TileContext,
  type TileSummary,
  type TileView,
} from './tiles';

import { StatsActivityInspector } from './activity-inspector';

type ShownTile = { tile: StatsTile; view: TileView };

const shownTiles: ShownTile[] = statsTiles.flatMap((tile) => {
  const view = tileView(tile.id);
  return view ? [{ tile, view }] : [];
});

const toggleOf = (tile: StatsTile) => ('toggle' in tile ? tile.toggle : null);

export default function StatsTiles() {
  const { query, activities, scope, reset } = useStatsActivities();
  const empty = activities.length === 0;
  const loading = isStatsHistoryLoading(query, empty);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterScope labels={scope.labels} onReset={reset} />
      {query.isError && (
        <div role="alert" className="px-4 py-3 text-sm">
          Could not load activity history.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading activity history…
        </p>
      ) : empty && query.isError ? null : empty ? (
        <div className="p-6 text-sm text-muted-foreground">
          <p>
            {scope.filtered && (query.data?.length ?? 0) > 0
              ? 'No activities match these filters.'
              : 'No activity history available yet.'}
          </p>
        </div>
      ) : (
        <>
          {(query.isFetching || query.hasNextPage) && (
            <p
              role="status"
              className="px-4 py-2 text-xs text-muted-foreground"
            >
              Loading more history; comparisons may be incomplete.
            </p>
          )}
          <div className="min-h-0 flex-1">
            <StatsActivityInspector activities={query.data ?? []}>
              {(open, detailsOpen, inspection) => (
                <StatsTileGrid
                  activities={activities}
                  filtered={scope.filtered}
                  singleSport={scope.singleSport}
                  onOpenActivity={open}
                  detailsOpen={detailsOpen}
                  {...inspection}
                />
              )}
            </StatsActivityInspector>
          </div>
        </>
      )}
    </div>
  );
}

export function StatsTileGrid({
  activities,
  filtered = false,
  singleSport = false,
  onOpenActivity,
  detailsOpen = false,
  availableWidth,
  selectedActivityId,
  reportingDay,
}: {
  activities: StatsActivity[];
  filtered?: boolean;
  singleSport?: boolean;
  onOpenActivity?: (id: number) => void;
  detailsOpen?: boolean;
  availableWidth?: number;
  selectedActivityId?: number | null;
  // Fixed reporting date for the development gallery; normal dashboards roll over daily.
  reportingDay?: number;
}) {
  const { resolvedTheme } = useTheme();
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    const update = () => setToday(localToday());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const units = useDisplayUnits();
  const dateFormat = useDateFormat();
  const context: TileContext = useMemo(
    () => ({
      activities,
      units,
      dateFormat,
      today: reportingDay ?? today,
      filtered,
      singleSport,
      onOpenActivity,
      availableWidth,
      selectedActivityId,
      palette: tilePalette(resolvedTheme === 'dark'),
    }),
    [
      activities,
      today,
      reportingDay,
      units,
      dateFormat,
      resolvedTheme,
      filtered,
      singleSport,
      onOpenActivity,
      availableWidth,
      selectedActivityId,
    ],
  );

  const { activeID, open, close } = useStatsFocus();
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousID = useRef<StatsTileID | null>(null);
  const [options, setOptions] = useState<Partial<Record<StatsTileID, string>>>(
    {},
  );
  const [calendarYear, setCalendarYear] = useState<number | null>(null);
  const [calendarDay, setCalendarDay] = useState<number | null>(null);
  const calendar = {
    year: calendarYear,
    setYear: setCalendarYear,
    selectedDay: calendarDay,
    setSelectedDay: setCalendarDay,
  };
  const optionFor = (tile: StatsTile) =>
    options[tile.id] ?? toggleOf(tile)?.options[0];
  const changeOption = (id: StatsTileID, option: string) =>
    setOptions((previous) => ({ ...previous, [id]: option }));

  useLayoutEffect(() => {
    const previous = previousID.current;
    previousID.current = activeID;
    if (!activeID && previous) {
      const card = scrollRef.current?.querySelector<HTMLElement>(
        `[data-tile-id="${previous}"]`,
      );
      (
        card?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? card
      )?.focus({ preventScroll: true });
    }
  }, [activeID]);

  useEffect(() => {
    if (!activeID || detailsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      // A nested dialog can unmount before this event reaches window.
      const fromDialog = event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element && node.getAttribute('role') === 'dialog',
        );
      if (event.key === 'Escape' && !event.defaultPrevented && !fromDialog) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeID, detailsOpen, close]);

  return (
    <Measure retainSize className="relative h-full min-h-0 w-full">
      {({ width: focusWidth, height: focusHeight }) => (
        <>
          <div
            ref={scrollRef}
            data-stats-dashboard
            inert={Boolean(activeID)}
            aria-hidden={Boolean(activeID)}
            className={cn(
              'h-full w-full overflow-y-auto overscroll-y-contain [overflow-anchor:none]',
              activeID && 'invisible',
            )}
          >
            <Measure retainSize className="h-full w-full">
              {({ width }) => {
                const padding = width < 520 ? 12 : 16;
                return (
                  <div className="flex flex-col gap-5" style={{ padding }}>
                    {statsTileGroups.map((group) => (
                      <BentoGroup
                        key={group.id}
                        title={group.title}
                        tiles={shownTiles.filter(
                          ({ tile }) => tile.group === group.id,
                        )}
                        width={width - 2 * padding}
                        context={{ ...context, calendar }}
                        activeID={activeID}
                        optionFor={optionFor}
                        onOption={changeOption}
                        onExpand={open}
                      />
                    ))}
                  </div>
                );
              }}
            </Measure>
          </div>
          {shownTiles
            .filter(({ view }) => view.expandable)
            .map(({ tile, view }) => (
              <Activity
                key={tile.id}
                mode={activeID === tile.id ? 'visible' : 'hidden'}
              >
                <div className="absolute inset-0 bg-background">
                  <TileFocusView
                    tile={tile}
                    view={view}
                    context={{
                      ...context,
                      calendar,
                      focusWidth,
                      focusChartHeight: Math.max(
                        150,
                        Math.min(
                          focusWidth >= 760 ? 400 : 300,
                          focusHeight * 0.48,
                          focusHeight - 220,
                        ),
                      ),
                    }}
                    option={optionFor(tile)}
                    onOption={(option) => changeOption(tile.id, option)}
                    onBack={close}
                  />
                </div>
              </Activity>
            ))}
        </>
      )}
    </Measure>
  );
}

const { regular, compact, narrow, gap } = statsTileLayout;

function BentoGroup({
  title,
  tiles,
  width,
  context,
  activeID,
  optionFor,
  onOption,
  onExpand,
}: {
  title: string;
  tiles: ShownTile[];
  width: number;
  context: TileContext;
  activeID: StatsTileID | null;
  optionFor: (tile: StatsTile) => string | undefined;
  onOption: (id: StatsTileID, option: string) => void;
  onExpand: (id: StatsTileID) => void;
}) {
  const grid =
    width >= regular.minWidth
      ? regular
      : width >= compact.minWidth
        ? compact
        : narrow;
  const placements = placeBento(
    tiles.map(({ tile }) => tile.span),
    grid.columns,
  );
  const rowMinimums = bentoRowMinimums(
    tiles.map(({ tile }) => ({
      minHeight: 'minHeight' in tile ? tile.minHeight : undefined,
    })),
    placements,
    grid.rowHeight,
    gap,
  );
  if (tiles.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div
        className="grid"
        style={{
          gap,
          gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          gridTemplateRows: rowMinimums
            .map((minimum) => `minmax(${minimum}px, auto)`)
            .join(' '),
        }}
      >
        {tiles.map(({ tile, view }, index) => {
          const placement = placements[index]!;
          return (
            <TileCard
              key={tile.id}
              tile={tile}
              view={view}
              context={{
                ...context,
                inlineDetails: tile.id === 'sportMix' && width >= 760,
              }}
              large={'primary' in tile && tile.primary}
              focused={tile.id === activeID}
              option={optionFor(tile)}
              onOption={(option) => onOption(tile.id, option)}
              onExpand={() => onExpand(tile.id)}
              style={{
                gridColumn: `${placement.column} / span ${placement.columns}`,
                gridRow: `${placement.row} / span ${placement.rows}`,
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function Headline({
  summary,
  size,
}: {
  summary: TileSummary;
  size: 'tile' | 'large';
}) {
  return (
    <>
      <div
        className={cn(
          'shrink-0 font-mono font-medium tabular-nums leading-tight tracking-tight',
          size === 'tile' && 'mt-1 text-[20px]',
          size === 'large' && 'mt-1 text-[32px]',
        )}
      >
        {summary.value}
        {summary.unit && (
          <small className="ml-1 font-sans text-[13px] font-normal tracking-normal text-muted-foreground">
            {summary.unit}
          </small>
        )}
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">
        {summary.sub}
      </div>
    </>
  );
}

function TileCard({
  tile,
  view,
  context,
  large,
  focused,
  option,
  onOption,
  onExpand,
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  focused: boolean;
  option: string | undefined;
  onOption: (option: string) => void;
  onExpand: () => void;
  style: CSSProperties;
}) {
  const toggle = toggleOf(tile);
  const summary = view.summary(context, option);
  return (
    <section
      aria-label={tile.title}
      data-tile-id={tile.id}
      tabIndex={-1}
      className="group @container relative min-w-0 overflow-hidden rounded-lg border bg-card text-left text-card-foreground shadow-xs"
      style={style}
    >
      <div className="flex h-full min-w-0 flex-col p-3.5">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium">{tile.title}</h3>
          {view.expandable && !context.inlineDetails && (
            <button
              type="button"
              aria-expanded={focused}
              aria-label={`Expand ${tile.title}`}
              title={`Expand ${tile.title}`}
              onClick={onExpand}
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Maximize2 aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[11px] text-muted-foreground">
            {view.period(context, option)}
          </span>
          {toggle && (
            <FaceSwitch
              label={`${tile.title}: ${toggle.label}`}
              options={toggle.options}
              value={option}
              onChange={onOption}
            />
          )}
        </div>
        {summary && (
          <Headline summary={summary} size={large ? 'large' : 'tile'} />
        )}
        {view.face({ ...context, onExpand }, option, false)}
        {context.inlineDetails && view.more?.(context, option)}
      </div>
    </section>
  );
}

export function TileFocusView({
  tile,
  view,
  context,
  option,
  onOption,
  onBack,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  option: string | undefined;
  onOption: (option: string) => void;
  onBack: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  const toggle = toggleOf(tile);
  const summary = view.summary(context, option);
  const sideBySide =
    (context.focusWidth ?? 0) >= 1000 &&
    Boolean(view.insight ?? view.more) &&
    tile.id !== 'sportMix';
  return (
    <section
      data-stats-focus={tile.id}
      aria-label={`${tile.title} focus view`}
      className="@container flex h-full min-h-0 flex-col bg-card text-card-foreground"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            ref={backRef}
            type="button"
            onClick={onBack}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to stats dashboard"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </button>
          <h1 className="text-base font-medium">{tile.title}</h1>
        </div>
        {toggle && (
          <FaceSwitch
            label={`${tile.title}: ${toggle.label}`}
            options={toggle.options}
            value={option}
            onChange={onOption}
          />
        )}
      </header>
      <div
        data-stats-focus-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4"
      >
        <div
          className={cn(
            'mx-auto w-full',
            tile.id === 'sportMix'
              ? 'max-w-3xl'
              : tile.id === 'distanceVsElevation'
                ? 'max-w-6xl'
                : 'max-w-7xl',
          )}
        >
          <p className="mb-2 text-xs text-muted-foreground">
            {view.expandedPeriod ?? view.period(context, option)}
          </p>
          {view.detail ? (
            view.detail(context, option)
          ) : (
            <div
              className={cn(
                'grid gap-6',
                sideBySide &&
                  'grid-cols-[minmax(0,3fr)_minmax(300px,2fr)] items-start',
              )}
            >
              <div className="min-w-0">
                {summary && <Headline summary={summary} size="large" />}
                {view.face(context, option, true)}
              </div>
              {(view.insight ?? view.more) && (
                <div className="min-w-0">
                  {(view.insight ?? view.more)?.(context, option)}
                </div>
              )}
            </div>
          )}
          {!view.detail && view.insight && view.more?.(context, option)}
        </div>
      </div>
    </section>
  );
}

function FaceSwitch({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const { metricUnit } = statsFormat(useDisplayUnits());
  return (
    <div
      role="group"
      aria-label={label}
      className="-my-1 inline-flex shrink-0 self-center rounded-md bg-muted p-0.5"
      // Switching the face must not expand the tile.
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          aria-label={optionLabels[option] ?? option}
          title={optionLabels[option] ?? option}
          onClick={() => onChange(option)}
          className={cn(
            'min-h-7 min-w-7 rounded-[5px] px-1.5 py-1 text-[11px] font-medium leading-none text-muted-foreground hover:text-foreground',
            option === value && 'bg-background text-foreground shadow-xs',
          )}
        >
          {option === 'distance'
            ? metricUnit.distance
            : option === 'elevation'
              ? metricUnit.elevation
              : (faceOptionLabels[option] ?? option)}
        </button>
      ))}
    </div>
  );
}
