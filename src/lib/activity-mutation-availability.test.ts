import assert from 'node:assert/strict';

import test from 'node:test';

import {
  activityMutationAvailability,
  assertActivityMutationAvailable,
} from './activity-mutation-availability';
import type { StravaPermissions } from './strava-permissions';

const connected = (permissions: StravaPermissions | null = null) => ({
  isGuest: false,
  user: { stravaConnected: true, stravaPermissions: permissions },
});

void test('known denied write grants disable editing without blocking read refresh', () => {
  for (const activities of ['public', 'all'] as const) {
    const auth = connected({ activities, edit: false });
    assert.deepEqual(activityMutationAvailability(auth), {
      canEdit: false,
      canRefresh: true,
      editReason:
        'Editing isn’t allowed. Connect with Strava again to grant the missing permissions.',
    });
    assert.throws(
      () => assertActivityMutationAvailable(auth, 'edit'),
      /Editing isn’t allowed/,
    );
    assert.doesNotThrow(() => assertActivityMutationAvailable(auth, 'refresh'));
  }
});

void test('unknown historical and explicit write grants remain usable', () => {
  for (const auth of [
    connected(),
    connected({ activities: 'public', edit: true }),
  ]) {
    assert.equal(activityMutationAvailability(auth).canEdit, true);
    assert.equal(activityMutationAvailability(auth).editReason, undefined);
    assert.doesNotThrow(() => assertActivityMutationAvailable(auth, 'edit'));
  }
});

void test('guest and disconnected accounts cannot submit either mutation', () => {
  for (const auth of [
    { isGuest: true, user: connected().user },
    { isGuest: false, user: { stravaConnected: false } },
    { isGuest: false },
  ]) {
    assert.equal(activityMutationAvailability(auth).canEdit, false);
    assert.equal(activityMutationAvailability(auth).canRefresh, false);
    assert.throws(() => assertActivityMutationAvailable(auth, 'edit'));
    assert.throws(() => assertActivityMutationAvailable(auth, 'refresh'));
  }
});

void test('a grant revoked while a draft is open is checked at submission', () => {
  const auth = connected({ activities: 'all', edit: true });
  assert.equal(activityMutationAvailability(auth).canEdit, true);
  // The opening UI snapshot is obsolete; submission must inspect the current grant.
  auth.user.stravaPermissions = { activities: 'all', edit: false };
  let sent = false;
  assert.throws(() => {
    assertActivityMutationAvailable(auth, 'edit');
    sent = true;
  });
  assert.equal(sent, false);
  assert.doesNotThrow(() => assertActivityMutationAvailable(auth, 'refresh'));
});
