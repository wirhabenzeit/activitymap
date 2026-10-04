// Pending includes the hydration/disabled-query gap before a request starts.
// Cached content remains usable during a refresh or a recoverable failure.
export function isStatsHistoryLoading(
  query: {
    isPending: boolean;
    isFetching: boolean;
    isError: boolean;
    hasNextPage: boolean;
  },
  empty: boolean,
) {
  return (
    empty &&
    !query.isError &&
    (query.isPending || query.isFetching || query.hasNextPage)
  );
}
