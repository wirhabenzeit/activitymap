import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryQueryState } from './library-query-state';
import { emptyBrowserStatus } from './browser-status';
import { isActivityLoadBusy } from '~/lib/activity-loading';

void test('hydration, partial empty and completed empty are distinct', () => {
  const pending = libraryQueryState(null, undefined, 0);
  assert.equal(pending.isPending, true);
  assert.equal(pending.isSuccess, false);
  assert.equal(pending.hasNextPage, true);
  const emptyPartial = libraryQueryState(
    { loaded: true, completeness: 'partial', error: null },
    undefined,
    0,
  );
  assert.equal(emptyPartial.isPending, true);
  assert.equal(
    emptyPartial.isSuccess,
    false,
    'First-summary import must not race an unfinished bootstrap',
  );
  const emptyComplete = libraryQueryState(
    { loaded: true, completeness: 'complete', error: null },
    undefined,
    0,
  );
  assert.equal(emptyComplete.isSuccess, true);
  assert.equal(emptyComplete.isPending, false);
  assert.equal(emptyComplete.hasNextPage, false);
});

void test('cached partial rows remain usable and do not prune unseen selected IDs', () => {
  const cached = libraryQueryState(
    { loaded: true, completeness: 'partial', error: null },
    undefined,
    12,
  );
  assert.equal(cached.isSuccess, true);
  assert.equal(cached.hasNextPage, true);
  assert.equal(cached.isPending, false);
});

void test('offline partial loading stops the busy indicator without becoming a complete empty library', () => {
  const offline = libraryQueryState(
    { loaded: true, completeness: 'partial', error: null },
    { ...emptyBrowserStatus, phase: 'offline' },
    0,
  );
  assert.equal(offline.isError, true);
  assert.equal(offline.isSuccess, false);
  assert.equal(offline.hasNextPage, true);
  assert.equal(offline.isFetchNextPageError, true);
  assert.equal(isActivityLoadBusy(offline, 'offline'), false);
  const reopened = libraryQueryState(
    { loaded: true, completeness: 'complete', error: null },
    { ...emptyBrowserStatus, phase: 'offline' },
    5,
  );
  assert.equal(reopened.isSuccess, true);
  assert.equal(reopened.isError, false);
});

void test('recoverable sync errors preserve completeness while retry reopens the busy interval', () => {
  const snapshot = {
    loaded: true,
    completeness: 'partial' as const,
    error: null,
  };
  const failed = libraryQueryState(
    snapshot,
    { ...emptyBrowserStatus, phase: 'error', error: 'Retry later' },
    4,
  );
  assert.equal(failed.error?.message, 'Retry later');
  assert.equal(failed.hasNextPage, true);
  assert.equal(isActivityLoadBusy(failed, 'error'), false);
  const retry = libraryQueryState(
    snapshot,
    { ...emptyBrowserStatus, phase: 'syncing' },
    4,
  );
  assert.equal(retry.isFetching, true);
  assert.equal(retry.isError, false);
  assert.equal(isActivityLoadBusy(retry, 'syncing'), true);
});
