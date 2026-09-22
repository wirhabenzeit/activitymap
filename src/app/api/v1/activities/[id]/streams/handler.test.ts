import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivityStreamsHandler } from './handler';
import type { Actor } from '~/server/auth/actor';
import {
  ActivityStreamsUnavailableError,
  type ActivityStreamsRepository,
} from '~/server/repositories/activity-streams';
import { StravaApiError } from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import { withApiV1RateLimit } from '~/server/api/rate-limit-boundary';
import { userKeyFor } from '~/server/http/rate-limit';

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
  assert.equal((await anonymous(request())).status, 401);
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
    const response = await handler(request());
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
    assert.equal((await handler(request(query))).status, 400);
  const denied = await handler(request());
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
  const response = await pending(request(''));
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
    const failed = await handler(request(''));
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
