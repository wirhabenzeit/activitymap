import assert from 'node:assert/strict';

import test from 'node:test';

import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import type { Actor } from '~/server/auth/actor';
import { userKeyFor } from '~/server/http/rate-limit';
import {
  type ActivityStreamsRepository,
  ActivityStreamsUnavailableError,
} from '~/server/repositories/activity-streams';
import { StravaApiError } from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';

import { createActivityStreamsHandler } from './handler';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'bearer',
};
const repository = {
  async read() {
    return null;
  },
} as unknown as ActivityStreamsRepository;
const request = (query = 'fetch=none') =>
  new Request(
    `https://app.test/api/v1/activities/9007199254740993/streams?${query}`,
  );
void test('stream boundary requires authentication and preserves a string ID for both auth methods', async () => {
  const anonymous = createActivityStreamsHandler({
    repository,
    resolveActor: async () => null,
  });
  assert.equal((await anonymous(request(), '9007199254740993')).status, 401);
  for (const authentication of ['cookie', 'bearer'] as const) {
    const handler = createActivityStreamsHandler({
      repository: {
        ...repository,
        async read(caller, id) {
          assert.equal(caller.authentication, authentication);
          assert.equal(id, '9007199254740993');
          return null;
        },
      },
      resolveActor: async () => ({ ...actor, authentication }),
    });
    const response = await handler(request(), '9007199254740993');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(await response.text(), /"state":"not_fetched"/);
  }
});
void test('invalid inputs and inaccessible activities reveal no availability', async () => {
  const handler = createActivityStreamsHandler({
    repository: {
      ...repository,
      async read() {
        throw new ActivityStreamsUnavailableError();
      },
    },
    resolveActor: async () => actor,
  });
  for (const query of [
    'fetch=wrong',
    'refresh=maybe',
    'fetch=none&refresh=true',
  ])
    assert.equal(
      (await handler(request(query), '9007199254740993')).status,
      400,
    );
  const denied = await handler(request(), '9007199254740993');
  assert.equal(denied.status, 404);
  assert.doesNotMatch(
    await denied.text(),
    /available_types|metadata|streams":/,
  );
});
void test('pending requests and errors use standard envelopes and retry guidance', async () => {
  const pending = createActivityStreamsHandler({
    repository,
    resolveActor: async () => actor,
    fetch: async () => ({ status: 'superseded' }),
  });
  const response = await pending(request(''), '9007199254740993');
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('retry-after'), '3');
  for (const [error, status] of [
    [new StravaApiError('upstream private error', 503), 503],
    [new StravaApiError('limited', 429), 429],
    [new StravaBudgetExceededError(900), 429],
    [new Error('database credentials in diagnostic'), 500],
  ] as const) {
    const handler = createActivityStreamsHandler({
      repository,
      resolveActor: async () => actor,
      fetch: async () => {
        throw error;
      },
    });
    const failed = await handler(request(''), '9007199254740993');
    assert.equal(failed.status, status);
    const body = await failed.text();
    assert.match(body, /"requestId":/);
    assert.doesNotMatch(body, /private error|credentials in diagnostic/);
  }
});
void test('shared per-user rate limiting rejects across sessions before a fetch', async () => {
  const handler = withApiV1RateLimit(
    async () => {
      throw new Error('must not reach fetch');
    },
    {
      route: 'GET /api/v1/activities/{id}/streams',
      resolveUserId: async () => actor.userId,
      repo: {
        async incrementAndGet(key) {
          return key === userKeyFor(actor.userId) ? 601 : 1;
        },
      },
    },
  );
  const response = await handler(request(''));
  assert.equal(response.status, 429);
  assert.ok(response.headers.has('retry-after'));
});

void test('compact summary boundary retains authentication, validation and pending retry semantics', async () => {
  const compactRequest = (query = 'fetch=none') =>
    new Request(
      `https://app.test/api/v1/activities/42/streams/summary/compact?${query}`,
    );
  const compactRepository = {
    ...repository,
    readSummaries: async () => [{ activityId: '42', row: null }],
  };
  const handler = createActivityStreamsHandler({
    view: 'compact',
    repository: compactRepository,
    resolveActor: async () => actor,
    fetch: async () => ({ status: 'superseded' }),
  });
  assert.equal(
    (
      await createActivityStreamsHandler({
        view: 'compact',
        repository: compactRepository,
        resolveActor: async () => null,
      })(compactRequest(), '42')
    ).status,
    401,
  );
  assert.equal(
    (await handler(compactRequest('fetch=none&refresh=true'), '42')).status,
    400,
  );
  const response = await handler(compactRequest('fetch=auto'), '42');
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('retry-after'), '3');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = (await response.json()) as { data: { summary: unknown } };
  assert.equal(body.data.summary, null);
});

void test('explicit stream IDs keep authorization before validation and never reparse the URL', async () => {
  let calls = 0;
  const handler = createActivityStreamsHandler({
    repository: {
      ...repository,
      async read(_actor, id) {
        calls++;
        assert.equal(id, '9007199254740993');
        return null;
      },
    },
    resolveActor: async () => actor,
  });
  const anonymous = createActivityStreamsHandler({
    repository,
    resolveActor: async () => null,
  });
  const request = () =>
    new Request('https://app.test/adapter-independent?fetch=none');
  assert.equal((await anonymous(request(), null)).status, 401);
  assert.equal((await handler(request(), null)).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handler(request(), '9007199254740993')).status, 200);
  assert.equal(calls, 1);
});

void test('a preferred copy answers when it holds current data; otherwise the usual path runs', async () => {
  const id = '9007199254740993';
  const snapshot = (source: string, invalidated = false) =>
    ({
      activityId: id,
      generation: `generation-${source}`,
      revision: '1',
      availableTypes: ['time'],
      requestedTypes: ['time'],
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      summary: null,
      invalidatedAt: invalidated ? new Date('2026-01-02T00:00:00Z') : null,
      lastAttemptAt: new Date('2026-01-01T00:00:00Z'),
      lastAttemptStatus: invalidated ? 'invalidated' : 'succeeded',
      lastError: null,
      nextRetryAt: null,
      attemptId: null,
      sourceVersion: null,
      leaseExpiresAt: null,
      payload: {
        time: {
          data: [0, 1],
          original_size: 2,
          resolution: 'high',
          series_type: 'time',
        },
      },
    }) as never;
  const run = async (
    preferred: () => Promise<unknown>,
    query = 'fetch=auto',
  ) => {
    const calls: string[] = [];
    const failures: unknown[] = [];
    const handler = createActivityStreamsHandler({
      repository: {
        ...repository,
        async read() {
          calls.push('postgres');
          return snapshot('postgres');
        },
      },
      preferred: {
        read: (async () => {
          calls.push('convex');
          return preferred();
        }) as never,
        readSummaries: async () => [],
      },
      onPreferredError: (error) => failures.push(error),
      fetch: (async () => {
        calls.push('fetch');
        return { status: 'fetched' };
      }) as never,
      resolveActor: async () => actor,
    });
    const response = await handler(request(query), id);
    return {
      calls,
      failures,
      status: response.status,
      text: await response.text(),
    };
  };

  const served = await run(async () => snapshot('convex'));
  assert.deepEqual(served.calls, ['convex']);
  assert.equal(served.status, 200);
  assert.match(served.text, /generation-convex/);

  // Nothing stored, or a stale recording: Postgres fetches and answers.
  for (const copy of [
    null,
    { ...(snapshot('convex') as object), payload: null },
    snapshot('convex', true),
  ]) {
    const missing = await run(async () => copy);
    assert.deepEqual(missing.calls, ['convex', 'fetch', 'postgres']);
    assert.match(missing.text, /generation-postgres/);
    assert.deepEqual(missing.failures, []);
  }

  // The copy is unreachable: reported once, and Postgres still answers.
  const down = await run(async () => {
    throw new Error('bridge unavailable');
  });
  assert.deepEqual(down.calls, ['convex', 'fetch', 'postgres']);
  assert.equal(down.status, 200);
  assert.equal(down.failures.length, 1);

  // The copy does not know the activity: not an error, Postgres decides.
  const unknown = await run(async () => {
    throw new ActivityStreamsUnavailableError();
  });
  assert.deepEqual(unknown.calls, ['convex', 'fetch', 'postgres']);
  assert.deepEqual(unknown.failures, []);

  // An explicit refresh always goes to the writer.
  const refreshed = await run(async () => snapshot('convex'), 'refresh=true');
  assert.deepEqual(refreshed.calls, ['fetch', 'postgres']);
});
