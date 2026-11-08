import assert from 'node:assert/strict';

import test from 'node:test';

import {
  webhookCallbackKeyMatches,
  webhookCallbackSecret,
  webhookCallbackUrl,
} from './webhook-callback.ts';

const SECRET = 'a'.repeat(24) + '_B-c'.repeat(4); // 40 url-safe characters

void test('webhookCallbackSecret returns a well-formed secret', () => {
  assert.equal(
    webhookCallbackSecret({ STRAVA_WEBHOOK_CALLBACK_SECRET: SECRET }),
    SECRET,
  );
});

void test('webhookCallbackSecret fails closed when unset, too short, or not url-safe', () => {
  assert.equal(webhookCallbackSecret({}), null);
  assert.equal(
    webhookCallbackSecret({ STRAVA_WEBHOOK_CALLBACK_SECRET: '' }),
    null,
  );
  assert.equal(
    webhookCallbackSecret({ STRAVA_WEBHOOK_CALLBACK_SECRET: 'short-secret' }),
    null,
  );
  assert.equal(
    webhookCallbackSecret({ STRAVA_WEBHOOK_CALLBACK_SECRET: `${SECRET}/../x` }),
    null,
  );
});

void test('webhookCallbackKeyMatches accepts only the exact configured secret', () => {
  assert.equal(webhookCallbackKeyMatches(SECRET, SECRET), true);
  assert.equal(webhookCallbackKeyMatches(`${SECRET}x`, SECRET), false);
  assert.equal(webhookCallbackKeyMatches(SECRET.slice(1), SECRET), false);
  assert.equal(webhookCallbackKeyMatches(SECRET.toUpperCase(), SECRET), false);
  assert.equal(webhookCallbackKeyMatches('', SECRET), false);
  assert.equal(webhookCallbackKeyMatches(undefined, SECRET), false);
});

void test('webhookCallbackKeyMatches rejects every key when no secret is configured', () => {
  assert.equal(webhookCallbackKeyMatches(SECRET, null), false);
  assert.equal(webhookCallbackKeyMatches('', null), false);
});

void test('webhookCallbackUrl embeds the secret as the final path segment', () => {
  assert.equal(
    webhookCallbackUrl('https://activitymap.example', SECRET),
    `https://activitymap.example/api/strava/webhook/${SECRET}`,
  );
});
