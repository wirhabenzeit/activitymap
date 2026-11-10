import assert from 'node:assert/strict';

import test, { mock } from 'node:test';

import { logger } from '~/server/logging/logger';

import { providerGatewayConfig } from './config';

const keys = JSON.stringify({ k1: 'a'.repeat(64) });
const owners = '["user-a"]';
const on = {
  ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
  ACTIVITYMAP_PROVIDER_GATEWAY_KEYS: keys,
  ACTIVITYMAP_PROVIDER_GATEWAY_OWNERS: owners,
};

void test('the gateway needs keys, owners and enabled external effects', () => {
  assert.deepEqual(providerGatewayConfig(on), {
    keys: { k1: 'a'.repeat(64) },
    owners: ['user-a'],
  });
  for (const missing of Object.keys(on))
    assert.equal(
      providerGatewayConfig({ ...on, [missing]: undefined }),
      null,
      missing,
    );
  assert.equal(
    providerGatewayConfig({ ...on, ACTIVITYMAP_PROVIDER_GATEWAY_KEYS: '{}' }),
    null,
  );
});

void test('invalid settings turn the gateway off and are reported', () => {
  const error = mock.method(logger, 'error', () => undefined);
  try {
    for (const override of [
      { ACTIVITYMAP_PROVIDER_GATEWAY_KEYS: '{"k1":"short"}' },
      { ACTIVITYMAP_PROVIDER_GATEWAY_KEYS: 'not json' },
      { ACTIVITYMAP_PROVIDER_GATEWAY_OWNERS: '{"user-a":true}' },
    ])
      assert.equal(providerGatewayConfig({ ...on, ...override }), null);
    assert.equal(error.mock.callCount(), 3);
  } finally {
    error.mock.restore();
  }
});
