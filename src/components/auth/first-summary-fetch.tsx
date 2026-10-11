'use client';

import { useState } from 'react';
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
import { responseEnvelope } from '~/contracts/v1/envelope';
import { activitySummaryFetchResultSchema } from '~/contracts/v1/activity-mutations';

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
  const fetch = useQuery({
    queryKey: ['first-summary-fetch', userId],
    enabled: Boolean(userId && connected && empty),
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const response = await window.fetch('/api/v1/activities', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error('Could not fetch your activities. Please try again.');
      const count = responseEnvelope(activitySummaryFetchResultSchema).parse(
        await response.json(),
      ).data;
      await client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'activities' && query.queryKey[2] === userId,
      });
      window.dispatchEvent(new Event('activitymap:retry-browser-sync'));
      return count;
    },
  });
  const open = Boolean(
    userId &&
    connected &&
    dismissed !== userId &&
    (fetch.isFetching || fetch.isError || fetch.data !== undefined),
  );
  return (
    <DialogPrimitive.Root open={open}>
      <DialogPortal>
        <DialogOverlay className="z-[70] bg-background/20 backdrop-blur-md" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
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
                ? 'Please try again.'
                : fetch.data === 0
                  ? 'New activities will appear here after you record them in Strava.'
                  : `${fetch.data} activities fetched. Older history, details and photos continue in the background.`}
          </DialogDescription>
          {fetch.isFetching ? (
            <div role="status" className="flex min-h-11 items-center">
              <LoaderCircle
                aria-hidden="true"
                className="size-5 text-muted-foreground motion-safe:animate-spin"
              />
              <span className="sr-only">Loading your recent activities</span>
            </div>
          ) : (
            <button
              className="min-h-11 font-medium underline"
              onClick={() =>
                fetch.isError ? void fetch.refetch() : setDismissed(userId!)
              }
            >
              {fetch.isError ? 'Retry' : 'Continue'}
            </button>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
