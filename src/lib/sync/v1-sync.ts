'use client';

/**
 * Orchestrates the v1 sync protocol end to end for one auth scope: full
 * bootstrap the first time, then `/sync/changes` catch-up on every later
 * call, automatically re-bootstrapping on `409 sync_rebootstrap_required`.
 *
 * This ties together `~/lib/sync/v1-client.ts` (the network calls) and
 * `~/lib/sync/v1-store.ts` (the DTO-typed local cache); nothing here is
 * wired into the app yet — issue #126 phase 1 is additive-only. Phase 2
 * calls `runV1Sync` from `~/components/providers/offline-sync.tsx` in place
 * of the legacy `syncOfflineData`.
 */

import {
  drainSyncBootstrap,
  drainSyncChanges,
  SyncRebootstrapRequiredError,
  type FetchLike,
} from '~/lib/sync/v1-client';
import * as v1Store from '~/lib/sync/v1-store';
import type { V1SyncState } from '~/lib/sync/v1-store';
import type { SyncChangeItemDTO } from '~/contracts/v1/sync';
import type { StreamMetadata } from '~/contracts/v1/activity-streams';

/**
 * The subset of `~/lib/sync/v1-store.ts` this module depends on, as an
 * injectable object — defaulting to the real IndexedDB-backed module, but
 * swappable for an in-memory fake in tests (see `v1-sync.test.ts`), the
 * same dependency-injection shape used across this codebase's server-side
 * application services (e.g. `~/server/application/activities.ts`).
 */
export type V1SyncStoreDeps = Pick<
  typeof v1Store,
  | 'getV1SyncState'
  | 'setV1SyncState'
  | 'upsertActivityDTOs'
  | 'upsertPhotoDTOs'
  | 'deleteActivityDTOsByIds'
  | 'deletePhotoDTOsByActivityIds'
  | 'deletePhotoDTOsByIds'
  | 'clearV1Scope'
>;

const defaultStoreDeps: V1SyncStoreDeps = v1Store;

export type V1SyncResult = {
  mode: 'bootstrap' | 'changes';
  activityUpserts: number;
  photoUpserts: number;
  activityDeletes: number;
  photoDeletes: number;
  cursor: string;
};

export type V1SyncOptions = {
  scope: string;
  signal?: AbortSignal;
  /** Test-only overrides; production callers omit both. */
  store?: V1SyncStoreDeps;
  fetchImpl?: FetchLike;
  /** Called before a bootstrap clears/replaces the local scope. */
  onScopeReset?: () => void | Promise<void>;
  /** Ordered activity lifecycle/metadata observations for client caches. */
  onActivityChanges?: (
    changes: V1ActivityStreamChange[],
  ) => void | Promise<void>;
};

export type V1ActivityStreamChange = {
  activityId: string;
  operation: 'upsert' | 'delete';
  metadata?: StreamMetadata;
};

const nowIso = (): string => new Date().toISOString();

async function runBootstrap(
  scope: string,
  signal: AbortSignal | undefined,
  store: V1SyncStoreDeps,
  fetchImpl: FetchLike | undefined,
  onActivityChanges: V1SyncOptions['onActivityChanges'],
): Promise<V1SyncResult> {
  let activityUpserts = 0;
  let photoUpserts = 0;

  const activitiesResult = await drainSyncBootstrap(
    'activities',
    async (page) => {
      if (page.resource !== 'activities') return;
      activityUpserts += page.items.length;
      await store.upsertActivityDTOs(scope, page.items);
      await onActivityChanges?.(
        page.items.map((activity) => ({
          activityId: activity.id,
          operation: 'upsert' as const,
          metadata: activity.streams,
        })),
      );
    },
    { signal, fetchImpl },
  );

  await drainSyncBootstrap(
    'photos',
    async (page) => {
      if (page.resource !== 'photos') return;
      photoUpserts += page.items.length;
      await store.upsertPhotoDTOs(scope, page.items);
    },
    { signal, fetchImpl },
  );

  const snapshotCursor = activitiesResult.snapshotCursor;
  if (!snapshotCursor) {
    throw new Error(
      'v1 sync bootstrap did not yield a snapshotCursor from resource=activities',
    );
  }

  const state: V1SyncState = {
    scope,
    bootstrapCursor: snapshotCursor,
    bootstrapComplete: true,
    changesCursor: snapshotCursor,
    lastSyncAt: nowIso(),
    updatedAt: nowIso(),
  };
  await store.setV1SyncState(state);

  return {
    mode: 'bootstrap',
    activityUpserts,
    photoUpserts,
    activityDeletes: 0,
    photoDeletes: 0,
    cursor: snapshotCursor,
  };
}

async function applyChangesPage(
  scope: string,
  items: SyncChangeItemDTO[],
  store: V1SyncStoreDeps,
  onActivityChanges: V1SyncOptions['onActivityChanges'],
): Promise<{
  activityUpserts: number;
  photoUpserts: number;
  activityDeletes: number;
  photoDeletes: number;
}> {
  const activityUpsertItems = items.filter(
    (item) =>
      item.entityType === 'activity' &&
      item.operation === 'upsert' &&
      item.activity,
  );
  const photoUpsertItems = items.filter(
    (item) =>
      item.entityType === 'photo' && item.operation === 'upsert' && item.photo,
  );
  const activityDeleteIds = items
    .filter(
      (item) => item.entityType === 'activity' && item.operation === 'delete',
    )
    .map((item) => item.id);
  const photoDeleteIds = items
    .filter(
      (item) => item.entityType === 'photo' && item.operation === 'delete',
    )
    .map((item) => item.id);

  await Promise.all([
    store.upsertActivityDTOs(
      scope,
      activityUpsertItems.map((item) => item.activity!),
    ),
    store.upsertPhotoDTOs(
      scope,
      photoUpsertItems.map((item) => item.photo!),
    ),
    store.deleteActivityDTOsByIds(scope, activityDeleteIds),
    store.deletePhotoDTOsByActivityIds(scope, activityDeleteIds),
    store.deletePhotoDTOsByIds(scope, photoDeleteIds),
  ]);

  await onActivityChanges?.(
    items.flatMap((item): V1ActivityStreamChange[] => {
      if (item.entityType !== 'activity') return [];
      if (item.operation === 'delete') {
        return [{ activityId: item.id, operation: 'delete' }];
      }
      if (!item.activity) return [];
      return [
        {
          activityId: item.id,
          operation: 'upsert',
          metadata: item.activity.streams,
        },
      ];
    }),
  );

  return {
    activityUpserts: activityUpsertItems.length,
    photoUpserts: photoUpsertItems.length,
    activityDeletes: activityDeleteIds.length,
    photoDeletes: photoDeleteIds.length,
  };
}

async function runChangesCatchup(
  scope: string,
  bootstrapCursor: string,
  cursor: string,
  signal: AbortSignal | undefined,
  store: V1SyncStoreDeps,
  fetchImpl: FetchLike | undefined,
  onActivityChanges: V1SyncOptions['onActivityChanges'],
): Promise<V1SyncResult> {
  let activityUpserts = 0;
  let photoUpserts = 0;
  let activityDeletes = 0;
  let photoDeletes = 0;

  const { nextCursor } = await drainSyncChanges(
    cursor,
    async (page) => {
      const applied = await applyChangesPage(
        scope,
        page.items,
        store,
        onActivityChanges,
      );
      activityUpserts += applied.activityUpserts;
      photoUpserts += applied.photoUpserts;
      activityDeletes += applied.activityDeletes;
      photoDeletes += applied.photoDeletes;
    },
    { signal, fetchImpl },
  );

  await store.setV1SyncState({
    scope,
    bootstrapCursor,
    bootstrapComplete: true,
    changesCursor: nextCursor,
    lastSyncAt: nowIso(),
    updatedAt: nowIso(),
  });

  return {
    mode: 'changes',
    activityUpserts,
    photoUpserts,
    activityDeletes,
    photoDeletes,
    cursor: nextCursor,
  };
}

async function runFreshBootstrap(
  scope: string,
  signal: AbortSignal | undefined,
  store: V1SyncStoreDeps,
  fetchImpl: FetchLike | undefined,
  onScopeReset: V1SyncOptions['onScopeReset'],
  onActivityChanges: V1SyncOptions['onActivityChanges'],
): Promise<V1SyncResult> {
  // A failed bootstrap can leave pages in IndexedDB without a completed
  // state record. Always restart from a clean scope so rows deleted between
  // attempts cannot survive as ghosts in the local cache.
  await onScopeReset?.();
  await store.clearV1Scope(scope);

  const bootstrap = await runBootstrap(
    scope,
    signal,
    store,
    fetchImpl,
    onActivityChanges,
  );

  // The snapshot cursor is captured before all bootstrap pages have been
  // read. Drain changes immediately so mutations concurrent with bootstrap
  // are visible before this sync pass reports success.
  const catchup = await runChangesCatchup(
    scope,
    bootstrap.cursor,
    bootstrap.cursor,
    signal,
    store,
    fetchImpl,
    onActivityChanges,
  );

  return {
    mode: 'bootstrap',
    activityUpserts: bootstrap.activityUpserts + catchup.activityUpserts,
    photoUpserts: bootstrap.photoUpserts + catchup.photoUpserts,
    activityDeletes: catchup.activityDeletes,
    photoDeletes: catchup.photoDeletes,
    cursor: catchup.cursor,
  };
}

/**
 * Runs one sync pass for `scope` (e.g. `auth:<userId>`): bootstraps from
 * scratch if this scope has never finished a bootstrap, otherwise catches
 * up via `/sync/changes`. On `409 sync_rebootstrap_required` the local
 * scope is cleared and bootstrap is retried exactly once — a second
 * rebootstrap request in the same call would indicate a server-side bug,
 * not a transient client state, so it is left to surface as an error
 * rather than looping.
 */
export async function runV1Sync({
  scope,
  signal,
  store = defaultStoreDeps,
  fetchImpl,
  onScopeReset,
  onActivityChanges,
}: V1SyncOptions): Promise<V1SyncResult> {
  const state = await store.getV1SyncState(scope);

  try {
    if (!state?.bootstrapComplete || !state.changesCursor) {
      return await runFreshBootstrap(
        scope,
        signal,
        store,
        fetchImpl,
        onScopeReset,
        onActivityChanges,
      );
    }
    return await runChangesCatchup(
      scope,
      state.bootstrapCursor ?? state.changesCursor,
      state.changesCursor,
      signal,
      store,
      fetchImpl,
      onActivityChanges,
    );
  } catch (error) {
    if (error instanceof SyncRebootstrapRequiredError) {
      return runFreshBootstrap(
        scope,
        signal,
        store,
        fetchImpl,
        onScopeReset,
        onActivityChanges,
      );
    }
    throw error;
  }
}
