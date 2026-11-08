import assert from 'node:assert/strict';

import test from 'node:test';

import { activityMutationAvailability } from './activity-mutation-availability';
import { hasStoredLibraryAccess } from './stored-library-access';

void test('stored preview grants read access without provider mutation permission', () => {
  const user = { stravaConnected: false, storedLibraryPreview: true };
  assert.equal(hasStoredLibraryAccess(user), true);
  const permissions = activityMutationAvailability({ isGuest: false, user });
  assert.equal(permissions.canEdit, false);
  assert.equal(permissions.canRefresh, false);
  assert.equal(hasStoredLibraryAccess(undefined), false);
  assert.equal(hasStoredLibraryAccess({ stravaConnected: false }), false);
  assert.equal(hasStoredLibraryAccess({ stravaConnected: true }), true);
});
