import type { BrowserSyncStatus } from './browser-status';

/** UI compatibility for the scoped owner: an empty partial cache is not a
 * completed empty library, and incomplete history never prunes selection IDs. */
export function libraryQueryState(
  snapshot: {
    loaded: boolean;
    completeness: 'unloaded' | 'partial' | 'complete';
    error: Error | null;
  } | null,
  sync: BrowserSyncStatus | undefined,
  rowCount: number,
) {
  const hasNextPage = snapshot?.completeness !== 'complete';
  const error =
    snapshot?.error ??
    (sync?.phase === 'error'
      ? new Error(sync.error ?? 'Could not sync your library. Please retry.')
      : sync?.phase === 'offline' && hasNextPage
        ? new Error(
            'You are offline. Reconnect and retry loading your library.',
          )
        : null);
  const isError = error !== null;
  const isSuccess = Boolean(
    snapshot?.loaded && !isError && (rowCount > 0 || !hasNextPage),
  );
  const isPending = !isSuccess && !isError;
  const isFetching =
    sync?.phase === 'syncing' ||
    Boolean(snapshot && !snapshot.loaded && !snapshot.error);
  return {
    error,
    status: isError
      ? ('error' as const)
      : isSuccess
        ? ('success' as const)
        : ('pending' as const),
    fetchStatus: isFetching ? ('fetching' as const) : ('idle' as const),
    isPending,
    isLoading: isPending && isFetching,
    isInitialLoading: isPending && isFetching,
    isSuccess,
    isError,
    isFetching,
    isRefetching: isFetching && !isPending,
    hasNextPage,
    isFetchNextPageError: hasNextPage && isError,
    isFetchingNextPage: hasNextPage && isFetching,
  };
}
