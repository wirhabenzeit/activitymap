'use client';

// The tile-based stats view: the bento grid from shared/stats-tiles.json.
// Every tile reads the activities the sidebar filters already narrowed down.
// Opening a tile expands it in place to the full grid width with its one
// switch; the other tiles reflow underneath.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTheme } from 'next-themes';
import { X } from 'lucide-react';

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

  useEffect(() => {
    if (!openID) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenID(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openID]);

  return (
    <Measure className="h-full w-full overflow-y-auto">
      {({ width }) => (
        <BentoGrid
          width={width}
          context={context}
          openID={openID}
          setOpenID={setOpenID}
          options={options}
          setOption={(id, option) =>
            setOptions((previous) => ({ ...previous, [id]: option }))
          }
        />
      )}
    </Measure>
  );
}

function BentoGrid({
  width,
  context,
  openID,
  setOpenID,
  options,
  setOption,
}: {
  width: number;
  context: TileContext;
  openID: StatsTileID | null;
  setOpenID: (id: StatsTileID | null) => void;
  options: Partial<Record<StatsTileID, string>>;
  setOption: (id: StatsTileID, option: string) => void;
}) {
  const padding = width < 520 ? 12 : 16;
  const regular = width - 2 * padding >= statsTileLayout.regular.minWidth;
  const grid = regular ? statsTileLayout.regular : statsTileLayout.compact;
  const gap = statsTileLayout.gap;

  // The open tile spans the full width and as many rows as its content needs.
  const [openRows, setOpenRows] = useState(3);
  const placements = placeBento(
    shownTiles.map(({ tile }) =>
      tile.id === openID
        ? { columns: grid.columns, rows: openRows }
        : tile.span,
    ),
    grid.columns,
  );

  return (
    <div
      className="mx-auto grid max-w-[1120px]"
      style={{
        padding,
        gap,
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridAutoRows: grid.rowHeight,
      }}
    >
      {shownTiles.map(({ tile, view }, index) => {
        const placement = placements[index]!;
        const style: CSSProperties = {
          gridColumn: `${placement.column} / span ${placement.columns}`,
          gridRow: `${placement.row} / span ${placement.rows}`,
        };
        return tile.id === openID ? (
          <TileDetail
            key={tile.id}
            tile={tile}
            view={view}
            context={context}
            option={options[tile.id] ?? toggleOf(tile)?.options[0]}
            setOption={(option) => setOption(tile.id, option)}
            onClose={() => setOpenID(null)}
            onHeight={(height) =>
              setOpenRows(
                Math.max(2, Math.ceil((height + gap) / (grid.rowHeight + gap))),
              )
            }
            style={style}
          />
        ) : (
          <TileFace
            key={tile.id}
            tile={tile}
            view={view}
            context={context}
            large={placement.rows > 1}
            onOpen={() => setOpenID(tile.id)}
            style={style}
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
  onClose,
  onHeight,
  style,
}: {
  tile: StatsTile;
  view: TileView;
  context: TileContext;
  option: string | undefined;
  setOption: (option: string) => void;
  onClose: () => void;
  onHeight: (height: number) => void;
  style: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const toggle = toggleOf(tile);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) onHeight(entry.target.getBoundingClientRect().height);
    });
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      aria-label={tile.title}
      className="min-w-0 rounded-lg border bg-card text-card-foreground shadow-xs"
      style={style}
    >
      <div ref={ref} className="flex flex-col gap-3.5 px-4 pb-5 pt-4">
        <div className="flex items-center gap-2.5">
          <h2 className="flex-1 truncate text-base font-semibold">
            {tile.title}
          </h2>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {view.period(context)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md border text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
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
                    value === option &&
                      'bg-background text-foreground shadow-xs',
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
    </section>
  );
}
