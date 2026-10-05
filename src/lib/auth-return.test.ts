import assert from 'node:assert/strict';
import test from 'node:test';

import { connectFailure, displayEmail, safeReturnPath } from './auth-return.ts';

void test('the originating app view, including its query, is the return path', () => {
  assert.equal(safeReturnPath('/list'), '/list');
  assert.equal(safeReturnPath('/stats/tiles'), '/stats/tiles');
  assert.equal(safeReturnPath('/map?activities=1,2'), '/map?activities=1,2');
});

void test('a previous failed round trip does not leave its error on the return path', () => {
  assert.equal(
    safeReturnPath('/list?error=access_denied&error_description=x&sort=date'),
    '/list?sort=date',
  );
});

void test('anything but a same-origin app path falls back to the map', () => {
  for (const candidate of [
    null,
    undefined,
    '',
    'list',
    'https://evil.example/map',
    '//evil.example/map',
    '/\\evil.example/map',
    '/\\/evil.example',
    'javascript:alert(1)',
    '/api/auth/sign-out',
    '/share/abc',
    '/mapping',
    '/',
  ]) {
    assert.equal(safeReturnPath(candidate), '/map', String(candidate));
  }
});

void test('a declined Strava authorization is a quiet cancellation, not a failure', () => {
  assert.equal(connectFailure(null), null);
  assert.equal(connectFailure('access_denied'), 'cancelled');
  assert.equal(connectFailure('state_mismatch'), 'failed');
});

void test('synthetic Strava fallback addresses are hidden from account identity', () => {
  assert.equal(displayEmail('123456@strava.local'), null);
  assert.equal(displayEmail('123456@STRAVA.LOCAL'), null);
  assert.equal(displayEmail(null), null);
  assert.equal(displayEmail('ada@example.com'), 'ada@example.com');
});
