import assert from 'node:assert/strict';
import test from 'node:test';

import { withApiV1RateLimit, type RateLimitRule } from './rate-limit-boundary.ts';

function fakeRepo() {
  const buckets = new Map<string, number>();
  return {
    calls: 0,
    async incrementAndGet(this: { calls: number }, key: string, windowStart: Date) {
      this.calls++;
      const bucketKey = `${key}@${windowStart.toISOString()}`;
      const next = (buckets.get(bucketKey) ?? 0) + 1;
      buckets.set(bucketKey, next);
      return next;
    },
  };
}

const TIGHT_RULE: RateLimitRule = { limit: 2, windowMs: 60_000 };

void test('withApiV1RateLimit passes requests through to the handler while under the limit', async () => {
  let handlerCalls = 0;
  const handler = async () => {
    handlerCalls++;
    return Response.json({ ok: true });
  };
  const repo = fakeRepo();
  const wrapped = withApiV1RateLimit(handler, {
    route: 'GET /api/v1/test',
    repo,
    sessionRule: TIGHT_RULE,
    ipRule: TIGHT_RULE,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const request = new Request('https://example.com', {
    headers: { authorization: 'Bearer token-a' },
  });
  const response = await wrapped(request);

  assert.equal(response.status, 200);
  assert.equal(handlerCalls, 1);
});

void test('withApiV1RateLimit rejects with the stable v1 rate_limited envelope once the session limit trips, without calling the handler', async () => {
  let handlerCalls = 0;
  const handler = async () => {
    handlerCalls++;
    return Response.json({ ok: true });
  };
  const repo = fakeRepo();
  const wrapped = withApiV1RateLimit(handler, {
    route: 'GET /api/v1/test',
    repo,
    sessionRule: TIGHT_RULE,
    ipRule: { limit: 1000, windowMs: 60_000 },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const request = () =>
    new Request('https://example.com', {
      headers: { authorization: 'Bearer token-b', 'x-request-id': 'req-1' },
    });

  await wrapped(request());
  await wrapped(request());
  const third = await wrapped(request());

  assert.equal(third.status, 429);
  assert.equal(third.headers.get('Retry-After') !== null, true);
  const body = (await third.json()) as {
    error: { code: string; requestId: string; retryable: boolean };
  };
  assert.equal(body.error.code, 'rate_limited');
  assert.equal(body.error.requestId, 'req-1');
  assert.equal(body.error.retryable, true);
  assert.equal(handlerCalls, 2, 'the third, rejected call must not reach the inner handler');
});

void test('withApiV1RateLimit keeps distinct sessions in independent buckets', async () => {
  const handler = async () => Response.json({ ok: true });
  const repo = fakeRepo();
  const wrapped = withApiV1RateLimit(handler, {
    route: 'GET /api/v1/test',
    repo,
    sessionRule: TIGHT_RULE,
    ipRule: { limit: 1000, windowMs: 60_000 },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const forToken = (token: string) =>
    new Request('https://example.com', { headers: { authorization: `Bearer ${token}` } });

  await wrapped(forToken('a'));
  await wrapped(forToken('a'));
  const aThird = await wrapped(forToken('a'));
  const bFirst = await wrapped(forToken('b'));

  assert.equal(aThird.status, 429);
  assert.equal(bFirst.status, 200);
});

void test('withApiV1RateLimit falls back to per-IP limiting when no session credential is present', async () => {
  const handler = async () => Response.json({ ok: true });
  const repo = fakeRepo();
  const wrapped = withApiV1RateLimit(handler, {
    route: 'GET /api/v1/auth/mobile/start',
    repo,
    sessionRule: { limit: 1000, windowMs: 60_000 },
    ipRule: TIGHT_RULE,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const request = () =>
    new Request('https://example.com', { headers: { 'x-forwarded-for': '203.0.113.5' } });

  await wrapped(request());
  await wrapped(request());
  const third = await wrapped(request());

  assert.equal(third.status, 429);
});

void test('withApiV1RateLimit generates a requestId when none was supplied', async () => {
  const handler = async () => Response.json({ ok: true });
  const repo = fakeRepo();
  const wrapped = withApiV1RateLimit(handler, {
    route: 'GET /api/v1/test',
    repo,
    sessionRule: { limit: 0, windowMs: 60_000 },
    ipRule: { limit: 1000, windowMs: 60_000 },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const response = await wrapped(
    new Request('https://example.com', { headers: { authorization: 'Bearer x' } }),
  );
  assert.equal(response.status, 429);
  const body = (await response.json()) as { error: { requestId: string } };
  assert.ok(body.error.requestId.length > 0);
});
