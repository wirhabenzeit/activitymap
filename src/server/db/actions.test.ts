import assert from 'node:assert/strict';
import test from 'node:test';

import { LegacySharingDisabledError } from '~/lib/legacy-sharing';
import { getPublicActivities, getPublicUserActivities } from './actions';

/**
 * Regression tests for Part of #132: the legacy, unauthenticated sharing
 * flows described in docs/strava-data-policy.md §5 must never again return
 * real activity data to an unauthenticated caller. Both functions reject
 * before touching the database (see `~/lib/legacy-sharing.ts`), so these
 * tests exercise them directly with no live Postgres connection - a real
 * `db.select(...)` call would only prove the opposite of what this test
 * documents.
 */

void test('getPublicActivities (share-selected-activities flow) rejects instead of returning activity data', async () => {
  await assert.rejects(
    () => getPublicActivities([123, 456]),
    LegacySharingDisabledError,
  );
});

void test('getPublicActivities rejects even for an empty id list', async () => {
  await assert.rejects(() => getPublicActivities([]), LegacySharingDisabledError);
});

void test('getPublicUserActivities (share-entire-profile flow) rejects instead of returning activity data', async () => {
  await assert.rejects(
    () => getPublicUserActivities({ userId: 'some-user-id' }),
    LegacySharingDisabledError,
  );
});

void test('getPublicUserActivities rejects before resolving the user, so no user lookup or activity data is exposed', async () => {
  // A userId that does not exist would previously bubble up as a different
  // error from `getUserInternal`; getting `LegacySharingDisabledError`
  // instead proves the disable check runs first, before any lookup.
  await assert.rejects(
    () => getPublicUserActivities({ userId: 'this-user-id-does-not-exist' }),
    LegacySharingDisabledError,
  );
});
