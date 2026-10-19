'use client';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import {
  type StravaImportDTO,
  stravaImportDTOSchema,
} from '~/contracts/v1/strava-import';
import { message } from '~/lib/presentation/messages';
import { authenticatedLibraryScope } from '~/lib/sync/library-owner';
import { requestLibrarySync } from '~/lib/sync/library-sync';
import { retryDeadline } from '~/lib/sync/retry-deadline';
import { useShallowStore } from '~/store';

const cooldowns = new WeakMap<QueryClient, Map<string, number>>();
function cooldown(client: QueryClient, owner: string) {
  return cooldowns.get(client)?.get(owner) ?? 0;
}
function setCooldown(client: QueryClient, owner: string, at: number) {
  let values = cooldowns.get(client);
  if (!values) {
    values = new Map();
    cooldowns.set(client, values);
  }
  values.set(owner, at);
}

export class StravaImportRequestError extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}
export async function requestStravaImport(
  method: 'GET' | 'POST',
  signal: AbortSignal,
): Promise<StravaImportDTO> {
  const response = await fetch('/api/v1/strava-import', {
    method,
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const failure = errorEnvelopeSchema.safeParse(body);
    throw new StravaImportRequestError(
      failure.success
        ? failure.data.error.message
        : message('error.stravaImport.checkFailed'),
      retryDeadline(response.headers),
    );
  }
  return responseEnvelope(stravaImportDTOSchema).parse(body).data;
}

export function useStravaImport(userId: string | undefined, visible: boolean) {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const key = ['strava-import', userId] as const;
  const query = useQuery({
    queryKey: key,
    enabled: !!userId && visible,
    queryFn: async ({ signal }) => {
      const retry = cooldown(client, userId!);
      if (retry > Date.now())
        throw new StravaImportRequestError(
          message('error.stravaImport.waitCheck'),
          retry,
        );
      try {
        return await requestStravaImport('GET', signal);
      } catch (error) {
        if (!signal.aborted)
          setCooldown(
            client,
            userId!,
            error instanceof StravaImportRequestError
              ? error.retryAt
              : Date.now() + 30_000,
          );
        throw error;
      }
    },
    retry: false,
    staleTime: 3_000,
    refetchOnWindowFocus: false,
    refetchInterval: (current) =>
      visible
        ? Math.max(
            current.state.data?.status === 'running' ? 3_000 : 30_000,
            cooldown(client, userId!) - Date.now(),
          )
        : false,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: async (owner: string) => {
      if (
        useShallowStore.getState().user?.id !== owner ||
        useShallowStore.getState().isGuest
      )
        throw new DOMException('The active account changed.', 'AbortError');
      const retry = cooldown(client, owner);
      if (retry > Date.now())
        throw new StravaImportRequestError(
          message('error.stravaImport.waitStart'),
          retry,
        );
      controller.current?.abort();
      controller.current = new AbortController();
      return requestStravaImport('POST', controller.current.signal);
    },
    onSuccess: (data, owner) => {
      if (
        useShallowStore.getState().user?.id === owner &&
        !useShallowStore.getState().isGuest
      )
        client.setQueryData(['strava-import', owner], data);
    },
    onError: (error, owner) => {
      if (error instanceof StravaImportRequestError)
        setCooldown(client, owner, error.retryAt);
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    reset();
    return () => controller.current?.abort();
  }, [userId, reset]);
  useEffect(() => {
    if (!userId || !visible || !query.data?.runId) return;
    // Import progress is reconciled through the same committed library view.
    if (
      useShallowStore.getState().user?.id !== userId ||
      useShallowStore.getState().isGuest
    )
      return;
    void requestLibrarySync(client, authenticatedLibraryScope(userId)).catch(
      () => undefined,
    );
  }, [
    client,
    userId,
    visible,
    query.data?.runId,
    query.data?.status,
    query.data?.summaries,
    query.data?.details,
    query.data?.photos,
  ]);
  return {
    ...query,
    start: () => {
      if (userId) mutation.mutate(userId);
    },
    starting: mutation.isPending,
    startError: mutation.error,
    retryAt: Math.max(
      cooldown(client, userId ?? ''),
      query.data?.retryAt ? Date.parse(query.data.retryAt) : 0,
    ),
  };
}
