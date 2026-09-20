import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActivityDTO } from '~/contracts/v1/activity.ts';
import type { PhotoDTO } from '~/contracts/v1/photo.ts';
import type { Activity, Photo } from '~/server/db/schema.ts';
import { computeSyncParityReport, type SyncParityDeps } from './legacy-parity.ts';

const SCOPE = 'auth:user-1';

function fakeDeps(overrides: Partial<{
  legacyActivities: Activity[];
  v1Activities: ActivityDTO[];
  legacyPhotos: Photo[];
  v1Photos: PhotoDTO[];
}>): SyncParityDeps {
  const {
    legacyActivities = [],
    v1Activities = [],
    legacyPhotos = [],
    v1Photos = [],
  } = overrides;
  return {
    getCachedActivities: async (scope) => (scope === SCOPE ? legacyActivities : []),
    getCachedActivityDTOs: async (scope) => (scope === SCOPE ? v1Activities : []),
    getCachedPhotos: async (scope) => (scope === SCOPE ? legacyPhotos : []),
    getCachedPhotoDTOs: async (scope) => (scope === SCOPE ? v1Photos : []),
  };
}

void test('computeSyncParityReport reports no gap when the v1 cache is a superset of the legacy cache', async () => {
  const deps = fakeDeps({
    legacyActivities: [{ id: 1 }, { id: 2 }] as Activity[],
    v1Activities: [{ id: '1' }, { id: '2' }, { id: '3' }] as ActivityDTO[],
  });

  const report = await computeSyncParityReport(SCOPE, deps);
  assert.equal(report.legacyActivityCount, 2);
  assert.equal(report.v1ActivityCount, 3);
  assert.deepEqual(report.legacyOnlyActivityIds, []);
});

void test('computeSyncParityReport flags an activity the legacy cache had but the v1 cache is missing', async () => {
  const deps = fakeDeps({
    legacyActivities: [{ id: 1 }, { id: 2 }] as Activity[],
    v1Activities: [{ id: '1' }] as ActivityDTO[],
  });

  const report = await computeSyncParityReport(SCOPE, deps);
  assert.deepEqual(report.legacyOnlyActivityIds, [2]);
});

void test('computeSyncParityReport flags a photo the legacy cache had but the v1 cache is missing', async () => {
  const deps = fakeDeps({
    legacyPhotos: [{ unique_id: 'p1' }, { unique_id: 'p2' }] as Photo[],
    v1Photos: [{ unique_id: 'p1' }] as PhotoDTO[],
  });

  const report = await computeSyncParityReport(SCOPE, deps);
  assert.deepEqual(report.legacyOnlyPhotoIds, ['p2']);
});

void test('computeSyncParityReport is scope-isolated', async () => {
  const deps: SyncParityDeps = {
    getCachedActivities: async () => [{ id: 1 }] as Activity[],
    getCachedActivityDTOs: async () => [] as ActivityDTO[],
    getCachedPhotos: async () => [],
    getCachedPhotoDTOs: async () => [],
  };

  const report = await computeSyncParityReport('auth:other-user', deps);
  assert.equal(report.scope, 'auth:other-user');
  assert.deepEqual(report.legacyOnlyActivityIds, [1]);
});
