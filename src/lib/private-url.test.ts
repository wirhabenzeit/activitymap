import assert from 'node:assert/strict';

import test from 'node:test';

import { isPrivateUrl } from './private-url.ts';

void test('share links and the sign-in callback are private, as a path or a full URL', () => {
  for (const url of [
    '/share/abc',
    '/auth/callback',
    '/auth/callback?code=secret&state=s',
    '/auth/callback#x',
    '/auth/strava',
    '/auth/strava?code=secret&state=s',
    'https://activitymap.cc/auth/strava?code=secret',
    'https://activitymap.cc/share/abc',
    'https://activitymap.cc/auth/callback?code=secret',
  ]) {
    assert.equal(isPrivateUrl(url), true, url);
  }
});

void test('ordinary pages and lookalike paths are not private', () => {
  for (const url of [
    '/map',
    '/privacy',
    '/auth/callbacks',
    '/auth/callback-help',
    '/auth/stravas',
    '/sharing',
    '/api/auth/callback/strava',
    'https://activitymap.cc/map?next=/auth/callback',
  ]) {
    assert.equal(isPrivateUrl(url), false, url);
  }
});
