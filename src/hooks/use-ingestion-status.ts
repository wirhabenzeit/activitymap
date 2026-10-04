'use client';
import {
  useQuery,
  useQueryClient,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query';
import { retryDeadline } from '~/lib/sync/retry-deadline';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { ingestionStatusDTOSchema } from '~/contracts/v1/ingestion-status';

export class IngestionStatusError extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}
// Query state clears `error` when a fetch begins. Keep the HTTP cooldown
// outside that state so tab switches and remounts cannot bypass Retry-After.
const cooldowns = new WeakMap<QueryClient, Map<string, IngestionStatusError>>();

export function ingestionStatusOptions(
  client: QueryClient,
  userId: string | undefined,
  open: boolean,
) {
  return queryOptions({
    queryKey: ['ingestion-status', userId],
    enabled: open && !!userId,
    queryFn: async ({ signal }) => {
      const scope = userId ?? 'signed-out';
      let failures = cooldowns.get(client);
      if (!failures) {
        failures = new Map();
        cooldowns.set(client, failures);
      }
      const previous = failures.get(scope);
      if (previous && previous.retryAt > Date.now()) throw previous;
      try {
        const response = await fetch('/api/v1/ingestion-status', {
          signal,
          credentials: 'include',
        });
        if (!response.ok) {
          throw new IngestionStatusError(
            response.status === 404
              ? 'Server import status is not available on this server yet.'
              : response.status === 401
                ? 'Sign in again to check server import status.'
                : 'Could not check server import status. Your last known status is shown when available.',
            retryDeadline(response.headers),
          );
        }
        const status = responseEnvelope(ingestionStatusDTOSchema).parse(
          await response.json(),
        ).data;
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- This is an in-memory Map, not a database table.
        failures.delete(scope);
        return status;
      } catch (error) {
        if (signal.aborted) throw error;
        const failure =
          error instanceof IngestionStatusError
            ? error
            : new IngestionStatusError(
                'Could not check server import status. Your last known status is shown when available.',
                Date.now() + 60_000,
              );
        failures.set(scope, failure);
        throw failure;
      }
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) =>
      open
        ? Math.max(
            60_000,
            (query.state.error instanceof IngestionStatusError
              ? query.state.error.retryAt
              : 0) - Date.now(),
          )
        : false,
    refetchIntervalInBackground: false,
  });
}

export function useIngestionStatus(userId: string | undefined, open: boolean) {
  const client = useQueryClient();
  return useQuery(ingestionStatusOptions(client, userId, open));
}
