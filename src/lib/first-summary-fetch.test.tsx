import assert from 'node:assert/strict';
import test from 'node:test';
import {
  onlineManager,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';

import { errorEnvelope } from '~/contracts/v1/error';
import { makeEnvelope } from '~/contracts/v1/envelope';
import {
  FirstSummaryFetchError,
  firstSummaryFetchOptions,
} from './first-summary-fetch';

void test('a failed activity download is surfaced and recovery does not repeat a successful import', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(makeEnvelope(200)),
  );
  const client = new QueryClient();
  const key = ['activities', 'auth', 'alice'];
  client.setQueryData(key, []);
  let fail = true;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      if (fail) throw new Error('Download unavailable');
      return [{ id: 1 }];
    },
    retry: false,
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => undefined);
  try {
    const options = firstSummaryFetchOptions(client, 'alice', true);
    await assert.rejects(
      client.fetchQuery(options),
      /saved, but could not be downloaded/,
    );
    assert.equal(client.getQueryState(options.queryKey)?.status, 'error');
    assert.deepEqual(client.getQueryData(key), []);
    fail = false;
    assert.equal(await client.fetchQuery(options), 200);
    assert.deepEqual(client.getQueryData(key), [{ id: 1 }]);
    assert.equal(request.mock.callCount(), 1);
  } finally {
    stop();
    client.clear();
  }
});

void test('backend errors retain their message and non-retryable account recovery guidance', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      errorEnvelope(
        'strava_not_connected',
        'The connected Strava account is unavailable.',
        { requestId: 'r' },
      ),
      { status: 409 },
    ),
  );
  const client = new QueryClient();
  try {
    await assert.rejects(
      client.fetchQuery(firstSummaryFetchOptions(client, 'alice', true)),
      (error: unknown) =>
        error instanceof FirstSummaryFetchError &&
        !error.retryable &&
        error.message ===
          'The connected Strava account is unavailable. Connect with Strava again in Settings.',
    );
  } finally {
    client.clear();
  }
});

void test('manual retries and remounts honor Retry-After without issuing another POST', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      errorEnvelope('rate_limited', 'Strava rate-limited the request.', {
        requestId: 'r',
        retryable: true,
      }),
      { status: 429, headers: { 'Retry-After': '3600' } },
    ),
  );
  const client = new QueryClient();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(
        client.fetchQuery(firstSummaryFetchOptions(client, 'alice', true)),
        (error: unknown) =>
          error instanceof FirstSummaryFetchError &&
          error.retryable &&
          error.retryAt !== null &&
          error.retryAt > Date.now() + 3500_000 &&
          error.message === 'Strava rate-limited the request.',
      );
    }
    assert.equal(request.mock.callCount(), 1);
    await assert.rejects(
      client.fetchQuery(firstSummaryFetchOptions(client, 'bob', true)),
      FirstSummaryFetchError,
    );
    assert.equal(
      request.mock.callCount(),
      2,
      'another account has its own import state',
    );
  } finally {
    client.clear();
  }
});

void test('an empty Strava library completes once, with no repeat import on a refresh retry', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(makeEnvelope(0)),
  );
  const client = new QueryClient();
  try {
    const options = firstSummaryFetchOptions(client, 'alice', true);
    assert.equal(await client.fetchQuery(options), 0);
    await client.invalidateQueries({ queryKey: options.queryKey });
    assert.equal(await client.fetchQuery(options), 0);
    assert.equal(request.mock.callCount(), 1);
  } finally {
    client.clear();
  }
});

void test('network failures and malformed success responses produce readable errors', async (t) => {
  const request = t.mock.method(
    globalThis,
    'fetch',
    async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    },
  );
  const client = new QueryClient();
  try {
    await assert.rejects(
      client.fetchQuery(firstSummaryFetchOptions(client, 'alice', true)),
      /Check your connection/,
    );
    request.mock.mockImplementation(
      async () => new Response('<html>proxy detail</html>'),
    );
    await assert.rejects(
      client.fetchQuery(firstSummaryFetchOptions(client, 'alice', true)),
      /invalid activity import response/,
    );
  } finally {
    client.clear();
  }
});

void test('an offline activity download cannot turn a persisted import into visible completion', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(makeEnvelope(1)),
  );
  const client = new QueryClient();
  const key = ['activities', 'auth', 'alice'];
  client.setQueryData(key, []);
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => [{ id: 1 }],
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => undefined);
  onlineManager.setOnline(false);
  try {
    await assert.rejects(
      client.fetchQuery(firstSummaryFetchOptions(client, 'alice', true)),
      /saved, but could not be downloaded/,
    );
    assert.equal(client.getQueryState(key)?.fetchStatus, 'paused');
  } finally {
    onlineManager.setOnline(true);
    stop();
    client.clear();
  }
});
