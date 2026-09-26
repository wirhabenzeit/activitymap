'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json,
// one titled section per tile group (Now, This year, Patterns, and a
// collapsed More). Every tile reads the activities the sidebar filters
// already narrowed down. The grid fills the full width with the regular
// layout's columns, so tiles widen on big screens. Only primary tiles get
// the large headline numerals.
//
// Two layers: a tile shows one headline, one comparison and one small
// visual. Tiles with a detail view open it in a side panel next to the grid
// (over it on narrow screens), so the dashboard stays in view.

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useTheme } from 'next-themes';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

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

// The tiles a detail panel can step through, in page order.
const detailTiles = statsTileGroups.flatMap((group) =>
  shownTiles.filter(({ tile, view }) => tile.group === group.id && view.detail),
);

const toggleOf = (tile: StatsTile) => ('toggle' in tile ? tile.toggle : null);

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

  const [openID, setOpenID] = useState<StatsTileID | null>(null);
  const openIndex = detailTiles.findIndex(({ tile }) => tile.id === openID);
  const open = detailTiles[openIndex];
  const step = (by: number) =>
    setOpenID(
      detailTiles[(openIndex + by + detailTiles.length) % detailTiles.length]!
        .tile.id,
    );

  useEffect(() => {
    if (!openID) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpenID(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openID]);

  return (
    <div className="relative flex h-full w-full">
      <Measure className="h-full min-w-0 flex-1 overflow-y-auto">
        {({ width }) => {
          const padding = width < 520 ? 12 : 16;
          return (
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
                  openID={openID}
                  onOpen={setOpenID}
                />
              ))}
            </div>
          );
        }}
      </Measure>
      {open && (
        <aside
          aria-label={`${open.tile.title} details`}
          className="absolute inset-0 z-20 overflow-y-auto bg-background md:static md:w-[440px] md:shrink-0 md:border-l"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') step(-1);
            if (event.key === 'ArrowRight') step(1);
          }}
        >
          <TileDetail
            key={open.tile.id}
            tile={open.tile}
            view={open.view}
            context={context}
            onStep={step}
            onClose={() => setOpenID(null)}
          />
        </aside>
      )}
    </div>
  );
}

const { regular, compact, gap } = statsTileLayout;

function BentoGroup({
  title,
  collapsed,
  tiles,
  width,
  context,
  openID,
  onOpen,
}: {
  title: string;
  collapsed: boolean;
  tiles: ShownTile[];
  width: number;
  context: TileContext;
  openID: StatsTileID | null;
  onOpen: (id: StatsTileID) => void;
}) {
  const [folded, setFolded] = useState(collapsed);
  const grid = width >= regular.minWidth ? regular : compact;
  const placements = placeBento(
    tiles.map(({ tile }) => tile.span),
    grid.columns,
  );
  if (tiles.length === 0) return null;

  const heading = (
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {title}
    </h2>
  );
  return (
    <section aria-label={title}>
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
            return (
              <TileFace
                key={tile.id}
                tile={tile}
                view={view}
                context={context}
                large={'primary' in tile && tile.primary}
                selected={tile.id === openID}
                onOpen={view.detail ? () => onOpen(tile.id) : undefined}
                style={{
                  gridColumn: `${placement.column} / span ${placement.columns}`,
                  gridRow: `${placement.row} / span ${placement.rows}`,
                }}
              />
            );
          })}
        </div>
      )}
    </section>
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
          size === 'detail' && 'text-[28px]',
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

function TileFace({
  tile,
  view,
  context,
  large,
  selected,
  onOpen,
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  selected: boolean;
  // Set when the tile has a detail view to open.
  onOpen?: () => void;
  style: CSSProperties;
}) {
  const [option, setOption] = useState(
    view.faceOptions?.[0] ?? toggleOf(tile)?.options[0],
  );
  const summary = view.summary(context, option);
  return (
    <section
      aria-label={tile.title}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-pressed={onOpen ? selected : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          onOpen &&
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card p-3.5 text-left text-card-foreground shadow-xs',
        onOpen &&
          'cursor-pointer transition-colors hover:border-muted-foreground/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-foreground/60 ring-1 ring-foreground/60',
      )}
      style={style}
    >
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
  return (
    <div
      role="group"
      aria-label={label}
      className="-my-1 inline-flex shrink-0 self-center rounded-md bg-muted p-0.5"
      // Switching the face must not open the tile's detail.
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

function TileDetail({
  tile,
  view,
  context,
  onStep,
  onClose,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  const toggle = toggleOf(tile);
  const [option, setOption] = useState<string | undefined>(toggle?.options[0]);
  const summary = view.summary(context, option);
  const iconButton =
    'grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground';
  return (
    <div className="flex min-w-0 flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label="Previous tile"
          className={iconButton}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label="Next tile"
          className={iconButton}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <h2 className="ml-1 min-w-0 flex-1 truncate text-base font-semibold">
          {tile.title}
        </h2>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {view.period(context)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className={iconButton}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {summary && (
        <div className="min-w-0">
          <Headline summary={summary} size="detail" />
        </div>
      )}
      {toggle && (
        <div
          role="group"
          aria-label={toggle.label}
          className="inline-flex flex-wrap gap-0.5 self-start rounded-lg border bg-muted p-0.5"
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
      {view.detail?.(context, option)}
    </div>
  );
}
