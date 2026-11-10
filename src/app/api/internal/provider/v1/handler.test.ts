import assert from 'node:assert/strict';

import test from 'node:test';

import { providerGatewayClient } from '~/server/provider-gateway/client';
import type {
  GatewayFailure,
  GatewayOperation,
} from '~/server/provider-gateway/contract';

import { createProviderGatewayHandler } from './handler';

const secret = 'c'.repeat(64);
const owner = { userId: 'user-a', athleteId: '42' };
const activity: GatewayOperation = { kind: 'activity', id: '7' };

/** The real client talking to the real handler. */
function gateway(
  overrides: Partial<Parameters<typeof createProviderGatewayHandler>[0]> = {},
  client: { secret?: string; clock?: () => number } = {},
) {
  const reads: unknown[] = [];
  const errors: unknown[] = [];
  const failures: GatewayFailure[] = [];
  const handler = createProviderGatewayHandler({
    config: () => ({ keys: { k1: secret } }),
    serves: async (userId) => userId === 'user-a',
    athleteFor: async (userId) => (userId === 'user-a' ? 42 : 7),
    read: async (target, operation) => {
      reads.push({ target, operation });
      return { id: 7, name: 'Morning ride' };
    },
    failureFor: () => null,
    now: () => 1_000_000,
    onFailure: (failure) => failures.push(failure),
    onError: (error) => errors.push(error),
    ...overrides,
  });
  const caller = providerGatewayClient({
    origin: 'https://app.test',
    keyId: 'k1',
    secret: client.secret ?? secret,
    now: client.clock ?? (() => 1_000_000),
    fetcher: (url, init) => handler(new Request(url, init)),
  });
  const call: typeof caller.call = (target, operation) =>
    caller.call(target, operation);
  return { call, handler, reads, errors, failures };
}

void test('a signed request for a listed owner returns the provider payload', async () => {
  const { call, reads } = gateway();
  assert.deepEqual(await call(owner, activity), {
    ok: true,
    data: { id: 7, name: 'Morning ride' },
  });
  assert.deepEqual(reads, [
    { target: { userId: 'user-a', athleteId: 42 }, operation: activity },
  ]);
});

void test('nothing is read without a valid, recent signature', async () => {
  const wrongKey = gateway({}, { secret: 'd'.repeat(64) });
  await assert.rejects(wrongKey.call(owner, activity), /\(401\)/);
  const stale = gateway({}, { clock: () => 1_000_000 - 31_000 });
  await assert.rejects(stale.call(owner, activity), /\(401\)/);
  assert.deepEqual([...wrongKey.reads, ...stale.reads], []);

  // A signed body that was altered afterwards.
  const { handler, reads } = gateway();
  const forged = await handler(
    new Request('https://app.test/api/internal/provider/v1', {
      method: 'POST',
      headers: {
        'x-activitymap-key-id': 'k1',
        'x-activitymap-timestamp': '1000000',
        'x-activitymap-signature': 'e'.repeat(64),
      },
      body: JSON.stringify({ ...owner, operation: activity }),
    }),
  );
  assert.equal(forged.status, 401);
  assert.equal(await forged.text(), '');
  assert.deepEqual(reads, []);
});

void test('the gateway is off until configured, and serves only its owners', async () => {
  const off = gateway({ config: () => null });
  await assert.rejects(off.call(owner, activity), /\(503\)/);

  const { call, reads } = gateway();
  // Not listed.
  await assert.rejects(
    call({ userId: 'user-b', athleteId: '7' }, activity),
    /\(403\)/,
  );
  // Listed, but the athlete is not this user's.
  await assert.rejects(
    call({ userId: 'user-a', athleteId: '43' }, activity),
    /\(403\)/,
  );
  assert.deepEqual(reads, []);
});

void test('malformed and oversized requests are refused after the signature check', async () => {
  const { call, reads } = gateway();
  await assert.rejects(
    call(owner, { kind: 'delete', id: '7' } as never),
    /\(400\)/,
  );
  await assert.rejects(
    call({ ...owner, userId: 'u'.repeat(5000) }, activity),
    /\(413\)/,
  );
  assert.deepEqual(reads, []);
});

void test('provider failures are typed; anything else is a bare 500', async () => {
  const limited: GatewayFailure = {
    kind: 'rate_limited',
    retryAfterSeconds: 120,
  };
  const typed = gateway({
    read: async () => {
      throw new Error('budget');
    },
    failureFor: () => limited,
  });
  assert.deepEqual(await typed.call(owner, activity), {
    ok: false,
    error: limited,
  });
  assert.deepEqual(typed.failures, [limited]);
  assert.deepEqual(typed.errors, []);

  const broken = gateway({
    read: async () => {
      throw new Error('database password in a message');
    },
  });
  await assert.rejects(broken.call(owner, activity), /\(500\)/);
  assert.equal(broken.errors.length, 1);
  const response = await broken.handler(
    new Request('https://app.test/api/internal/provider/v1', {
      method: 'POST',
    }),
  );
  assert.equal(await response.text(), '');
});
