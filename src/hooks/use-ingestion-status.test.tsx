import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  ingestionStatusOptions,
  IngestionStatusError,
} from './use-ingestion-status';

void test('status refetches retain Retry-After when React Query clears its error state', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('unavailable', {
        status: 503,
        headers: { 'retry-after': '3600' },
      }),
  );
  const client = new QueryClient();
  try {
    const options = ingestionStatusOptions(client, 'alice', true);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(
        client.fetchQuery(options),
        (error: unknown) =>
          error instanceof IngestionStatusError &&
          error.retryAt > Date.now() + 3500_000,
      );
    }
    assert.equal(fetch.mock.callCount(), 1);
    await assert.rejects(
      client.fetchQuery(ingestionStatusOptions(client, 'bob', true)),
      IngestionStatusError,
    );
    assert.equal(fetch.mock.callCount(), 2, 'the cooldown is account scoped');
  } finally {
    client.clear();
  }
});

void test('older servers remain unavailable rather than producing an empty library', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('internal proxy detail', { status: 404 }),
  );
  const client = new QueryClient();
  try {
    const options = ingestionStatusOptions(client, 'alice', true);
    await assert.rejects(
      client.fetchQuery(options),
      /not available on this server yet/,
    );
    assert.equal(client.getQueryData(options.queryKey), undefined);
  } finally {
    client.clear();
  }
});
