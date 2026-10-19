'use client';

import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type { UpdateActivityRequest } from '~/contracts/v1/activity-mutations';
import {
  type ActivityCommandSession,
  activityCommandAborted,
  isActivityCommandSessionCurrent,
  runActivityCommand,
} from '~/lib/activity-command-session';
import {
  type ActivityMutationOutcome,
  completeActivityMutation,
} from '~/lib/activity-mutation';
import { assertActivityMutationAvailable } from '~/lib/activity-mutation-availability';
import {
  refreshActivityCommand,
  saveActivityCommand,
} from '~/lib/activity-mutation-client';
import {
  fenceStreamSummaryActivity,
  streamSummaryQueryKey,
} from '~/lib/activity-stream-summary';
import {
  authenticatedLibraryScope,
  getLibraryOwner,
} from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { commitActivityResponse } from '~/lib/sync/v1-store';
import { useShallowStore } from '~/store';

const authSource = {
  getState: useShallowStore.getState,
  subscribe: (listener: () => void) => useShallowStore.subscribe(listener),
};

export function useActivityMutations(id: number) {
  const client = useQueryClient();
  const { userId, generation } = useShallowStore((state) => ({
    userId: state.isGuest ? undefined : state.user?.id,
    generation: state.authSession,
  }));
  const session: ActivityCommandSession | null = userId
    ? { userId, generation }
    : null;
  const isCurrent = () =>
    isActivityCommandSessionCurrent(session, authSource.getState());
  const mutationKey = ['activity-command', userId, id] as const;
  const pending = useIsMutating({ mutationKey, exact: true });

  const reconcile = async (
    outcome: Omit<ActivityMutationOutcome, 'cacheError'>,
    origin: ActivityCommandSession,
    signal: AbortSignal,
  ) => {
    if (!isActivityCommandSessionCurrent(origin, authSource.getState()))
      throw activityCommandAborted();
    signal.throwIfAborted();
    const scope = authenticatedLibraryScope(origin.userId);
    await requestLibrarySync(client, scope, async (librarySignal) => {
      signal.throwIfAborted();
      await commitActivityResponse(
        scope,
        outcome.activity,
        outcome.photos,
        AbortSignal.any([signal, librarySignal]),
      );
    });
    signal.throwIfAborted();
    await getLibraryOwner(client, scope).refresh();
    signal.throwIfAborted();
    // The serialized commit already removed the persisted profile. Only reset
    // query observers here; an old command must never perform a late disk delete
    // after account cleanup or a newer library download.
    fenceStreamSummaryActivity(origin.userId, String(id));
    const queryKey = streamSummaryQueryKey(origin.userId, String(id));
    await client.cancelQueries({ queryKey, exact: true });
    signal.throwIfAborted();
    void client.resetQueries({ queryKey, exact: true }).catch(() => undefined);
  };

  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: async (changes: UpdateActivityRequest | 'refresh') => {
      if (!session) throw activityCommandAborted();
      return runActivityCommand(
        client,
        session,
        id,
        authSource,
        async (signal) => {
          assertActivityMutationAvailable(
            authSource.getState(),
            changes === 'refresh' ? 'refresh' : 'edit',
          );
          const result =
            changes === 'refresh'
              ? await refreshActivityCommand(id, signal)
              : {
                  activity: await saveActivityCommand(id, changes, signal),
                  photos: [],
                  photos_status: 'partial' as const,
                  photos_error: null,
                };
          signal.throwIfAborted();
          const committed = {
            origin: session,
            activity: result.activity,
            photos:
              result.photos_status === 'complete' ? result.photos : undefined,
            photosError: result.photos_error,
          };
          return completeActivityMutation(
            committed,
            () => reconcile(committed, session, signal),
            isCurrent,
          );
        },
      );
    },
  });
  return {
    ...mutation,
    // Separate observers of the same activity share pending availability.
    isPending: pending > 0,
    save: (changes: UpdateActivityRequest) => mutation.mutateAsync(changes),
    refresh: () => mutation.mutateAsync('refresh'),
    retryCache: async (outcome: ActivityMutationOutcome) => {
      const origin = outcome.origin;
      if (
        !session ||
        origin?.userId !== session.userId ||
        origin.generation !== session.generation ||
        outcome.activity.id !== String(id) ||
        !isCurrent()
      )
        throw activityCommandAborted();
      await runActivityCommand(client, origin, id, authSource, (signal) =>
        reconcile(outcome, origin, signal),
      );
    },
    isCurrent,
  };
}
