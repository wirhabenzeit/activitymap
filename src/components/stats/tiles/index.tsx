'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json.
// Every tile reads the activities the sidebar filters already narrowed down.
// Opening a tile shows its detail in a dialog over the grid, with the tile's
// one switch and arrows to step through the other tiles.

import { useMemo, useState, type CSSProperties } from 'react';
import { useTheme } from 'next-themes';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import {
  statsTileLayout,
  statsTiles,
  type StatsTile,
  type StatsTileID,
} from '~/settings/stats-tiles.generated';
import { placeBento } from '~/lib/stats/bento';
import { localToday, toStatsActivity } from '~/lib/stats/tile-series';
import { cn } from '~/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog';

import { Measure } from './charts';
import { tilePalette } from './format';
import {
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

export default function StatsTiles() {
  const { filteredActivities } = useFilteredActivities();
  const { resolvedTheme } = useTheme();
  const activities = useMemo(
    () => filteredActivities.map(toStatsActivity),
    [filteredActivities],
  );
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
  const [options, setOptions] = useState<Partial<Record<StatsTileID, string>>>(
    {},
  );

  const openIndex = shownTiles.findIndex(({ tile }) => tile.id === openID);
  const open = shownTiles[openIndex];
  const step = (by: number) =>
    setOpenID(
      shownTiles[(openIndex + by + shownTiles.length) % shownTiles.length]!.tile
        .id,
    );

  return (
    <>
      <Measure className="h-full w-full overflow-y-auto">
        {({ width }) => (
          <BentoGrid width={width} context={context} onOpen={setOpenID} />
        )}
      </Measure>
      <Dialog
        open={open !== undefined}
        onOpenChange={(isOpen) => !isOpen && setOpenID(null)}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-3xl gap-0 overflow-y-auto p-0"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') step(-1);
            if (event.key === 'ArrowRight') step(1);
          }}
        >
          {open && (
            <TileDetail
              tile={open.tile}
              view={open.view}
              context={context}
              option={options[open.tile.id] ?? toggleOf(open.tile)?.options[0]}
              setOption={(option) =>
                setOptions((previous) => ({
                  ...previous,
                  [open.tile.id]: option,
                }))
              }
              onStep={step}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BentoGrid({
  width,
  context,
  onOpen,
}: {
  width: number;
  context: TileContext;
  onOpen: (id: StatsTileID) => void;
}) {
  const padding = width < 520 ? 12 : 16;
  const regular = width - 2 * padding >= statsTileLayout.regular.minWidth;
  const grid = regular ? statsTileLayout.regular : statsTileLayout.compact;
  const placements = placeBento(
    shownTiles.map(({ tile }) => tile.span),
    grid.columns,
  );

  return (
    <div
      className="mx-auto grid max-w-[1120px]"
      style={{
        padding,
        gap: statsTileLayout.gap,
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridAutoRows: grid.rowHeight,
      }}
    >
      {shownTiles.map(({ tile, view }, index) => {
        const placement = placements[index]!;
        return (
          <TileFace
            key={tile.id}
            tile={tile}
            view={view}
            context={context}
            large={placement.rows > 1}
            onOpen={() => onOpen(tile.id)}
            style={{
              gridColumn: `${placement.column} / span ${placement.columns}`,
              gridRow: `${placement.row} / span ${placement.rows}`,
            }}
          />
        );
      })}
    </div>
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
          'truncate font-mono font-medium tabular-nums leading-tight tracking-tight',
          size === 'tile' && 'mt-1 text-[26px]',
          size === 'large' && 'mt-1 text-[36px]',
          size === 'detail' && 'text-[32px]',
        )}
      >
        {summary.value}
        {summary.unit && (
          <small className="ml-1 font-sans text-[13px] font-normal tracking-normal text-muted-foreground">
            {summary.unit}
          </small>
        )}
      </div>
      <div className="truncate text-xs text-muted-foreground">
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
  onOpen,
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  onOpen: () => void;
  style: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${tile.title}, open detail`}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card p-3.5 text-left text-card-foreground shadow-xs transition-colors hover:border-muted-foreground/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      style={style}
    >
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="shrink-0 text-[13px] font-medium">{tile.title}</span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {view.period(context)}
        </span>
      </div>
      <Headline
        summary={view.summary(context, toggleOf(tile)?.options[0])}
        size={large ? 'large' : 'tile'}
      />
      {view.face(context)}
    </button>
  );
}

function TileDetail({
  tile,
  view,
  context,
  option,
  setOption,
  onStep,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  option: string | undefined;
  setOption: (option: string) => void;
  onStep: (by: number) => void;
}) {
  const toggle = toggleOf(tile);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center gap-2 pr-8">
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label="Previous stat"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label="Next stat"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <DialogTitle className="ml-1 min-w-0 flex-1 truncate text-lg font-semibold">
          {tile.title}
        </DialogTitle>
        <DialogDescription className="whitespace-nowrap text-xs text-muted-foreground">
          {view.period(context)}
        </DialogDescription>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Headline summary={view.summary(context, option)} size="detail" />
        </div>
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
      {view.detail(context, option)}
    </div>
  );
}
