import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRateLimit,
  ipKeyFor,
  sessionKeyFor,
  type RateLimitRule,
} from './rate-limit.ts';

/** In-memory fake standing in for `RateLimitRepository`, keyed the same way the real Postgres upsert is: `(key, windowStart)`. */
function fakeRepo() {
  const buckets = new Map<string, number>();
  return {
    buckets,
    async incrementAndGet(key: string, windowStart: Date) {
      const bucketKey = `${key}@${windowStart.toISOString()}`;
      const next = (buckets.get(bucketKey) ?? 0) + 1;
      buckets.set(bucketKey, next);
      return next;
    },
  };
}

const RULE: RateLimitRule = { limit: 3, windowMs: 60_000 };

void test('evaluateRateLimit allows requests at and under the limit', async () => {
  const repo = fakeRepo();
  const now = new Date('2026-01-01T00:00:00.000Z');

  const first = await evaluateRateLimit(repo, 'k', RULE, now);
  const second = await evaluateRateLimit(repo, 'k', RULE, now);
  const third = await evaluateRateLimit(repo, 'k', RULE, now);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
});

void test('evaluateRateLimit denies once the limit is exceeded, within the same window', async () => {
  const repo = fakeRepo();
  const now = new Date('2026-01-01T00:00:00.000Z');

  for (let i = 0; i < 3; i++) await evaluateRateLimit(repo, 'k', RULE, now);
  const fourth = await evaluateRateLimit(repo, 'k', RULE, now);

  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
  assert.equal(fourth.limit, 3);
  assert.ok(fourth.retryAfterSeconds > 0);
});

void test('evaluateRateLimit resets once the fixed window rolls over', async () => {
  const repo = fakeRepo();
  const windowStart = new Date('2026-01-01T00:00:00.000Z');
  for (let i = 0; i < 3; i++) await evaluateRateLimit(repo, 'k', RULE, windowStart);
  const stillDenied = await evaluateRateLimit(repo, 'k', RULE, windowStart);
  assert.equal(stillDenied.allowed, false);

  const nextWindow = new Date(windowStart.getTime() + RULE.windowMs);
  const afterRollover = await evaluateRateLimit(repo, 'k', RULE, nextWindow);
  assert.equal(afterRollover.allowed, true);
});

void test('evaluateRateLimit keeps distinct keys independent', async () => {
  const repo = fakeRepo();
  const now = new Date('2026-01-01T00:00:00.000Z');
  for (let i = 0; i < 3; i++) await evaluateRateLimit(repo, 'a', RULE, now);

  const otherKey = await evaluateRateLimit(repo, 'b', RULE, now);
  assert.equal(otherKey.allowed, true);
});

void test('evaluateRateLimit retryAfterSeconds counts down to the window boundary', async () => {
  const repo = fakeRepo();
  const windowStart = new Date('2026-01-01T00:00:00.000Z');
  const midWindow = new Date(windowStart.getTime() + 45_000);
  for (let i = 0; i < 3; i++) await evaluateRateLimit(repo, 'k', RULE, midWindow);
  const denied = await evaluateRateLimit(repo, 'k', RULE, midWindow);

  // Window is [00:00:00, 00:01:00); at 00:00:45 there are 15s left.
  assert.equal(denied.retryAfterSeconds, 15);
});

void test('sessionKeyFor derives a key from the Authorization header, never the raw value', () => {
  const request = new Request('https://example.com', {
    headers: { authorization: 'Bearer super-secret-token' },
  });
  const key = sessionKeyFor(request);
  assert.ok(key);
  assert.ok(!key.includes('super-secret-token'));
});

void test('sessionKeyFor is stable for the same credential and different for different ones', () => {
  const a = sessionKeyFor(
    new Request('https://example.com', { headers: { authorization: 'Bearer aaa' } }),
  );
  const aAgain = sessionKeyFor(
    new Request('https://example.com', { headers: { authorization: 'Bearer aaa' } }),
  );
  const b = sessionKeyFor(
    new Request('https://example.com', { headers: { authorization: 'Bearer bbb' } }),
  );
  assert.equal(a, aAgain);
  assert.notEqual(a, b);
});

void test('sessionKeyFor reads the Better Auth session cookie when there is no Authorization header', () => {
  const request = new Request('https://example.com', {
    headers: { cookie: 'better-auth.session_token=cookie-secret; Path=/' },
  });
  const key = sessionKeyFor(request);
  assert.ok(key);
  assert.ok(!key.includes('cookie-secret'));
});

void test('sessionKeyFor recognizes the __Secure- prefixed cookie name', () => {
  const request = new Request('https://example.com', {
    headers: { cookie: '__Secure-better-auth.session_token=cookie-secret' },
  });
  assert.ok(sessionKeyFor(request));
});

void test('sessionKeyFor returns null when there is no session credential at all', () => {
  const request = new Request('https://example.com', {
    headers: { cookie: 'unrelated=value' },
  });
  assert.equal(sessionKeyFor(request), null);
});

void test('ipKeyFor reads the first address from x-forwarded-for', () => {
  const request = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
  });
  assert.equal(ipKeyFor(request), 'ip:203.0.113.5');
});

void test('ipKeyFor falls back to x-real-ip', () => {
  const request = new Request('https://example.com', {
    headers: { 'x-real-ip': '203.0.113.9' },
  });
  assert.equal(ipKeyFor(request), 'ip:203.0.113.9');
});

void test('ipKeyFor returns null with no proxy headers present', () => {
  const request = new Request('https://example.com');
  assert.equal(ipKeyFor(request), null);
});
