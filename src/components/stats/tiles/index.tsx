'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json,
// one titled section per tile group (Now, This year, Patterns, and a
// collapsed More). Every tile reads the activities the sidebar filters
// already narrowed down. The grid fills the full width with the regular
// layout's columns, so tiles widen on big screens. Only primary tiles get
// the large headline numerals.
//
// Every tile expands in place: the card takes the full width of its
// section in a row sized to its content, pushing the other cards down, and
// Motion animates the reflow. Expanded, a tile is the same tile drawn
// larger (the same headline and visual, with axes on charts), plus any
// extra context the tile has. Clicking outside, Escape or the collapse
// button returns it.

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
                  onExpand={setExpandedID}
                  onCollapse={() => setExpandedID(null)}
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
  onExpand,
  onCollapse,
}: {
  title: string;
  collapsed: boolean;
  tiles: ShownTile[];
  width: number;
  context: TileContext;
  expandedID: StatsTileID | null;
  onExpand: (id: StatsTileID) => void;
  onCollapse: () => void;
}) {
  const [folded, setFolded] = useState(collapsed);
  const grid = width >= regular.minWidth ? regular : compact;
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
      )}
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
          'shrink-0 truncate font-mono font-medium tabular-nums leading-tight tracking-tight',
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
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  style: CSSProperties;
}) {
  const cardRef = useRef<HTMLElement>(null);
  // One switch state for both sizes, so expanding keeps the chosen metric.
  const [option, setOption] = useState(
    view.faceOptions?.[0] ?? toggleOf(tile)?.options[0],
  );
  const summary = view.summary(context, option);

  useEffect(() => {
    if (!expanded) return;
    // Bring the whole expanded card into view once the reflow has settled.
    const scroll = window.setTimeout(
      () =>
        cardRef.current?.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        }),
      350,
    );
    return () => window.clearTimeout(scroll);
  }, [expanded]);

  return (
    <motion.section
      ref={cardRef}
      layout
      transition={layoutTransition}
      aria-label={tile.title}
      aria-expanded={expanded}
      data-tile-id={tile.id}
      role={expanded ? undefined : 'button'}
      tabIndex={expanded ? undefined : 0}
      onClick={expanded ? undefined : onExpand}
      onKeyDown={(event) => {
        if (
          !expanded &&
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          onExpand();
        }
      }}
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-lg border bg-card text-left text-card-foreground',
        expanded
          ? 'shadow-md'
          : 'cursor-pointer shadow-xs transition-shadow hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
      )}
      style={style}
    >
      <motion.div
        layout="position"
        className={cn(
          'flex min-w-0 flex-col p-3.5',
          // Collapsed, the face fills the tile; expanded, the card sizes
          // itself to the content.
          !expanded && 'h-full',
        )}
      >
        <div className="flex w-full items-baseline justify-between gap-2">
          <span
            className="min-w-0 truncate text-[13px] font-medium"
            title={view.period(context)}
          >
            {tile.title}
          </span>
          <div className="flex min-w-0 items-baseline gap-2">
            {(expanded || !view.faceOptions) && (
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {view.period(context)}
              </span>
            )}
            {view.faceOptions && (
              <FaceSwitch
                label={`${tile.title} shows`}
                options={view.faceOptions}
                value={option}
                onChange={setOption}
              />
            )}
            {expanded && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label={`Collapse ${tile.title}`}
                className="-my-1 grid h-6 w-6 shrink-0 place-items-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {summary && (
          <Headline summary={summary} size={large ? 'large' : 'tile'} />
        )}
        {view.face(context, option, expanded)}
        {expanded && view.more && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.2, duration: 0.2 } }}
          >
            {view.more(context, option)}
          </motion.div>
        )}
      </motion.div>
      {!expanded && (
        <Maximize2
          aria-hidden
          className="absolute bottom-2.5 right-2.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
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
