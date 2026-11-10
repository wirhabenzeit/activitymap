import assert from 'node:assert/strict';

import test, { mock } from 'node:test';

import { logger } from '~/server/logging/logger';

import { providerGatewayConfig } from './config';

const keys = JSON.stringify({ k1: 'a'.repeat(64) });
const on = {
  ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
  ACTIVITYMAP_PROVIDER_GATEWAY_KEYS: keys,
};

void test('the gateway needs keys and enabled external effects', () => {
  assert.deepEqual(providerGatewayConfig(on), {
    keys: { k1: 'a'.repeat(64) },
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
    ])
      assert.equal(providerGatewayConfig({ ...on, ...override }), null);
    assert.equal(error.mock.callCount(), 2);
  } finally {
    error.mock.restore();
  }
});
