'use client';

// Most visited places (#461): a ranking of peaks, passes or huts by the
// distinct activities whose synced route places include them. The compact
// face shows this year's top five; the focus view adds All time and a bounded
// ranking. Rows open the shared place detail, which owns Show activities /
// Show on map.
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { PlaceSymbol } from '~/components/place-symbol';
import { useBrowsingState } from '~/hooks/use-browsing-context';
import type { Activity } from '~/lib/activity';
import { formatPreferredDate } from '~/lib/date-preferences';
import {
  PLACE_RANKING_COMPACT_LIMIT,
  PLACE_RANKING_LIMIT,
  type PlaceRanking,
  type PlaceRankingRange,
  rankVisitedPlaces,
} from '~/lib/place-ranking';
import type { PlaceKind } from '~/lib/place-symbols';
import { dateOfDay } from '~/lib/stats/tile-series';
import { measurementScale, measurementUnit } from '~/lib/units';
import { cn } from '~/lib/utils';

import { StatsChoices } from './choices';
import type { TileContext, TileView } from './tiles';

export type StatsPlaceSource = {
  // The Stats-filtered activities, with their synced place bundles.
  activities: readonly Pick<
    Activity,
    'id' | 'start_date_local' | 'placeMatches'
  >[];
  userId: string | undefined;
  historyComplete: boolean;
  onOpenPlace?: (id: string) => void;
};

const kindOf = (option: string | undefined): PlaceKind =>
  option === 'pass' || option === 'hut' ? option : 'peak';

const plural: Record<PlaceKind, string> = {
  peak: 'peaks',
  pass: 'passes',
  hut: 'huts',
};

// Hut matches describe the route passing nearby, never entry or a stay.
export const placeRankingExplanation = (kind: PlaceKind) =>
  kind === 'hut'
    ? 'Counts activities whose route passed near each hut, once per activity. A match does not mean you stopped or stayed there.'
    : `Counts activities whose route passed each ${kind}, once per activity; passing it several times on one route still counts once.`;

const rangeLabel = (range: PlaceRankingRange, today: number) =>
  range === 'allTime' ? 'All time' : String(dateOfDay(today).getUTCFullYear());

function useRanking(
  context: TileContext,
  kind: PlaceKind,
  range: PlaceRankingRange,
  limit: number,
): PlaceRanking | null {
  const { places, today } = context;
  return useMemo(
    () =>
      places
        ? rankVisitedPlaces(places.activities, {
            userId: places.userId,
            today,
            kind,
            range,
            historyComplete: places.historyComplete,
            limit,
          })
        : null,
    [places, today, kind, range, limit],
  );
}

// Unknown results are never presented as "not visited".
function coverageNote(
  ranking: PlaceRanking,
  kind: PlaceKind,
  range: PlaceRankingRange,
  historyComplete: boolean,
) {
  const period = range === 'allTime' ? '' : ' this year';
  if (ranking.activities === 0)
    return historyComplete
      ? `No activities${period}.`
      : 'Activity history is still loading.';
  if (ranking.exhaustive)
    return ranking.total === 0
      ? `No ${plural[kind]} on your routes${period}.`
      : null;
  const unchecked = ranking.activities - ranking.checked;
  if (unchecked === 0)
    return 'Activity history is still loading; this ranking may be incomplete.';
  const awaiting = `${unchecked} of ${ranking.activities} ${ranking.activities === 1 ? 'activity has' : 'activities have'} no completed place check yet`;
  return ranking.total === 0
    ? `No ${plural[kind]} found yet: ${awaiting}.`
    : `May be incomplete: ${awaiting}.`;
}

function PlaceRankingList({
  context,
  ranking,
  kind,
  range,
  expanded,
}: {
  context: TileContext;
  ranking: PlaceRanking;
  kind: PlaceKind;
  range: PlaceRankingRange;
  expanded: boolean;
}) {
  const units = context.units ?? 'metric';
  const open = context.places?.onOpenPlace;
  const label = `Most visited ${plural[kind]} · ${rangeLabel(range, context.today)}`;
  return (
    <ol aria-label={label} className={cn('min-w-0', expanded && 'divide-y')}>
      {ranking.rows.map(({ place, rank }) => {
        const count = `${place.activityCount} ${place.activityCount === 1 ? 'activity' : 'activities'}`;
        const elevation =
          place.elevationM != null
            ? `${Math.round(place.elevationM / measurementScale('elevation', units)).toLocaleString()} ${measurementUnit('elevation', units)}`
            : null;
        const latest = formatPreferredDate(
          place.latestVisit,
          context.dateFormat,
        );
        const content = (
          <>
            <span
              className="w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
              aria-hidden
            >
              {rank}
            </span>
            <PlaceSymbol kind={kind} className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'text-[13px] leading-5',
                  expanded ? 'break-words' : 'line-clamp-2 break-words',
                )}
              >
                {place.name}
              </span>
              {expanded && (
                <span className="text-[11px] leading-4 text-muted-foreground">
                  {[elevation, `Latest ${latest}`].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            {!expanded && elevation && (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums @max-[300px]:hidden">
                {elevation}
              </span>
            )}
            <span className="shrink-0 text-right font-mono text-[13px] font-medium tabular-nums">
              {place.activityCount}
              <span className="ml-1 font-sans text-[11px] font-normal text-muted-foreground @max-[360px]:sr-only">
                {place.activityCount === 1 ? 'activity' : 'activities'}
              </span>
            </span>
            {open && (
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground @max-[240px]:hidden"
              />
            )}
          </>
        );
        const name = `${rank}. ${place.name}${elevation ? `, ${elevation}` : ''}, ${count}`;
        return (
          <li key={place.id} data-place-id={place.id}>
            {open ? (
              <button
                type="button"
                aria-label={`${name}. View place details`}
                onClick={() => open(place.id)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
                  expanded ? 'min-h-12 px-1 py-2' : 'min-h-8 px-1',
                )}
              >
                {content}
              </button>
            ) : (
              <div
                aria-label={name}
                className={cn(
                  'flex min-w-0 items-center gap-2 px-1',
                  expanded ? 'min-h-12 py-2' : 'min-h-8',
                )}
              >
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CompactPlaces({
  context,
  kind,
}: {
  context: TileContext;
  kind: PlaceKind;
}) {
  const ranking = useRanking(
    context,
    kind,
    'currentYear',
    PLACE_RANKING_COMPACT_LIMIT,
  );
  if (!ranking)
    return (
      <p className="text-xs text-muted-foreground">
        Place visits appear once activities sync.
      </p>
    );
  const note = coverageNote(
    ranking,
    kind,
    'currentYear',
    context.places?.historyComplete ?? false,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5" data-place-ranking>
      <p className="sr-only">{placeRankingExplanation(kind)}</p>
      <PlaceRankingList
        context={context}
        ranking={ranking}
        kind={kind}
        range="currentYear"
        expanded={false}
      />
      {note && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {note}
        </p>
      )}
      {ranking.total > ranking.rows.length && (
        <p className="mt-auto text-[11px] text-muted-foreground">
          Top {ranking.rows.length} of {ranking.total} {plural[kind]}
        </p>
      )}
    </div>
  );
}

function PlacesDetail({
  context,
  kind,
}: {
  context: TileContext;
  kind: PlaceKind;
}) {
  const [range, setRange] = useBrowsingState(
    'stats:placesPeriod',
    'currentYear',
  );
  const ranking = useRanking(context, kind, range, PLACE_RANKING_LIMIT);
  const note =
    ranking &&
    coverageNote(
      ranking,
      kind,
      range,
      context.places?.historyComplete ?? false,
    );
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-place-ranking>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {context.filtered ? 'Filtered activities' : 'Across all sports'}
          {' · '}
          {rangeLabel(range, context.today)}
        </p>
        <StatsChoices
          label="Most visited places period"
          options={['currentYear', 'allTime'] as const}
          value={range}
          onChange={setRange}
          accessibleLabel={(value) =>
            value === 'allTime' ? 'All time' : 'This year'
          }
          visibleLabel={(value) =>
            value === 'allTime' ? 'All time' : 'This year'
          }
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {placeRankingExplanation(kind)}
      </p>
      {!ranking ? (
        <p className="text-sm text-muted-foreground">
          Place visits appear once activities sync.
        </p>
      ) : (
        <>
          {note && (
            <p role="status" className="text-sm text-muted-foreground">
              {note}
            </p>
          )}
          <PlaceRankingList
            context={context}
            ranking={ranking}
            kind={kind}
            range={range}
            expanded
          />
          {ranking.total > ranking.rows.length && (
            <p className="text-xs text-muted-foreground">
              Showing the top {ranking.rows.length} of {ranking.total}{' '}
              {plural[kind]}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export const visitedPlacesView: TileView = {
  expandable: true,
  compactPeriod: (_, option) =>
    kindOf(option) === 'hut'
      ? 'This year · routes passing nearby'
      : 'This year · by activities',
  period: ({ today }) => `${dateOfDay(today).getUTCFullYear()} · by activities`,
  expandedPeriod: null,
  summary: () => null,
  face: (context, option) => (
    <CompactPlaces context={context} kind={kindOf(option)} />
  ),
  detail: (context, option) => (
    <PlacesDetail context={context} kind={kindOf(option)} />
  ),
};
