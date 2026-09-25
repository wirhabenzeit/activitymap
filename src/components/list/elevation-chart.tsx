'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { areaY, defineChart, lineY } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { Loader2 } from 'lucide-react';

import {
  activityStreamSummariesDTOSchema,
  activityStreamSummaryDTOSchema,
  type ActivityStreamSummaryDTO,
} from '~/contracts/v1/activity-streams';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import { Button } from '~/components/ui/button';

type StreamResult = {
  profile: { altitude: number[]; distance: number[] } | null;
  pending: boolean;
  retryAfterMs: number;
};

const summaryKey = (userId: string, activityId: string) => [
  'activity-stream-summary',
  userId,
  activityId,
];

function toProfile({
  metadata,
  summary,
}: ActivityStreamSummaryDTO): StreamResult['profile'] {
  // Summary series are index-aligned; the chart still needs forward distance.
  const distance = summary?.distance;
  const altitude = summary?.altitude;
  if (metadata.state !== 'current' || !distance || !altitude) return null;
  const forward =
    distance.length > 1 &&
    distance[distance.length - 1]! > distance[0]! &&
    distance.every(
      (value, index) => index === 0 || value >= distance[index - 1]!,
    );
  return forward ? { altitude, distance } : null;
}

async function fetchSummary(
  activityId: string,
  signal: AbortSignal,
): Promise<StreamResult> {
  const response = await fetch(
    `/api/v1/activities/${activityId}/streams/summary`,
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    },
  );
  const body: unknown = await response.json();

  if (!response.ok) {
    const error = errorEnvelopeSchema.safeParse(body);
    if (response.status === 429)
      throw new Error('Stream requests are limited. Try again later.');
    if (response.status === 404)
      throw new Error('Elevation data is unavailable for this activity.');
    throw new Error(
      error.success
        ? error.data.error.message
        : 'Could not load elevation data.',
    );
  }

  const parsed = responseEnvelope(activityStreamSummaryDTOSchema).safeParse(
    body,
  );
  if (!parsed.success) throw new Error('Could not read elevation data.');

  const retryAfter = Number(response.headers.get('Retry-After'));
  return {
    profile: toProfile(parsed.data.data),
    pending: response.status === 202,
    retryAfterMs:
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : 3000,
  };
}

const PREFETCH_BATCH = 100;

/**
 * Loads the stored summaries of the given activities in batches so their
 * cards open instantly. Never triggers a Strava fetch: activities without a
 * stored set are left for the chart to load when opened.
 */
export function usePrefetchStreamSummaries(
  activityIds: number[],
  userId: string | undefined,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const missing = activityIds
      .map(String)
      .filter((id) => !queryClient.getQueryData(summaryKey(userId, id)));
    if (missing.length === 0) return;
    const controller = new AbortController();
    for (let start = 0; start < missing.length; start += PREFETCH_BATCH) {
      const ids = missing.slice(start, start + PREFETCH_BATCH);
      void fetch(`/api/v1/stream-summaries?ids=${ids.join(',')}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const parsed = responseEnvelope(
            activityStreamSummariesDTOSchema,
          ).safeParse(await response.json());
          if (!parsed.success) return;
          for (const entry of parsed.data.data.summaries) {
            if (entry.metadata.state !== 'current') continue;
            queryClient.setQueryData<StreamResult>(
              summaryKey(userId, entry.activity_id),
              { profile: toProfile(entry), pending: false, retryAfterMs: 0 },
            );
          }
        })
        // Prefetching is best effort; the chart loads on its own when opened.
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [activityIds, userId, queryClient]);
}

function ElevationPlot({
  profile,
  height = 118,
}: {
  profile: NonNullable<StreamResult['profile']>;
  height?: number;
}) {
  const plot = useMemo(() => {
    const { altitude, distance } = profile;
    const start = distance[0]!;
    const total = distance[distance.length - 1]! - start;
    const axisUnit = total < 1000 ? 'm' : 'km';
    const axisTotal = axisUnit === 'km' ? total / 1000 : total;
    const distanceUnit = axisUnit === 'km' ? 1000 : 1;
    let min = Infinity;
    let max = -Infinity;
    for (const value of altitude) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const rows = altitude.map((value, index) => ({
      distance: (distance[index]! - start) / distanceUnit,
      altitude: value,
    }));
    const metres = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    });
    const distanceFormat = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    });
    const padding = Math.max((max - min) * 0.08, 1);
    const definition = defineChart({
      marks: [
        areaY(rows, {
          x: 'distance',
          y1: min,
          y2: 'altitude',
          fill: 'hsl(var(--primary))',
          fillOpacity: 0.12,
        }),
        lineY(rows, {
          x: 'distance',
          y: 'altitude',
          stroke: 'hsl(var(--primary))',
          strokeWidth: 1.5,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([0, axisTotal]),
          axis: {
            line: false,
            ticks: {
              count: 3,
              size: 4,
              format: (value: number) =>
                value === 0
                  ? '0'
                  : `${distanceFormat.format(value)} ${axisUnit}`,
            },
            tickLabels: { fontSize: 12 },
          },
        },
        y: {
          scale: scaleLinear().domain([min - padding, max + padding]),
          grid: { strokeDasharray: '3 4', strokeOpacity: 0.2 },
          axis: {
            line: false,
            ticks: {
              values: min === max ? [min] : [min, max],
              size: 0,
              format: (value: number) => `${metres.format(value)} m`,
            },
            tickLabels: { fontSize: 12, thin: false },
          },
        },
      },
    });
    return {
      min,
      max,
      total,
      definition,
    };
  }, [profile]);

  const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

  return (
    <Chart
      definition={plot.definition}
      height={height}
      initialWidth={304}
      className="w-full text-muted-foreground"
      ariaLabel={`Elevation profile from ${metres.format(plot.min)} to ${metres.format(plot.max)} metres over ${(plot.total / 1000).toFixed(1)} kilometres`}
    />
  );
}

export function ElevationChart({
  activityId,
  userId,
  compact = false,
}: {
  activityId: string;
  userId: string;
  compact?: boolean;
}) {
  const query = useQuery({
    queryKey: summaryKey(userId, activityId),
    queryFn: ({ signal }) => fetchSummary(activityId, signal),
    retry: false,
    // Stored streams rarely change, and edits invalidate them on the server;
    // a background check after a minute is plenty.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (current) =>
      current.state.status !== 'error' && current.state.data?.pending
        ? current.state.data.retryAfterMs
        : false,
  });

  const profile = query.data?.profile;
  const height = compact ? 135 : 118;

  return (
    <section
      className={
        compact ? 'border-t pt-3 lg:border-t-0 lg:pt-0' : 'border-t pt-3'
      }
      aria-label="Elevation profile"
    >
      <h3 className="mb-2 text-sm font-semibold">Elevation profile</h3>
      {/* Every state takes the chart's height so the card never resizes. */}
      <div style={{ height }}>
        {profile ? (
          // Keep showing the last profile while it revalidates in the background.
          <ElevationPlot profile={profile} height={height} />
        ) : query.isError ? (
          <div className="flex h-full flex-col items-start justify-center gap-2 rounded-md bg-muted/40 px-3">
            <p className="text-xs text-muted-foreground">
              {query.error.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : query.isPending || query.data?.pending ? (
          <div
            className="flex h-full animate-pulse items-center justify-center gap-2 rounded-md bg-muted/60 text-xs text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading elevation samples…
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md bg-muted/40 px-3 text-center text-xs text-muted-foreground">
            Elevation by distance is unavailable for this activity.
          </div>
        )}
      </div>
    </section>
  );
}
