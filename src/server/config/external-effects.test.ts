import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
  requireExternalEffectsEnabled,
} from './external-effects.ts';
import { StravaClient } from '~/server/strava/client';

void test('external effects default to disabled', () => {
  assert.equal(externalEffectsEnabled({}), false);
  assert.throws(
    () => requireExternalEffectsEnabled({}),
    new RegExp(EXTERNAL_EFFECTS_DISABLED_MESSAGE),
  );
});

void test('only the explicit enabled value permits external effects', () => {
  assert.equal(
    externalEffectsEnabled({ ACTIVITYMAP_EXTERNAL_EFFECTS: 'true' }),
    false,
  );
  assert.equal(
    externalEffectsEnabled({ ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled' }),
    true,
  );
  assert.doesNotThrow(() =>
    requireExternalEffectsEnabled({
      ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
    }),
  );
});

void test('the Strava client cannot be constructed without the opt-in', () => {
  const previousValue = process.env.ACTIVITYMAP_EXTERNAL_EFFECTS;
  delete process.env.ACTIVITYMAP_EXTERNAL_EFFECTS;

  try {
    assert.throws(
      () => StravaClient.withAccessToken('test-token'),
      new RegExp(EXTERNAL_EFFECTS_DISABLED_MESSAGE),
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.ACTIVITYMAP_EXTERNAL_EFFECTS;
    } else {
      process.env.ACTIVITYMAP_EXTERNAL_EFFECTS = previousValue;
    }
  }
});
