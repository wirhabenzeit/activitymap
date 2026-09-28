'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json,
// one titled section per tile group (Now, This year, Patterns). Every tile
// respects sidebar activity filters while retaining the date history needed
// for its own reporting and comparison periods. The grid fills the full width with the regular
// layout's columns, so tiles widen on big screens. Only primary tiles get
// the large headline numerals.
//
// Eligible tiles expand via their corner button: the card takes the full width of its
// section in a row sized to its content, pushing the other cards down, and
// Motion animates the reflow. Expanded, a tile is the same tile drawn
// larger (the same headline and visual, with axes on charts), plus any
// extra context the tile has. Escape or the collapse button returns it;
// interacting outside the card leaves it open, including touch scrolling.

import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { FilterScope, useStatsActivities } from './scope';
import {
  statsTileGroups,
  statsTileLayout,
  statsTiles,
  type StatsTile,
  type StatsTileID,
} from '~/settings/stats-tiles.generated';
import { type StatsActivity } from '~/lib/stats/tile-data';
import { placeBento } from '~/lib/stats/bento';
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

const ActivityDetails = dynamic(() => import('./activity-details'), {
  ssr: false,
});

type ShownTile = { tile: StatsTile; view: TileView };

const shownTiles: ShownTile[] = statsTiles.flatMap((tile) => {
  const view = tileView(tile.id);
  return view ? [{ tile, view }] : [];
});

const toggleOf = (tile: StatsTile) => ('toggle' in tile ? tile.toggle : null);

const layoutTransition = {
  layout: { duration: 0.3, ease: [0.2, 0, 0, 1] as const },
};

export default function StatsTiles() {
  const { query, activities, scope, reset } = useStatsActivities();
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailActivity = query.data?.find(
    (activity) => activity.id === detailId,
  );
  const empty = activities.length === 0;
  const loading =
    !query.isError &&
    (query.isLoading || (empty && (query.isFetching || query.hasNextPage)));
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
            <StatsTileGrid
              activities={activities}
              filtered={scope.filtered}
              singleSport={scope.singleSport}
              onOpenActivity={setDetailId}
              detailsOpen={Boolean(detailActivity)}
            />
          </div>
        </>
      )}
      {detailActivity && (
        <ActivityDetails
          activity={detailActivity}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// offsetTop ignores Motion's temporary transforms, so this measures the final
// layout even while desktop cards animate between their grid positions.
function layoutTop(element: HTMLElement, container: HTMLElement) {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current && current !== container) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

export function StatsTileGrid({
  activities,
  filtered = false,
  singleSport = false,
  onOpenActivity,
  detailsOpen = false,
}: {
  activities: StatsActivity[];
  filtered?: boolean;
  singleSport?: boolean;
  onOpenActivity?: (id: number) => void;
  detailsOpen?: boolean;
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
  const context: TileContext = useMemo(
    () => ({
      activities,
      today,
      filtered,
      singleSport,
      onOpenActivity,
      palette: tilePalette(resolvedTheme === 'dark'),
    }),
    [activities, today, resolvedTheme, filtered, singleSport, onOpenActivity],
  );

  const [expandedID, setExpandedID] = useState<StatsTileID | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ id: StatsTileID; top: number } | null>(null);
  const changeExpansion = useCallback(
    (id: StatsTileID | null) => {
      const container = scrollRef.current;
      const anchorID = id ?? expandedID;
      const card = container?.querySelector<HTMLElement>(
        `[data-tile-id="${anchorID}"]`,
      );
      if (container && card && anchorID) {
        scrollAnchor.current = {
          id: anchorID,
          top: layoutTop(card, container) - container.scrollTop,
        };
      }
      setExpandedID(id);
    },
    [expandedID],
  );

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const anchor = scrollAnchor.current;
    scrollAnchor.current = null;
    if (!container || !anchor) return;
    const card = container.querySelector<HTMLElement>(
      `[data-tile-id="${anchor.id}"]`,
    );
    if (card) {
      // Keep the selected header under the user's finger when a previously
      // expanded card above it shrinks. Adjust only this scroller, before paint.
      container.scrollTop = layoutTop(card, container) - anchor.top;
    }
  }, [expandedID]);

  // Inline details stay open while scrolling or interacting elsewhere. Only
  // the collapse control, Escape, or opening another tile changes expansion.
  useEffect(() => {
    if (!expandedID || detailsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      // A dialog may unmount before this event reaches window. Its original
      // propagation path still identifies Escape as belonging to that dialog.
      const fromDialog = event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element && node.getAttribute('role') === 'dialog',
        );
      if (event.key === 'Escape' && !event.defaultPrevented && !fromDialog) {
        document
          .querySelector<HTMLButtonElement>(
            `[data-tile-id="${expandedID}"] button[aria-expanded]`,
          )
          ?.focus({ preventScroll: true });
        changeExpansion(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [expandedID, detailsOpen, changeExpansion]);

  return (
    <motion.div
      ref={scrollRef}
      layoutScroll
      className="relative h-full w-full overflow-y-auto overscroll-y-contain [overflow-anchor:none]"
    >
      <Measure className="h-full w-full">
        {({ width }) => {
          const padding = width < 520 ? 12 : 16;
          return (
            <LayoutGroup>
              <div className="flex flex-col gap-5" style={{ padding }}>
                {statsTileGroups.map((group) => (
                  <BentoGroup
                    key={group.id}
                    title={group.title}
                    tiles={shownTiles.filter(
                      ({ tile }) => tile.group === group.id,
                    )}
                    width={width - 2 * padding}
                    context={context}
                    expandedID={expandedID}
                    onExpand={changeExpansion}
                    onCollapse={() => changeExpansion(null)}
                  />
                ))}
              </div>
            </LayoutGroup>
          );
        }}
      </Measure>
    </motion.div>
  );
}

const { regular, compact, narrow, gap } = statsTileLayout;

function BentoGroup({
  title,
  tiles,
  width,
  context,
  expandedID,
  onExpand,
  onCollapse,
}: {
  title: string;
  tiles: ShownTile[];
  width: number;
  context: TileContext;
  expandedID: StatsTileID | null;
  onExpand: (id: StatsTileID) => void;
  onCollapse: () => void;
}) {
  const grid =
    width >= regular.minWidth
      ? regular
      : width >= compact.minWidth
        ? compact
        : narrow;
  const reduceMotion = useReducedMotion();
  // A single-column list should stay anchored under the finger while changing
  // height; there is no sideways reflow to animate on narrow screens.
  const animateLayout = !reduceMotion && grid.columns > 1;
  // Collapsed, tiles pack as the manifest says. An expanded tile spans the
  // whole section in one content-sized row, starting on the row it was on,
  // so that row and the ones below move down; the other tiles keep their
  // size meanwhile.
  const collapsedPlacements = placeBento(
    tiles.map(({ tile }) => tile.span),
    grid.columns,
  );
  const expandedIndex = tiles.findIndex(({ tile }) => tile.id === expandedID);
  const order =
    expandedIndex < 0
      ? tiles.map((_, index) => index)
      : [
          ...tiles.flatMap((_, index) =>
            collapsedPlacements[index]!.row <
            collapsedPlacements[expandedIndex]!.row
              ? [index]
              : [],
          ),
          expandedIndex,
          ...tiles.flatMap((_, index) =>
            index !== expandedIndex &&
            collapsedPlacements[index]!.row >=
              collapsedPlacements[expandedIndex]!.row
              ? [index]
              : [],
          ),
        ];
  const placements =
    expandedIndex < 0
      ? collapsedPlacements
      : (() => {
          const placed = placeBento(
            order.map((index) =>
              index === expandedIndex
                ? { columns: grid.columns, rows: 1 }
                : tiles[index]!.tile.span,
            ),
            grid.columns,
            { fillGaps: false },
          );
          const byTile = new Array<(typeof placed)[number]>(tiles.length);
          order.forEach((index, position) => {
            byTile[index] = placed[position]!;
          });
          return byTile;
        })();
  const rowCount = Math.max(
    0,
    ...placements.map((placement) => placement.row + placement.rows - 1),
  );
  const expandedRow = expandedIndex < 0 ? null : placements[expandedIndex]!.row;
  if (tiles.length === 0) return null;

  return (
    <motion.section
      aria-label={title}
      layout={animateLayout ? 'position' : false}
    >
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div
        className="grid"
        style={{
          gap,
          gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          // The expanded tile sits in one row sized to its content; every
          // other row keeps the grid's row height.
          gridTemplateRows: Array.from({ length: rowCount }, (_, index) =>
            index + 1 === expandedRow ? 'auto' : `${grid.rowHeight}px`,
          ).join(' '),
        }}
      >
        {tiles.map(({ tile, view }, index) => {
          const placement = placements[index]!;
          return (
            <TileCard
              key={tile.id}
              tile={tile}
              view={view}
              context={context}
              animateLayout={animateLayout}
              large={'primary' in tile && tile.primary}
              expanded={tile.id === expandedID}
              onExpand={() => onExpand(tile.id)}
              onCollapse={onCollapse}
              style={{
                gridColumn: `${placement.column} / span ${placement.columns}`,
                gridRow: `${placement.row} / span ${placement.rows}`,
              }}
            />
          );
        })}
      </div>
    </motion.section>
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
  animateLayout,
  expanded,
  onExpand,
  onCollapse,
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  animateLayout: boolean;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  style: CSSProperties;
}) {
  const toggle = toggleOf(tile);
  // One switch state for both sizes, so expanding keeps the chosen metric.
  const [option, setOption] = useState<string | undefined>(
    toggleOf(tile)?.options[0],
  );
  const summary = view.summary(context, option);
  const hasDetail = expanded && Boolean(view.detail);

  // Keep the user's scroll position. scrollIntoView after an animation races
  // with touch scrolling and can also scroll the app's overflow-hidden shell.

  return (
    <motion.section
      layout={animateLayout}
      transition={layoutTransition}
      aria-label={tile.title}
      data-tile-id={tile.id}
      className={cn(
        'group @container relative min-w-0 overflow-hidden rounded-lg border bg-card text-left text-card-foreground',
        expanded ? 'shadow-md' : 'shadow-xs',
      )}
      style={style}
    >
      <motion.div
        layout={animateLayout ? 'position' : false}
        className={cn(
          'flex min-w-0 flex-col p-3.5',
          // Collapsed, the face fills the tile; expanded, the card sizes
          // itself to the content.
          !expanded && 'h-full',
        )}
      >
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium">{tile.title}</h3>
          {view.expandable && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tile.title}`}
              title={`${expanded ? 'Collapse' : 'Expand'} ${tile.title}`}
              onClick={(event) => {
                event.stopPropagation();
                if (expanded) onCollapse();
                else onExpand();
              }}
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? (
                <Minimize2 aria-hidden="true" className="size-3.5" />
              ) : (
                <Maximize2 aria-hidden="true" className="size-3.5" />
              )}
            </button>
          )}
        </div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[11px] text-muted-foreground">
            {hasDetail ? 'History & details' : view.period(context, option)}
          </span>
          {toggle && (
            <FaceSwitch
              label={`${tile.title}: ${toggle.label}`}
              options={toggle.options}
              value={option}
              onChange={setOption}
            />
          )}
        </div>
        {!hasDetail && summary && (
          <Headline summary={summary} size={large ? 'large' : 'tile'} />
        )}
        <Activity mode={hasDetail ? 'hidden' : 'visible'}>
          {view.face(context, option, expanded)}
        </Activity>
        {/* Preserve history controls while hidden; Activity suspends their effects. */}
        {view.detail && (
          <Activity mode={hasDetail ? 'visible' : 'hidden'}>
            {view.detail(context, option)}
          </Activity>
        )}
        {context.filtered && tile.id === 'consistency' && (
          <p className="mt-2 shrink-0 text-[11px] leading-snug text-muted-foreground">
            Filtered view: only matching activities count. Other activity may
            have occurred.
          </p>
        )}
        {expanded && !hasDetail && view.more && (
          <motion.div
            initial={animateLayout ? { opacity: 0 } : false}
            animate={{
              opacity: 1,
              transition: {
                delay: animateLayout ? 0.2 : 0,
                duration: animateLayout ? 0.2 : 0,
              },
            }}
          >
            {view.more(context, option)}
          </motion.div>
        )}
      </motion.div>
    </motion.section>
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
          {faceOptionLabels[option] ?? option}
        </button>
      ))}
    </div>
  );
}
