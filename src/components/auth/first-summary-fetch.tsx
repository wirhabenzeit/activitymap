'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AppDialogContent } from '~/components/app-dialog';
import { DialogDescription, DialogTitle } from '~/components/ui/dialog';
import { useActivities } from '~/hooks/use-activities';
import {
  FirstSummaryFetchError,
  firstSummaryFetchOptions,
  shouldFetchFirstSummaries,
} from '~/lib/first-summary-fetch';
import { useBrowserSyncStatus } from '~/lib/sync/browser-status';
import { authenticatedLibraryScope } from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { useShallowStore } from '~/store';

export function FirstSummaryFetch() {
  const client = useQueryClient();
  const { userId, connected } = useShallowStore((state) => ({
    userId: state.isInitialized && !state.isGuest ? state.user?.id : undefined,
    connected:
      state.user?.stravaConnected &&
      state.user.stravaPermissions?.activities !== 'none',
  }));
  const activities = useActivities();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const syncPhase = useBrowserSyncStatus((state) =>
    userId ? state.byUser[userId]?.phase : undefined,
  );
  const empty = shouldFetchFirstSummaries(activities, syncPhase);
  const fetch = useQuery(
    firstSummaryFetchOptions(client, userId, Boolean(connected && empty)),
  );
  useEffect(() => {
    if (!userId || !connected || !fetch.data) return;
    // Download changes committed after the first-page response. These bounded
    // follow-ups keep the signup view live; they never trigger more imports.
    const timers = [10_000, 25_000, 50_000].map((delay) =>
      window.setTimeout(() => {
        if (useShallowStore.getState().user?.id !== userId || !navigator.onLine)
          return;
        if (useShallowStore.getState().isGuest) return;
        void requestLibrarySync(
          client,
          authenticatedLibraryScope(userId),
        ).catch(() => undefined);
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [client, userId, connected, fetch.data]);
  const [now, setNow] = useState(Date.now);
  const error =
    fetch.error instanceof FirstSummaryFetchError ? fetch.error : null;
  const retryAt = error?.retryAt;
  useEffect(() => {
    if (retryAt == null) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, retryAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  const waiting = retryAt != null && retryAt > now;
  const open = Boolean(
    userId &&
    connected &&
    dismissed !== userId &&
    (fetch.isFetching || fetch.isError || fetch.data !== undefined),
  );
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !fetch.isFetching) setDismissed(userId!);
      }}
    >
      <AppDialogContent
        onEscapeKeyDown={(event) => {
          if (fetch.isFetching) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (fetch.isFetching) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (fetch.isFetching) event.preventDefault();
        }}
        closeLabel="Close activity loading"
        showClose={false}
        appearance="glass"
        overlayClassName="z-[70] bg-background/20 backdrop-blur-md"
        className="z-[70] max-w-sm"
      >
        <DialogTitle className="text-lg font-semibold">
          {fetch.isFetching
            ? 'Loading your recent activities'
            : fetch.isError
              ? 'Could not fetch your activities'
              : fetch.data === 0
                ? 'No activities found in Strava'
                : 'Your recent activities are ready'}
        </DialogTitle>
        <DialogDescription>
          {fetch.isFetching
            ? 'Fetching up to 200 activity summaries from Strava. Please wait.'
            : fetch.isError
              ? fetch.error.message
              : fetch.data === 0
                ? 'New activities will appear here after you record them in Strava.'
                : `${fetch.data} activities fetched. Older history, details and photos continue in the background.`}
        </DialogDescription>
        {fetch.isError && waiting && (
          <p className="text-sm text-muted-foreground">
            Try again after {new Date(retryAt).toLocaleTimeString()}.
          </p>
        )}
        {fetch.isFetching ? (
          <div role="status" className="flex min-h-11 items-center">
            <LoaderCircle
              aria-hidden="true"
              className="size-5 text-muted-foreground motion-safe:animate-spin"
            />
            <span className="sr-only">Loading your recent activities</span>
          </div>
        ) : (
          <div className="flex gap-6">
            {fetch.isError && error?.retryable !== false && (
              <button
                className="min-h-11 font-medium underline disabled:opacity-50"
                disabled={waiting}
                onClick={() => void fetch.refetch()}
              >
                Retry
              </button>
            )}
            <button
              className="min-h-11 font-medium underline"
              onClick={() => setDismissed(userId!)}
            >
              {fetch.isError ? 'Close' : 'Continue'}
            </button>
          </div>
        )}
      </AppDialogContent>
    </DialogPrimitive.Root>
  );
}
