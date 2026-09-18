import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactHeaders } from './redact.ts';

void test('redacts session and token values by key name', () => {
  const result = redact({
    sessionToken: 'super-secret-session',
    session: { id: 'abc', userId: 'u1' },
    accessToken: 'strava-access',
    refresh_token: 'strava-refresh',
    verify_token: 'webhook-secret',
    userId: 'u1',
  }) as Record<string, unknown>;

  assert.equal(result.sessionToken, '[redacted]');
  assert.equal(result.session, '[redacted]');
  assert.equal(result.accessToken, '[redacted]');
  assert.equal(result.refresh_token, '[redacted]');
  assert.equal(result.verify_token, '[redacted]');
  assert.equal(result.userId, 'u1');
});

void test('redacts personal activity data by key name', () => {
  const result = redact({
    id: 42,
    name: 'kept-because-not-a-known-pii-key',
    description: 'Ran near my house',
    start_latlng: [47.1, 8.5],
    end_latlng: [47.2, 8.6],
    map_polyline: 'abc123',
  }) as Record<string, unknown>;

  assert.equal(result.id, 42);
  assert.equal(result.name, 'kept-because-not-a-known-pii-key');
  assert.equal(result.description, '[redacted]');
  assert.equal(result.start_latlng, '[redacted]');
  assert.equal(result.end_latlng, '[redacted]');
  assert.equal(result.map_polyline, '[redacted]');
});

void test('redacts nested objects and arrays', () => {
  const result = redact({
    user: { id: 'u1', session: { sessionToken: 'nested-secret' } },
    items: [{ access_token: 'a' }, { access_token: 'b' }],
  }) as {
    user: { session: unknown };
    items: Array<Record<string, unknown>>;
  };

  assert.equal(result.user.session, '[redacted]');
  assert.equal(result.items[0]?.access_token, '[redacted]');
  assert.equal(result.items[1]?.access_token, '[redacted]');
});

void test('redacts Authorization and Cookie headers, keeps other headers', () => {
  const headers = new Headers({
    Authorization: 'Bearer super-secret-token',
    Cookie: 'better-auth.session_token=super-secret-cookie',
    'Content-Type': 'application/json',
  });

  const result = redactHeaders(headers);

  assert.equal(result.authorization, '[redacted]');
  assert.equal(result.cookie, '[redacted]');
  assert.equal(result['content-type'], 'application/json');
});

void test('preserves error name/message/stack without leaking extra fields', () => {
  const error = new Error('boom');
  const result = redact(error) as { name: string; message: string };

  assert.equal(result.name, 'Error');
  assert.equal(result.message, 'boom');
});

void test('handles circular references without throwing', () => {
  const obj: Record<string, unknown> = { id: 1 };
  obj.self = obj;

  assert.doesNotThrow(() => redact(obj));
});
