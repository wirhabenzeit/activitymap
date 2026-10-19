import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { activitySummaryFetchResultSchema } from '~/contracts/v1/activity-mutations';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import type { BrowserSyncStatus } from '~/lib/sync/browser-status';
import { authenticatedLibraryScope } from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { retryDeadline } from '~/lib/sync/retry-deadline';

export class FirstSummaryFetchError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
    readonly retryAt: number | null = null,
  ) {
    super(message);
  }
}

async function fetchSummaries(signal: AbortSignal): Promise<number> {
  let response: Response;
  try {
    response = await fetch('/api/v1/activities', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new FirstSummaryFetchError(
      'Could not connect to ActivityMap. Check your connection and try again.',
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(body);
    const failure = parsed.success ? parsed.data.error : null;
    const recovery =
      failure?.code === 'strava_not_connected'
        ? ' Connect with Strava again in Settings.'
        : response.status === 401
          ? ' Sign in again to continue.'
          : '';
    throw new FirstSummaryFetchError(
      (failure?.message ??
        `Activity import failed (HTTP ${response.status}).`) + recovery,
      failure?.retryable ?? (response.status === 429 || response.status >= 500),
      response.headers.has('retry-after') || response.status === 429
        ? retryDeadline(response.headers)
        : null,
    );
  }
  const parsed = responseEnvelope(activitySummaryFetchResultSchema).safeParse(
    body,
  );
  if (!parsed.success)
    throw new FirstSummaryFetchError(
      'The server returned an invalid activity import response. Please try again.',
    );
  return parsed.data.data;
}

/** Wait for this session's initial reconciliation, including cached-empty
 * reopen, before deciding whether Strava summaries need to be imported. */
export function shouldFetchFirstSummaries(
  activities: {
    isSuccess: boolean;
    isFetching: boolean;
    hasNextPage: boolean;
    data?: readonly unknown[];
  },
  syncPhase: BrowserSyncStatus['phase'] | undefined,
) {
  return (
    syncPhase === 'ready' &&
    activities.isSuccess &&
    !activities.isFetching &&
    !activities.hasNextPage &&
    activities.data?.length === 0
  );
}

/** Keep a successful import separate from the download, so recovery only repeats failed work. */
export function firstSummaryFetchOptions(
  client: QueryClient,
  userId: string | undefined,
  enabled: boolean,
) {
  const importKey = ['first-summary-import', userId] as const;
  return queryOptions({
    queryKey: ['first-summary-fetch', userId],
    enabled: !!userId && enabled,
    retry: false,
    networkMode: 'always',
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryState(importKey)?.error;
      if (
        previous instanceof FirstSummaryFetchError &&
        previous.retryAt !== null &&
        previous.retryAt > Date.now()
      )
        throw previous;
      const count = await client.fetchQuery({
        queryKey: importKey,
        queryFn: ({ signal }) => fetchSummaries(signal),
        retry: false,
        networkMode: 'always',
        staleTime: Infinity,
        gcTime: Infinity,
      });
      signal.throwIfAborted();
      try {
        await requestLibrarySync(client, authenticatedLibraryScope(userId!));
        signal.throwIfAborted();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new FirstSummaryFetchError(
          'Your activities were saved, but could not be downloaded. Check your connection and retry.',
        );
      }
      return count;
    },
  });
}
