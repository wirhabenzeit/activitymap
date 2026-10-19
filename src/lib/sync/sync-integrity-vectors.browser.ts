/** Browser verification through the production sync client and IndexedDB adapter. */
import type { ActivityDTO } from '~/contracts/v1/activity';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import type { PhotoDTO } from '~/contracts/v1/photo';
import { encodeStreamSummary } from '~/lib/streams/compact-summary';

import { compactStreamCorpus } from '../../../scripts/fixtures/compact-stream-corpus';
import fixtures from '../../../shared/sync-integrity-fixtures.v1.json';
import * as store from './v1-store';
import type { V1SyncMutation, V1SyncState } from './v1-store';
import { runV1Sync } from './v1-sync';

function check(value: unknown, expected: unknown, message: string) {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: ${JSON.stringify(value)} != ${JSON.stringify(expected)}`,
    );
  }
}
const mutations = (
  activities: ActivityDTO[],
  photos: PhotoDTO[] = [],
): V1SyncMutation[] => [
  ...activities.map((activity) => ({
    sequence: '1',
    entityType: 'activity' as const,
    operation: 'upsert' as const,
    id: activity.id,
    activity,
  })),
  ...photos.map((photo) => ({
    sequence: '1',
    entityType: 'photo' as const,
    operation: 'upsert' as const,
    id: photo.unique_id,
    photo,
  })),
];
const checkpoint = (scope: string): V1SyncState => ({
  scope,
  bootstrapCursor: 'snapshot',
  bootstrapComplete: true,
  changesCursor: 'old',
  lastSyncAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
});
const envelope = (body: unknown) => ({
  schemaVersion: '1',
  serverTime: '2026-10-18T00:00:00.000Z',
  data: body,
});

export async function runVectors() {
  const results: string[] = [];
  for (const vector of fixtures.vectors) {
    const scope = `auth:${vector.id}`;
    await store.clearV1Scope(scope);
    if (vector.initialComplete)
      await store.applyV1SyncPage(
        scope,
        mutations([fixtures.activity as ActivityDTO], [fixtures.photo]),
        checkpoint(scope),
      );
    for (const [roundIndex, round] of vector.rounds.entries()) {
      let index = 0;
      const controller = new AbortController();
      const published: string[] = [];
      let failed = false;
      let aborts = 0;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked with .call(this, ...).
      const originalPut = IDBObjectStore.prototype.put;
      if (round.failSave) {
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.name === 'sync_state') {
            aborts++;
            // Abort after the page's activity/photo requests have been queued.
            this.transaction.abort();
            throw new DOMException('Injected save failure', 'AbortError');
          }
          return key === undefined
            ? originalPut.call(this, value)
            : originalPut.call(this, value, key);
        };
      }
      try {
        await runV1Sync({
          scope,
          signal: controller.signal,
          onScopeReset: () => {
            published.push('reset');
          },
          onActivityChanges: (changes) => {
            published.push(...changes.map((change) => change.operation));
          },
          fetchImpl: async (input) => {
            const step = round.steps[index++];
            if (!step) throw new Error('Unexpected request');
            const url = new URL(input, location.origin);
            check(url.pathname, `/api/v1/sync/${step.kind}`, vector.id);
            check(url.searchParams.get('cursor'), step.cursor, vector.id);
            if ('resource' in step)
              check(url.searchParams.get('resource'), step.resource, vector.id);
            if ('error' in step) {
              if (step.error === 'network') throw new Error('offline');
              if (step.error === 'cancel') {
                controller.abort();
                return Response.json(envelope({}));
              }
              return Response.json(
                {
                  error: {
                    code: 'sync_rebootstrap_required',
                    message: 'Expired',
                    retryable: false,
                    requestId: 'test',
                  },
                },
                { status: 409 },
              );
            }
            return Response.json(envelope(step.body));
          },
        });
      } catch {
        failed = true;
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      if (
        vector.initialComplete &&
        round.expected.error &&
        vector.id !== 'cursor-cycle'
      ) {
        check(published, [], `${vector.id}: uncommitted data must not publish`);
      }
      check(failed, round.expected.error, `${vector.id}: error`);
      check(index, round.steps.length, `${vector.id}: consumed requests`);
      if (round.failSave) check(aborts, 1, `${vector.id}: actual IDB abort`);
      const activities = await store.getCachedActivityDTOs(scope);
      const photos = await store.getCachedPhotoDTOs(scope);
      const state = await store.getV1SyncState(scope);
      check(
        activities.map((a) => a.id).sort(),
        round.expected.activities,
        `${vector.id}: activities`,
      );
      check(
        photos.map((p) => p.unique_id).sort(),
        round.expected.photos,
        `${vector.id}: photos`,
      );
      check(
        state?.changesCursor ?? null,
        round.expected.cursor,
        `${vector.id}: cursor`,
      );
      check(
        state?.bootstrapComplete ?? false,
        round.expected.complete,
        `${vector.id}: completion`,
      );
      check(
        !!state?.lastSyncAt,
        round.expected.success,
        `${vector.id}: last success`,
      );
      results.push(`${vector.id}:${roundIndex}`);
    }
  }
  return results;
}

export async function extraStorageChecks() {
  const scope = 'auth:atomic';
  const otherScopes = ['auth:other-account', 'deployment:other:auth:atomic'];
  for (const current of [scope, ...otherScopes]) {
    await store.applyV1SyncPage(
      current,
      mutations([fixtures.activity as ActivityDTO], [fixtures.photo]),
      checkpoint(current),
    );
  }
  const metadata: StreamMetadata = {
    generation: '00000000-0000-4000-8000-000000000001',
    revision: '1',
    state: 'current',
    fetch_status: 'succeeded',
    available_types: ['distance', 'altitude'],
    fetched_at: '2026-10-18T00:00:00.000Z',
    expires_at: null,
  };
  await store.putCachedStreamSummaries(
    scope,
    [
      {
        data: {
          activity_id: '1',
          metadata,
          summary: encodeStreamSummary(compactStreamCorpus()[0]!.summary),
          last_error: null,
          next_retry_at: null,
        },
        requestedAgainst: metadata,
      },
    ],
    () => true,
  );
  check(
    (await store.getCachedStreamSummaries(scope, ['1'])).size,
    1,
    'seed summary',
  );
  const before = await store.getV1SyncState(scope);
  const controller = new AbortController();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked with .call(this, ...).
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    const request =
      key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
    if (this.name === 'sync_state') controller.abort();
    return request;
  };
  let failed = false;
  try {
    await store.applyV1SyncPage(
      scope,
      [{ sequence: '1', entityType: 'activity', operation: 'delete', id: '1' }],
      { ...checkpoint(scope), changesCursor: 'cancelled' },
      { signal: controller.signal },
    );
  } catch {
    failed = true;
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  check(failed, true, 'cancellation abort');
  check(await store.getV1SyncState(scope), before, 'cancelled checkpoint');
  check(
    (await store.getCachedActivityDTOs(scope)).map((a) => a.id),
    ['1'],
    'cancelled activity',
  );
  check(
    (await store.getCachedStreamSummaries(scope, ['1'])).size,
    1,
    'cancelled summary deletion rolls back',
  );
  await store.applyV1SyncPage(
    scope,
    mutations([
      {
        ...fixtures.activity,
        streams: { ...metadata, revision: '2' },
      } as ActivityDTO,
    ]),
    checkpoint(scope),
  );
  check(
    (await store.getCachedStreamSummaries(scope, ['1'])).size,
    0,
    'page metadata invalidates summary',
  );
  await store.applyV1SyncPage(
    scope,
    [],
    { ...checkpoint(scope), changesCursor: 'replacement' },
    { replace: true },
  );
  for (const current of otherScopes) {
    check(
      (await store.getCachedActivityDTOs(current)).map((a) => a.id),
      ['1'],
      'scope isolation',
    );
    check(
      (await store.getCachedPhotoDTOs(current)).map((a) => a.unique_id),
      ['photo:1'],
      'photo scope isolation',
    );
    check(
      (await store.getV1SyncState(current))?.changesCursor,
      'old',
      'checkpoint scope isolation',
    );
  }
  return [
    'cancellation-aborts-transaction',
    'account-and-deployment-isolation',
    'summary-rollback-and-metadata-invalidation',
  ];
}

export async function inspectReopened() {
  for (const id of ['page-save-rollback', 'replacement-save-rollback']) {
    const scope = `auth:${id}`;
    check(
      (await store.getCachedActivityDTOs(scope)).map((a) => a.id),
      ['1'],
      'reopened activities',
    );
    check(
      (await store.getCachedPhotoDTOs(scope)).map((a) => a.unique_id),
      ['photo:1'],
      'reopened photos',
    );
    check(
      (await store.getV1SyncState(scope))?.changesCursor,
      'old',
      'reopened checkpoint',
    );
  }
  return 'aborted-transactions-survive-reopen';
}
