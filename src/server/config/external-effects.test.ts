import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
  requireExternalEffectsEnabled,
  requireStravaAccessEnabled,
  stravaAccessEnabled,
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

void test('the Strava client cannot be constructed outside Production or Preview', () => {
  const previousValue = process.env.ACTIVITYMAP_EXTERNAL_EFFECTS;
  const previousVercelEnv = process.env.VERCEL_ENV;
  delete process.env.ACTIVITYMAP_EXTERNAL_EFFECTS;
  delete process.env.VERCEL_ENV;

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
    if (previousVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = previousVercelEnv;
    }
  }
});

void test('Preview permits interactive access without external effects', () => {
  const preview = { VERCEL_ENV: 'preview' };
  assert.equal(stravaAccessEnabled(preview), true);
  assert.equal(externalEffectsEnabled(preview), false);
  assert.doesNotThrow(() => requireStravaAccessEnabled(preview));
  assert.throws(
    () => requireExternalEffectsEnabled(preview),
    new RegExp(EXTERNAL_EFFECTS_DISABLED_MESSAGE),
  );
  assert.equal(
    stravaAccessEnabled({ VERCEL_ENV: 'production' }),
    false,
  );
  assert.equal(stravaAccessEnabled({}), false);
});
