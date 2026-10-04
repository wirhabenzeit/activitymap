import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { isStatsHistoryLoading } from '~/lib/stats/loading';

void test('a disabled initial query is pending, not an empty history', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new QueryObserver<number[]>(client, {
    queryKey: ['history'],
    queryFn: async () => [],
    enabled: false,
  });
  const state = () => ({ ...observer.getCurrentResult(), hasNextPage: false });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    assert.equal(
      state().isLoading,
      false,
      'this is the hydration gap the old check missed',
    );
    assert.equal(isStatsHistoryLoading(state(), true), true);
    await observer.refetch();
    assert.equal(state().isSuccess, true);
    assert.equal(
      isStatsHistoryLoading(state(), true),
      false,
      'a completed empty response can show no history',
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

void test('cached history remains visible during background refresh and errors', () => {
  assert.equal(
    isStatsHistoryLoading(
      { isPending: true, isFetching: true, isError: false, hasNextPage: false },
      false,
    ),
    false,
  );
  assert.equal(
    isStatsHistoryLoading(
      {
        isPending: false,
        isFetching: false,
        isError: true,
        hasNextPage: false,
      },
      false,
    ),
    false,
  );
  assert.equal(
    isStatsHistoryLoading(
      {
        isPending: false,
        isFetching: false,
        isError: true,
        hasNextPage: false,
      },
      true,
    ),
    false,
  );
  assert.equal(
    isStatsHistoryLoading(
      {
        isPending: false,
        isFetching: false,
        isError: false,
        hasNextPage: true,
      },
      true,
    ),
    true,
    'filtered empty pages are not complete until pagination finishes',
  );
});
