import assert from 'node:assert/strict';

import test from 'node:test';

import {
  GATEWAY_SIGNATURE_WINDOW_MS,
  gatewayRequestSchema,
  signGatewayRequest,
  verifyGatewayRequest,
} from './contract';

const secret = 'a'.repeat(64);
const keys = { k1: secret };
const now = 1_800_000_000_000;
const body = JSON.stringify({ hello: 'world' });
const signed = (
  overrides: Partial<Parameters<typeof verifyGatewayRequest>[0]>,
) =>
  verifyGatewayRequest({
    keys,
    keyId: 'k1',
    timestamp: String(now),
    signature: signGatewayRequest('k1', secret, String(now), body),
    body,
    now,
    ...overrides,
  });

void test('a signature covers the key, the time and the exact body', () => {
  assert.equal(signed({}), true);
  assert.equal(signed({ body: `${body} ` }), false);
  assert.equal(signed({ keyId: 'k2' }), false);
  assert.equal(signed({ keys: { k1: 'b'.repeat(64) } }), false);
  assert.equal(signed({ keys: { k2: secret } }), false);
  // Inherited object keys are not signing keys.
  assert.equal(signed({ keyId: 'constructor' }), false);
  assert.equal(signed({ signature: 'not-hex' }), false);
  assert.equal(signed({ signature: null }), false);
  assert.equal(signed({ timestamp: null }), false);
  // A valid signature made for another time does not carry over.
  assert.equal(signed({ timestamp: String(now + 1) }), false);
});

void test('signatures expire', () => {
  const at = (offset: number) => {
    const timestamp = String(now + offset);
    return signed({
      timestamp,
      signature: signGatewayRequest('k1', secret, timestamp, body),
    });
  };
  assert.equal(at(-GATEWAY_SIGNATURE_WINDOW_MS), true);
  assert.equal(at(-GATEWAY_SIGNATURE_WINDOW_MS - 1), false);
  assert.equal(at(GATEWAY_SIGNATURE_WINDOW_MS + 1), false);
});

void test('requests name one owner and one bounded read', () => {
  const owner = { userId: 'user-a', athleteId: '42' };
  const valid = (operation: unknown) =>
    gatewayRequestSchema.safeParse({ ...owner, operation }).success;
  assert(valid({ kind: 'activity', id: '9007199254740993' }));
  assert(valid({ kind: 'streams', id: '1' }));
  assert(valid({ kind: 'photos', id: '1' }));
  assert(
    valid({ kind: 'activities', page: 1, perPage: 200, after: 1700000000 }),
  );
  assert(!valid({ kind: 'activities', page: 1, perPage: 201 }));
  assert(!valid({ kind: 'activity', id: '0' }));
  assert(!valid({ kind: 'activity', id: '1', extra: true }));
  assert(!valid({ kind: 'update', id: '1' }));
  assert(
    !gatewayRequestSchema.safeParse({
      ...owner,
      operation: { kind: 'activity', id: '1' },
      accessToken: 'x',
    }).success,
  );
});
