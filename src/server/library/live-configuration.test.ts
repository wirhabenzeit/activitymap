import assert from 'node:assert/strict';

import test from 'node:test';

import { convexLiveUrlFor } from './live-configuration';

const url = 'https://example-123.convex.cloud';
const assigned = { writer: 'convex', convexEpoch: 'epoch-0123456789ab' };

void test('web/native live sync follows the stored assignment without an allowlist', () => {
  assert.equal(
    convexLiveUrlFor(assigned, { ACTIVITYMAP_CONVEX_URL: url }),
    url,
  );
  for (const user of [
    {},
    { writer: 'convex' },
    { writer: 'postgres', convexEpoch: assigned.convexEpoch },
  ])
    assert.equal(convexLiveUrlFor(user, { ACTIVITYMAP_CONVEX_URL: url }), null);
});

void test('missing or unsafe deployment configuration keeps HTTP sync available', () => {
  assert.equal(convexLiveUrlFor(assigned, {}), null);
  for (const value of [
    'http://example.convex.cloud',
    'https://user:secret@example.convex.cloud',
    'https://example.convex.cloud/path',
    'https://example.convex.cloud?key=secret',
    'invalid',
  ])
    assert.equal(
      convexLiveUrlFor(assigned, { ACTIVITYMAP_CONVEX_URL: value }),
      null,
    );
});
