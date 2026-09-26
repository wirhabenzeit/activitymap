'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json.
// Every tile reads the activities the sidebar filters already narrowed down.
// The grid fills the full width: on wide screens it adds columns (never
// narrower than the regular layout's) and the tiles reflow into them. Tiles
// are not interactive for now; their detail views stay in ./tiles for later.

import { useMemo, useState, type CSSProperties } from 'react';
import { useTheme } from 'next-themes';

import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import {
  statsTileLayout,
  statsTiles,
  type StatsTile,
} from '~/settings/stats-tiles.generated';
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

  return (
    <Measure className="h-full w-full overflow-y-auto">
      {({ width }) => <BentoGrid width={width} context={context} />}
    </Measure>
  );
}

// The regular layout's column width is the narrowest a column gets when the
// grid adds columns on wide screens.
const { regular, compact, gap } = statsTileLayout;
const minColumnWidth =
  (regular.minWidth - (regular.columns - 1) * gap) / regular.columns;

function gridFor(available: number) {
  if (available < regular.minWidth) return compact;
  const columns = Math.floor((available + gap) / (minColumnWidth + gap));
  return { ...regular, columns: Math.max(regular.columns, columns) };
}

function BentoGrid({
  width,
  context,
}: {
  width: number;
  context: TileContext;
}) {
  const padding = width < 520 ? 12 : 16;
  const grid = gridFor(width - 2 * padding);
  const placements = placeBento(
    shownTiles.map(({ tile }) => tile.span),
    grid.columns,
  );

  return (
    <div
      className="grid"
      style={{
        padding,
        gap,
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
  size: 'tile' | 'large';
}) {
  return (
    <>
      <div
        className={cn(
          'shrink-0 truncate font-mono font-medium tabular-nums leading-tight tracking-tight',
          size === 'tile' && 'mt-1 text-[26px]',
          size === 'large' && 'mt-1 text-[36px]',
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
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  large: boolean;
  style: CSSProperties;
}) {
  const [option, setOption] = useState(
    view.faceOptions?.[0] ?? toggleOf(tile)?.options[0],
  );
  return (
    <section
      aria-label={tile.title}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card p-3.5 text-left text-card-foreground shadow-xs"
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
      <Headline
        summary={view.summary(context, option)}
        size={large ? 'large' : 'tile'}
      />
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
