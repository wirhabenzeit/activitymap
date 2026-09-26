'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json,
// one titled section per tile group (Now, This year, Patterns). Every tile
// reads the activities the sidebar filters already narrowed down. The grid
// fills the full width with the regular layout's columns, so tiles widen on
// big screens. Only primary tiles get the large headline numerals. Tiles are
// not interactive for now; their detail views stay in ./tiles for later.

import { useMemo, useState, type CSSProperties } from 'react';
import { useTheme } from 'next-themes';

import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import {
  statsTileGroups,
  statsTileLayout,
  statsTiles,
  type StatsTile,
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

  return (
    <Measure className="h-full w-full overflow-y-auto">
      {({ width }) => {
        const padding = width < 520 ? 12 : 16;
        return (
          <div className="flex flex-col gap-5" style={{ padding }}>
            {statsTileGroups.map((group) => (
              <BentoGroup
                key={group.id}
                title={group.title}
                tiles={shownTiles.filter(({ tile }) => tile.group === group.id)}
                width={width - 2 * padding}
                context={context}
              />
            ))}
          </div>
        );
      }}
    </Measure>
  );
}

const { regular, compact, gap } = statsTileLayout;

function BentoGroup({
  title,
  tiles,
  width,
  context,
}: {
  title: string;
  tiles: ShownTile[];
  width: number;
  context: TileContext;
}) {
  const grid = width >= regular.minWidth ? regular : compact;
  const placements = placeBento(
    tiles.map(({ tile }) => tile.span),
    grid.columns,
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
