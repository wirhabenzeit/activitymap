'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json,
// one titled section per tile group (Now, This year, Patterns, and a
// collapsed More). Every tile reads the activities the sidebar filters
// already narrowed down. The grid fills the full width with the regular
// layout's columns, so tiles widen on big screens. Only primary tiles get
// the large headline numerals.
//
// Tiles are static summaries by default. The few with more to show expand
// in place: the card takes the full width of its section and as many rows
// as its detail needs, pushing the other cards down, and Motion animates
// the reflow. Clicking outside, Escape or the collapse button returns it.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTheme } from 'next-themes';
import { LayoutGroup, motion } from 'motion/react';
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';

import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import {
  statsTileGroups,
  statsTileLayout,
  statsTiles,
  type StatsTile,
  type StatsTileID,
} from '~/settings/stats-tiles.generated';
import { type StatsActivity } from '~/lib/stats/tile-data';
import { placeBento } from '~/lib/stats/bento';
import { localToday, toStatsActivity } from '~/lib/stats/tile-series';
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

type ShownTile = { tile: StatsTile; view: TileView };

const shownTiles: ShownTile[] = statsTiles.flatMap((tile) => {
  const view = tileView(tile.id);
  return view ? [{ tile, view }] : [];
});

// Only these tiles expand; the rest are summary indicators, so the page
// does not feel like every number is secretly a button.
const expandableIDs = new Set<StatsTileID>([
  'weeklyVolume',
  'yearToDate',
  'monthVsLastMonth',
  'activityCalendar',
  'distanceVsElevation',
  'sportMix',
]);

const toggleOf = (tile: StatsTile) => ('toggle' in tile ? tile.toggle : null);

const layoutTransition = {
  layout: { duration: 0.3, ease: [0.2, 0, 0, 1] as const },
};

export default function StatsTiles() {
  const { filteredActivities } = useFilteredActivities();
  const activities = useMemo(
    () => filteredActivities.map(toStatsActivity),
    [filteredActivities],
  );
  return <StatsTileGrid activities={activities} />;
}

export function StatsTileGrid({ activities }: { activities: StatsActivity[] }) {
  const { resolvedTheme } = useTheme();
  const today = useMemo(() => localToday(), []);
  const context: TileContext = useMemo(
    () => ({
      activities,
      today,
      palette: tilePalette(resolvedTheme === 'dark'),
    }),
    [activities, today, resolvedTheme],
  );

  const [expandedID, setExpandedID] = useState<StatsTileID | null>(null);
  const [expandedRows, setExpandedRows] = useState(3);

  // Escape or a press anywhere outside the expanded card collapses it. A
  // press on another expandable tile then expands that one instead.
  useEffect(() => {
    if (!expandedID) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedID(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(`[data-tile-id="${expandedID}"]`))
        setExpandedID(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [expandedID]);

  return (
    <Measure className="h-full w-full overflow-y-auto">
      {({ width }) => {
        const padding = width < 520 ? 12 : 16;
        return (
          <LayoutGroup>
            <div className="flex flex-col gap-5" style={{ padding }}>
              {statsTileGroups.map((group) => (
                <BentoGroup
                  key={group.id}
                  title={group.title}
                  collapsed={'collapsed' in group && group.collapsed}
                  tiles={shownTiles.filter(
                    ({ tile }) => tile.group === group.id,
                  )}
                  width={width - 2 * padding}
                  context={context}
                  expandedID={expandedID}
                  expandedRows={expandedRows}
                  onExpand={(id) => {
                    setExpandedRows(3);
                    setExpandedID(id);
                  }}
                  onCollapse={() => setExpandedID(null)}
                  onExpandedRows={setExpandedRows}
                />
              ))}
            </div>
          </LayoutGroup>
        );
      }}
    </Measure>
  );
}

const { regular, compact, gap } = statsTileLayout;

function BentoGroup({
  title,
  collapsed,
  tiles,
  width,
  context,
  expandedID,
  expandedRows,
  onExpand,
  onCollapse,
  onExpandedRows,
}: {
  title: string;
  collapsed: boolean;
  tiles: ShownTile[];
  width: number;
  context: TileContext;
  expandedID: StatsTileID | null;
  expandedRows: number;
  onExpand: (id: StatsTileID) => void;
  onCollapse: () => void;
  onExpandedRows: (rows: number) => void;
}) {
  const [folded, setFolded] = useState(collapsed);
  const grid = width >= regular.minWidth ? regular : compact;
  // Collapsed, tiles pack as the manifest says. An expanded tile spans the
  // whole section and as many rows as its detail needs, starting on the
  // row it was on, so that row and the ones below move down; the other
  // tiles keep their size meanwhile.
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
                ? { columns: grid.columns, rows: expandedRows }
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
  if (tiles.length === 0) return null;

  const heading = (
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {title}
    </h2>
  );
  return (
    <motion.section aria-label={title} layout="position">
      {collapsed ? (
        <button
          type="button"
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
          className="mb-2 flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          {heading}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              folded && '-rotate-90',
            )}
          />
        </button>
      ) : (
        <div className="mb-2">{heading}</div>
      )}
      {!folded && (
        <div
          className="grid"
          style={{
            gap,
            gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
            gridAutoRows: grid.rowHeight,
          }}
        >
          {tiles.map(({ tile, view }, index) => {
            const placement = placements[index]!;
            const expandable = expandableIDs.has(tile.id) && !!view.detail;
            return (
              <TileCard
                key={tile.id}
                tile={tile}
                view={view}
                context={context}
                large={'primary' in tile && tile.primary}
                expanded={tile.id === expandedID}
                onExpand={expandable ? () => onExpand(tile.id) : undefined}
                onCollapse={onCollapse}
                onHeight={(height) =>
                  onExpandedRows(
                    Math.max(
                      2,
                      Math.ceil((height + gap) / (grid.rowHeight + gap)),
                    ),
                  )
                }
                style={{
                  gridColumn: `${placement.column} / span ${placement.columns}`,
                  gridRow: `${placement.row} / span ${placement.rows}`,
                }}
              />
            );
          })}
        </div>
      )}
    </motion.section>
  );
}

function Headline({
  summary,
  size,
}: {
  summary: TileSummary;
  size: 'tile' | 'large' | 'detail';
}) {
  return (
    <>
      <div
        className={cn(
          'shrink-0 truncate font-mono font-medium tabular-nums leading-tight tracking-tight',
          size === 'tile' && 'mt-1 text-[20px]',
          size === 'large' && 'mt-1 text-[32px]',
          size === 'detail' && 'mt-1 text-[32px]',
        )}
      >
        {summary.value}
        {summary.unit && (
          <small className="ml-1 font-sans text-[13px] font-normal tracking-normal text-muted-foreground">
            {summary.unit}
          </small>
        )}
      </div>
      <div className="shrink-0 truncate text-xs text-muted-foreground">
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
  expanded,
  onExpand,
  onCollapse,
  onHeight,
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  expanded: boolean;
  // Set when the tile can expand.
  onExpand?: () => void;
  onCollapse: () => void;
  // The expanded content's natural height, so the grid can size its rows.
  onHeight: (height: number) => void;
  style: CSSProperties;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!expanded || !content) return;
    const observer = new ResizeObserver(() =>
      onHeight(content.getBoundingClientRect().height),
    );
    observer.observe(content);
    // Bring the whole expanded card into view once the reflow has settled.
    const scroll = window.setTimeout(
      () =>
        cardRef.current?.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        }),
      350,
    );
    return () => {
      observer.disconnect();
      window.clearTimeout(scroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const interactive = !!onExpand && !expanded;
  return (
    <motion.section
      ref={cardRef}
      layout
      transition={layoutTransition}
      aria-label={tile.title}
      aria-expanded={onExpand ? expanded : undefined}
      data-tile-id={tile.id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onExpand : undefined}
      onKeyDown={(event) => {
        if (
          interactive &&
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          onExpand?.();
        }
      }}
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-lg border bg-card text-left text-card-foreground',
        expanded ? 'shadow-md' : 'shadow-xs',
        interactive &&
          'cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
      )}
      style={style}
    >
      {expanded ? (
        <motion.div
          ref={contentRef}
          key="expanded"
          layout="position"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.15, duration: 0.2 } }}
        >
          <ExpandedTile
            tile={tile}
            view={view}
            context={context}
            onCollapse={onCollapse}
          />
        </motion.div>
      ) : (
        <motion.div
          key="face"
          layout="position"
          className="flex h-full min-w-0 flex-col p-3.5"
        >
          <TileFace tile={tile} view={view} context={context} large={large} />
        </motion.div>
      )}
      {interactive && (
        <Maximize2
          aria-hidden
          className="absolute bottom-2.5 right-2.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </motion.section>
  );
}

function TileFace({
  tile,
  view,
  context,
  large,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
}) {
  const [option, setOption] = useState(
    view.faceOptions?.[0] ?? toggleOf(tile)?.options[0],
  );
  const summary = view.summary(context, option);
  return (
    <>
      <div className="flex w-full items-baseline justify-between gap-2">
        <span
          className="min-w-0 truncate text-[13px] font-medium"
          title={view.period(context)}
        >
          {tile.title}
        </span>
        {view.faceOptions ? (
          <FaceSwitch
            label={`${tile.title} shows`}
            options={view.faceOptions}
            value={option}
            onChange={setOption}
          />
        ) : (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {view.period(context)}
          </span>
        )}
      </div>
      {summary && (
        <Headline summary={summary} size={large ? 'large' : 'tile'} />
      )}
      {view.face(context, option)}
    </>
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
            'rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground hover:text-foreground',
            option === value && 'bg-background text-foreground shadow-xs',
          )}
        >
          {faceOptionLabels[option] ?? option}
        </button>
      ))}
    </div>
  );
}

function ExpandedTile({
  tile,
  view,
  context,
  onCollapse,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  onCollapse: () => void;
}) {
  const toggle = toggleOf(tile);
  const [option, setOption] = useState<string | undefined>(toggle?.options[0]);
  const summary = view.summary(context, option);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {tile.title}
        </h3>
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {view.period(context)}
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={`Collapse ${tile.title}`}
          className="-my-1 grid h-6 w-6 shrink-0 place-items-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {summary && (
          <div className="min-w-0">
            <Headline summary={summary} size="detail" />
          </div>
        )}
        {toggle && (
          <div
            role="group"
            aria-label={toggle.label}
            className="inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted p-0.5"
          >
            {toggle.options.map((value: string) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === option}
                onClick={() => setOption(value)}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-muted-foreground hover:text-foreground',
                  value === option && 'bg-background text-foreground shadow-xs',
                )}
              >
                {optionLabels[value] ?? value}
              </button>
            ))}
          </div>
        )}
      </div>
      {view.detail?.(context, option)}
    </div>
  );
}
