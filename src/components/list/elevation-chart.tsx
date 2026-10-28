'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { Button } from '~/components/ui/button';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import { useActivityPlaces } from '~/hooks/use-activity-places';
import { placesMatchProfile } from '~/lib/activity-places';
import {
  STREAM_SUMMARY_PREFETCH_BATCH,
  STREAM_SUMMARY_PREFETCH_CONCURRENCY,
  type StreamSummaryResult,
  canManuallyRetryStreamSummary,
  isStreamSummaryCurrent,
  isStreamSummaryResultReusable,
  reconcileStreamSummaryMetadata,
  streamSummaryQueryKey,
  streamSummaryRefetchInterval,
  toElevationProfile,
} from '~/lib/activity-stream-summary';
import {
  loadActivityStreamSummary,
  loadStoredStreamSummaryBatch,
} from '~/lib/sync/stream-summary-sync';
import { useActivityPlaceFocus } from '~/store/activity-place-focus';
import { useElevationCursor } from '~/store/elevation-cursor';

import { ActivityPlacesStatus } from './activity-places-status';
import { ElevationPlot } from './elevation-plot';

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
        const results = await loadStoredStreamSummaryBatch({
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

export function ElevationChart({
  activityId,
  userId,
  streamMetadata,
}: {
  activityId: string;
  userId: string;
  streamMetadata?: StreamMetadata;
}) {
  const owner = useId();
  const matchedPlaces = useActivityPlaces(activityId, streamMetadata);
  const placeFocus = useActivityPlaceFocus((state) => state.focus);
  const queryClient = useQueryClient();
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const queryKey = streamSummaryQueryKey(userId, activityId);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      loadActivityStreamSummary({
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

  useEffect(() => {
    const retryAt = query.data?.status === 'paused' ? query.data.retryAt : null;
    if (retryAt === null) return;
    const now = Date.now();
    const remaining = retryAt - now;
    if (remaining <= 0) {
      if (retryClock >= retryAt) return;
      const timeout = window.setTimeout(() => setRetryClock(Date.now()), 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(
      () => setRetryClock(Date.now()),
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [query.data?.retryAt, query.data?.status, retryClock]);

  // Keep prefetched/cached summaries encoded. Materialize samples only while
  // this chart is mounted, and release them with the view.
  const profile = useMemo(() => {
    const data = query.data;
    return data?.metadata && isStreamSummaryCurrent(data, streamMetadata)
      ? toElevationProfile({ metadata: data.metadata, summary: data.summary })
      : null;
  }, [query.data, streamMetadata]);
  useEffect(
    () => () => useElevationCursor.getState().clearCursor(owner),
    [owner, profile, activityId, userId],
  );
  const profileMatches = placesMatchProfile(
    matchedPlaces.data,
    query.data?.metadata,
  );
  const placesStatus = matchedPlaces.enabled ? (
    <ActivityPlacesStatus
      data={matchedPlaces.data}
      isLoading={matchedPlaces.isLoading}
      isAwaiting={matchedPlaces.isAwaiting}
    />
  ) : null;
  const height = 177;
  const canRetry = canManuallyRetryStreamSummary(query.data, retryClock);

  return (
    <section aria-label="Elevation profile">
      {/* Every state takes the chart's height so the card never resizes. */}
      <div style={{ height }}>
        {profile ? (
          // Keep showing the last profile while it revalidates in the background.
          <ElevationPlot
            key={`${userId}:${activityId}:${query.data?.metadata?.generation}:${query.data?.metadata?.revision}`}
            profile={profile}
            places={profileMatches ? matchedPlaces.data?.places : []}
            focusedPlaceKey={
              placeFocus?.userId === userId &&
              placeFocus.activityId === activityId
                ? placeFocus.placeId + ':' + placeFocus.visitIndex
                : undefined
            }
            height={height}
            placesStatus={placesStatus}
            onPlaceDismiss={() =>
              useActivityPlaceFocus.setState({ focus: null })
            }
            onPlaceSelect={(marker) =>
              useActivityPlaceFocus.getState().setFocus({
                userId,
                activityId,
                placeId: marker.placeId,
                visitIndex: marker.visitIndex,
                source: 'profile',
              })
            }
            onSelection={(index) => {
              const coordinate =
                index === null ? undefined : profile.latlng?.[index];
              if (coordinate && query.data) {
                useElevationCursor.getState().setCursor({
                  owner,
                  userId,
                  activityId,
                  coordinate,
                  source: query.data,
                });
              } else {
                useElevationCursor.getState().clearCursor(owner);
              }
            }}
          />
        ) : query.isError ||
          query.data?.status === 'failed' ||
          query.data?.status === 'paused' ? (
          <div className="flex h-full flex-col items-start justify-center gap-2 rounded-md bg-muted/40 px-3">
            <p className="text-xs text-muted-foreground">
              {query.error?.message ?? query.data?.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!canRetry}
              onClick={() => {
                if (!canManuallyRetryStreamSummary(query.data)) return;
                void queryClient.resetQueries({ queryKey, exact: true });
              }}
            >
              {canRetry ? 'Try again' : 'Try again later'}
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
