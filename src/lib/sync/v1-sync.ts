'use client';

/** Ordered, page-atomic v1 synchronization for one account/deployment scope. */
import type { StreamMetadata } from '~/contracts/v1/activity-streams';
import {
  type FetchLike,
  SyncRebootstrapRequiredError,
  drainSyncBootstrap,
  drainSyncChanges,
} from '~/lib/sync/v1-client';
import * as v1Store from '~/lib/sync/v1-store';
import type { V1SyncMutation, V1SyncState } from '~/lib/sync/v1-store';

export type V1SyncStoreDeps = Pick<
  typeof v1Store,
  'getV1SyncState' | 'applyV1SyncPage' | 'clearV1Scope'
>;

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
  /** Test overrides; production uses the real network and IndexedDB adapter. */
  store?: V1SyncStoreDeps;
  fetchImpl?: FetchLike;
  /** Fence dependent caches when a new library has replaced the old one. */
  onScopeReset?: () => void | Promise<void>;
  /** Observations are published only after the corresponding data commits. */
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
const observations = (items: V1SyncMutation[]): V1ActivityStreamChange[] =>
  items.flatMap((item) =>
    item.entityType === 'activity'
      ? [
          {
            activityId: item.id,
            operation: item.operation,
            metadata: item.activity?.streams,
          },
        ]
      : [],
  );

const emptyResult = (
  mode: V1SyncResult['mode'],
  cursor = '',
): V1SyncResult => ({
  mode,
  cursor,
  activityUpserts: 0,
  photoUpserts: 0,
  activityDeletes: 0,
  photoDeletes: 0,
});

function count(result: V1SyncResult, items: V1SyncMutation[]) {
  for (const item of items) {
    if (item.entityType === 'activity') {
      if (item.operation === 'upsert') result.activityUpserts++;
      else result.activityDeletes++;
    } else if (item.operation === 'upsert') result.photoUpserts++;
    else result.photoDeletes++;
  }
}

type Commit = (items: V1SyncMutation[], state: V1SyncState) => Promise<void>;

async function catchUp(
  initial: V1SyncState,
  result: V1SyncResult,
  commit: Commit,
  options: V1SyncOptions,
): Promise<V1SyncState> {
  let state = initial;
  await drainSyncChanges(
    initial.changesCursor!,
    async (page) => {
      // A cache created before place bundles existed needs one full snapshot.
      // Stage it before replacing the completed offline library.
      if (page.freshness.placeMatchingVersion && !state.placesSyncReady)
        throw new SyncRebootstrapRequiredError({ requestId: null });
      const caughtUp =
        page.items.length === 0 && page.nextCursor === state.changesCursor;
      state = {
        ...state,
        changesCursor: page.nextCursor,
        bootstrapComplete: caughtUp || state.bootstrapComplete,
        lastSyncAt: caughtUp ? nowIso() : state.lastSyncAt,
        updatedAt: nowIso(),
        placeMatchingVersion:
          page.freshness.placeMatchingVersion ?? state.placeMatchingVersion,
      };
      await commit(page.items, state);
      count(result, page.items);
      result.cursor = page.nextCursor;
    },
    options,
  );
  return state;
}

async function bootstrap(
  options: V1SyncOptions,
  store: V1SyncStoreDeps,
): Promise<V1SyncResult> {
  const { scope, signal, onScopeReset, onActivityChanges } = options;
  signal?.throwIfAborted();
  const previous = await store.getV1SyncState(scope);
  // Initial/interrupted bootstraps persist partial pages, explicitly incomplete.
  // Completed libraries stay usable until their entire replacement is ready.
  const replacing =
    previous?.bootstrapComplete === true && previous.lastSyncAt !== null;
  const staged: V1SyncMutation[] = [];
  const result = emptyResult('bootstrap');
  let state: V1SyncState = {
    scope,
    bootstrapCursor: null,
    bootstrapComplete: false,
    changesCursor: null,
    lastSyncAt: null,
    updatedAt: nowIso(),
    placesSyncReady: undefined,
  };
  const commit: Commit = async (items, checkpoint) => {
    signal?.throwIfAborted();
    if (replacing) {
      staged.push(...items);
    } else {
      await store.applyV1SyncPage(scope, items, checkpoint, { signal });
      await onActivityChanges?.(observations(items));
    }
  };
  if (!replacing) {
    await onScopeReset?.();
    signal?.throwIfAborted();
    await store.clearV1Scope(scope);
  }
  for (const resource of ['activities', 'photos'] as const) {
    await drainSyncBootstrap(
      resource,
      async (page) => {
        if (page.snapshotCursor) state.bootstrapCursor = page.snapshotCursor;
        if (page.resource === 'activities')
          state.placesSyncReady =
            (state.placesSyncReady ?? true) &&
            Boolean(page.freshness.placeMatchingVersion);
        const items: V1SyncMutation[] =
          page.resource === 'activities'
            ? page.items.map((activity) => ({
                sequence: '0',
                entityType: 'activity',
                operation: 'upsert',
                id: activity.id,
                activity,
              }))
            : page.items.map((photo) => ({
                sequence: '0',
                entityType: 'photo',
                operation: 'upsert',
                id: photo.unique_id,
                photo,
              }));
        state = {
          ...state,
          updatedAt: nowIso(),
          placeMatchingVersion:
            page.freshness.placeMatchingVersion ?? state.placeMatchingVersion,
        };
        await commit(items, state);
        count(result, items);
      },
      options,
    );
  }
  if (!state.bootstrapCursor)
    throw new Error('Missing bootstrap snapshot cursor');
  state.changesCursor = state.bootstrapCursor;
  state = await catchUp(state, result, commit, options);
  if (replacing) {
    signal?.throwIfAborted();
    await store.applyV1SyncPage(scope, staged, state, {
      replace: true,
      signal,
    });
    await onScopeReset?.();
    await onActivityChanges?.(observations(staged));
  }
  return result;
}

/**
 * A rejected cursor triggers exactly one replacement attempt. Failed staging,
 * cancellation, or IDB save leaves the completed library/checkpoint intact.
 * Initial partial bootstraps restart from a clean scope on the next attempt.
 */
export async function runV1Sync(options: V1SyncOptions): Promise<V1SyncResult> {
  const { scope, signal, onActivityChanges } = options;
  const store = options.store ?? v1Store;
  signal?.throwIfAborted();
  const state = await store.getV1SyncState(scope);
  try {
    if (!state?.bootstrapComplete || !state.changesCursor)
      return await bootstrap(options, store);
    const result = emptyResult('changes', state.changesCursor);
    await catchUp(
      state,
      result,
      async (items, checkpoint) => {
        signal?.throwIfAborted();
        await store.applyV1SyncPage(scope, items, checkpoint, { signal });
        await onActivityChanges?.(observations(items));
      },
      options,
    );
    return result;
  } catch (error) {
    if (error instanceof SyncRebootstrapRequiredError)
      return bootstrap(options, store);
    throw error;
  }
}
