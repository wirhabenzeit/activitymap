'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { LoaderCircle } from 'lucide-react';
import {
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '~/components/ui/dialog';
import { useActivities } from '~/hooks/use-activities';
import { useShallowStore } from '~/store';
import {
  FirstSummaryFetchError,
  firstSummaryFetchOptions,
} from '~/lib/first-summary-fetch';

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
  const empty = activities.isSuccess && activities.data?.length === 0;
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
        window.dispatchEvent(new Event('activitymap:retry-browser-sync'));
        void client
          .invalidateQueries({
            predicate: ({ queryKey }) =>
              (queryKey[0] === 'activities' &&
                queryKey[1] === 'auth' &&
                queryKey[2] === userId) ||
              (queryKey[0] === 'photos' && queryKey[1] === userId),
          })
          .catch(() => undefined);
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
      <DialogPortal>
        <DialogOverlay className="z-[70] bg-background/20 backdrop-blur-md" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => {
            if (fetch.isFetching) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (fetch.isFetching) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (fetch.isFetching) event.preventDefault();
          }}
          className="fixed top-1/2 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-white/20 bg-card/75 p-6 text-card-foreground shadow-2xl ring-1 ring-black/5 backdrop-blur-xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:border-white/10"
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
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
