import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callbackScopeParam,
  grantedStravaScope,
  stravaPermissionNotes,
  stravaPermissionsFromScope,
  stravaPermissionsLimited,
} from './strava-permissions.ts';

void test('every requested scope granted is full access', () => {
  const permissions = stravaPermissionsFromScope(
    'read,activity:read_all,activity:write',
  );
  assert.deepEqual(permissions, { activities: 'all', edit: true });
  assert.equal(stravaPermissionsLimited(permissions), false);
  assert.deepEqual(stravaPermissionNotes(permissions), []);
});

void test('unticked private activities and editing are limited access', () => {
  const permissions = stravaPermissionsFromScope('read,activity:read');
  assert.deepEqual(permissions, { activities: 'public', edit: false });
  assert.equal(stravaPermissionsLimited(permissions), true);
  assert.equal(stravaPermissionNotes(permissions).length, 2);
});

void test('a grant without any activity scope cannot import activities', () => {
  const permissions = stravaPermissionsFromScope('read');
  assert.deepEqual(permissions, { activities: 'none', edit: false });
  assert.match(stravaPermissionNotes(permissions)[0]!, /No activities/);
});

void test('a missing or unrecognised stored scope is unknown, not nothing granted', () => {
  for (const scope of [null, undefined, '', ' , ', 'openid email']) {
    assert.equal(stravaPermissionsFromScope(scope), null);
  }
  assert.equal(stravaPermissionsLimited(null), false);
  assert.deepEqual(stravaPermissionNotes(null), []);
});

void test('space-separated scopes are accepted as well as Strava’s commas', () => {
  assert.deepEqual(
    stravaPermissionsFromScope('read activity:read_all activity:write'),
    { activities: 'all', edit: true },
  );
});

void test('the granted scope is read from Strava’s authorization redirect', () => {
  const url =
    'https://activitymap.cc/api/auth/callback/strava?state=s&code=c&scope=read,activity:read';
  assert.equal(callbackScopeParam(url), 'read,activity:read');
  assert.equal(
    grantedStravaScope(callbackScopeParam(url)),
    'read,activity:read',
  );
  assert.equal(
    grantedStravaScope('read,bogus,activity:write'),
    'read,activity:write',
  );
  assert.equal(grantedStravaScope(''), '');
});

void test('no scope parameter leaves the stored grant untouched', () => {
  assert.equal(
    callbackScopeParam(
      'https://activitymap.cc/api/auth/callback/strava?code=c',
    ),
    null,
  );
  assert.equal(callbackScopeParam(undefined), null);
  assert.equal(callbackScopeParam('not a url'), null);
  assert.equal(grantedStravaScope(null), null);
  assert.equal(grantedStravaScope(undefined), null);
  assert.equal(grantedStravaScope(['read']), null);
});
