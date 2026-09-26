'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { areaY, defineChart, lineY } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { Loader2 } from 'lucide-react';

import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import { Button } from '~/components/ui/button';
import {
  fetchActivityStreamSummary,
  fetchStoredStreamSummaryBatch,
  isStreamSummaryCurrent,
  isStreamSummaryResultReusable,
  reconcileStreamSummaryMetadata,
  STREAM_SUMMARY_PREFETCH_BATCH,
  STREAM_SUMMARY_PREFETCH_CONCURRENCY,
  streamSummaryQueryKey,
  streamSummaryRefetchInterval,
  type ElevationProfile,
  type StreamSummaryResult,
} from '~/lib/activity-stream-summary';

export type StreamSummaryActivity = {
  id: number;
  streamsMetadata?: StreamMetadata;
};

/**
 * Loads the stored summaries of the given activities in batches so their
 * cards open instantly. Never triggers a Strava fetch: activities without a
 * stored set are left for the chart to load when opened.
 */
export function usePrefetchStreamSummaries(
  activities: StreamSummaryActivity[],
  userId: string | undefined,
) {
  const queryClient = useQueryClient();
  const selection = useMemo(() => {
    const unique = new Map<string, StreamMetadata | undefined>();
    for (const activity of activities) {
      unique.set(String(activity.id), activity.streamsMetadata);
    }
    return unique;
  }, [activities]);
  const selectionIdentity = [...selection]
    .map(
      ([id, metadata]) =>
        `${id}:${metadata?.generation ?? ''}:${metadata?.revision ?? '0'}:${metadata?.state ?? ''}`,
    )
    .join(',');

  useEffect(() => {
    if (!userId) return;
    const missing = [...selection.keys()].filter((id) => {
      const existing = queryClient.getQueryData<StreamSummaryResult>(
        streamSummaryQueryKey(userId, id),
      );
      return !isStreamSummaryResultReusable(existing, selection.get(id));
    });
    if (missing.length === 0) return;
    const controller = new AbortController();
    const batches: string[][] = [];
    for (
      let start = 0;
      start < missing.length;
      start += STREAM_SUMMARY_PREFETCH_BATCH
    ) {
      batches.push(missing.slice(start, start + STREAM_SUMMARY_PREFETCH_BATCH));
    }
    let nextBatch = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = nextBatch++;
        const ids = batches[index];
        if (!ids) return;
        const results = await fetchStoredStreamSummaryBatch({
          activityIds: ids,
          userId,
          signal: controller.signal,
          observedMetadata: selection,
        });
        if (controller.signal.aborted) return;
        for (const [id, result] of results) {
          queryClient.setQueryData<StreamSummaryResult>(
            streamSummaryQueryKey(userId, id),
            (current) =>
              isStreamSummaryResultReusable(current, selection.get(id))
                ? current
                : result,
          );
        }
      }
    };
    for (
      let index = 0;
      index < Math.min(STREAM_SUMMARY_PREFETCH_CONCURRENCY, batches.length);
      index += 1
    ) {
      // Best effort; a visible chart performs its own demand load.
      void worker().catch(() => undefined);
    }
    return () => controller.abort();
    // selectionIdentity captures only fields that affect summary validity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionIdentity, userId, queryClient]);
}

function ElevationPlot({
  profile,
  height = 118,
}: {
  profile: ElevationProfile;
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
  streamMetadata,
}: {
  activityId: string;
  userId: string;
  streamMetadata?: StreamMetadata;
}) {
  const queryClient = useQueryClient();
  const queryKey = streamSummaryQueryKey(userId, activityId);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchActivityStreamSummary({
        activityId,
        userId,
        signal,
        observedMetadata: streamMetadata,
        previous: queryClient.getQueryData<StreamSummaryResult>(queryKey),
      }),
    retry: false,
    // Source generation/revision/state, not fetch age, controls validity.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (current) =>
      current.state.status !== 'error'
        ? streamSummaryRefetchInterval(current.state.data)
        : false,
  });

  useEffect(() => {
    void reconcileStreamSummaryMetadata(
      queryClient,
      userId,
      activityId,
      streamMetadata,
    );
  }, [activityId, queryClient, streamMetadata, userId]);

  const profile = isStreamSummaryCurrent(query.data, streamMetadata)
    ? query.data!.profile
    : null;
  const height = 135;

  return (
    <section
      className="border-t pt-3 @2xl:border-t-0 @2xl:pt-0"
      aria-label="Elevation profile"
    >
      <h3 className="mb-2 text-sm font-semibold">Elevation profile</h3>
      {/* Every state takes the chart's height so the card never resizes. */}
      <div style={{ height }}>
        {profile ? (
          // Keep showing the last profile while it revalidates in the background.
          <ElevationPlot profile={profile} height={height} />
        ) : query.isError || query.data?.status === 'failed' ? (
          <div className="flex h-full flex-col items-start justify-center gap-2 rounded-md bg-muted/40 px-3">
            <p className="text-xs text-muted-foreground">
              {query.error?.message ?? query.data?.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void queryClient.resetQueries({ queryKey, exact: true });
              }}
            >
              Try again
            </Button>
          </div>
        ) : query.isPending || query.data?.status === 'pending' ? (
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
