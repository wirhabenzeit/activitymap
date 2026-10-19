'use client';

import type { QueryClient } from '@tanstack/react-query';

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';

import {
  type V1LibraryCommit,
  type V1LibrarySnapshot,
  type V1SyncState,
  readV1LibrarySnapshot,
  subscribeV1LibraryCommits,
} from './v1-store';

export const authenticatedLibraryScope = (userId: string) => `auth:${userId}`;
export const libraryQueryKeys = {
  root: (scope: string) => ['library', scope] as const,
  snapshot: (scope: string) => ['library', scope, 'snapshot'] as const,
};

export type LibrarySnapshot = {
  scope: string;
  revision: number;
  /** Cache hydration completed; this alone does not mean a library is complete. */
  loaded: boolean;
  completeness: 'unloaded' | 'partial' | 'complete';
  activities: ActivityDTO[];
  photos: PhotoDTO[];
  syncState: V1SyncState | null;
  error: Error | null;
};

export type LibraryOwnerStore = {
  readV1LibrarySnapshot: (
    scope: string,
    signal?: AbortSignal,
  ) => Promise<V1LibrarySnapshot>;
  subscribeV1LibraryCommits: (
    listener: (commit: V1LibraryCommit) => void,
  ) => () => void;
};
const defaultStore: LibraryOwnerStore = {
  readV1LibrarySnapshot,
  subscribeV1LibraryCommits,
};

function unloadedSnapshot(scope: string): LibrarySnapshot {
  return {
    scope,
    revision: 0,
    loaded: false,
    completeness: 'unloaded',
    activities: [],
    photos: [],
    syncState: null,
    error: null,
  };
}

/** The sole authenticated library read model. Network scheduling lives elsewhere. */
export class LibraryOwner {
  private snapshot: LibrarySnapshot;
  private readonly serverSnapshot: LibrarySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private unsubscribeStore: (() => void) | null = null;
  private requestedVersion = 0;
  private processedVersion = 0;
  private running: Promise<void> | null = null;
  private disposed = false;
  private leases = 0;
  private needsHydration = true;

  constructor(
    private readonly client: QueryClient,
    readonly scope: string,
    private readonly store: LibraryOwnerStore = defaultStore,
  ) {
    this.snapshot = unloadedSnapshot(scope);
    this.serverSnapshot = this.snapshot;
  }

  private ensureSubscribed() {
    if (this.disposed || this.unsubscribeStore) return;
    const scope = this.scope;
    this.unsubscribeStore = this.store.subscribeV1LibraryCommits((commit) => {
      if (commit.scope !== scope || this.disposed) return;
      if (commit.kind === 'clear') {
        // Immediately fence a pending old read and clear every visible projection.
        this.requestedVersion++;
        this.publish({
          ...unloadedSnapshot(scope),
          loaded: true,
          revision: this.snapshot.revision + 1,
        });
      }
      void this.refresh().catch(() => {
        /* The snapshot carries cache read errors. */
      });
    });
  }

  private acquireLease() {
    if (this.disposed)
      return {
        activated: false,
        release: () => {
          /* Already disposed. */
        },
      };
    const activated = this.leases++ === 0;
    if (activated) this.ensureSubscribed();
    let released = false;
    return {
      activated,
      release: () => {
        if (released || this.disposed) return;
        released = true;
        if (--this.leases !== 0) return;
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        // Keep the published cache, but reconcile commits missed while inactive.
        this.needsHydration = true;
      },
    };
  }

  /** Hold browser resources only while a provider/view needs this owner. */
  retain = () => {
    const lease = this.acquireLease();
    if (lease.activated && this.snapshot.loaded) {
      void this.refresh().catch(() => {
        /* The previous snapshot remains visible alongside any read error. */
      });
    }
    return lease.release;
  };

  getSnapshot = () => this.snapshot;
  /** SSR must never read a previously hydrated browser/account snapshot. */
  getServerSnapshot = () => this.serverSnapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    const release = this.retain();
    return () => {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Set
      this.listeners.delete(listener);
      release();
    };
  };

  load = async (): Promise<void> => {
    if (this.disposed) return;
    if (!this.snapshot.loaded || this.needsHydration) await this.refresh();
  };

  /** Coalesce subscribers while keeping reads ordered with committed changes. */
  refresh = async (): Promise<void> => {
    if (this.disposed) return;
    const lease = this.acquireLease();
    try {
      const requested = ++this.requestedVersion;
      while (!this.disposed && this.processedVersion < requested) {
        this.running ??= Promise.resolve()
          .then(() => this.readCurrent())
          .finally(() => {
            this.running = null;
          });
        await this.running;
      }
    } finally {
      lease.release();
    }
  };

  private async readCurrent() {
    while (!this.disposed) {
      const requested = this.requestedVersion;
      try {
        const data = await this.store.readV1LibrarySnapshot(
          this.scope,
          this.lifetime.signal,
        );
        if (this.disposed) return;
        if (requested !== this.requestedVersion) continue;
        this.processedVersion = requested;
        this.needsHydration = false;
        const complete =
          data.syncState?.bootstrapComplete === true &&
          data.syncState.lastSyncAt !== null;
        this.publish({
          ...data,
          scope: this.scope,
          revision: this.snapshot.revision + 1,
          loaded: true,
          completeness: complete
            ? 'complete'
            : data.syncState || data.activities.length || data.photos.length
              ? 'partial'
              : 'unloaded',
          error: null,
        });
        return;
      } catch (error) {
        if (this.disposed) return;
        if (requested !== this.requestedVersion) continue;
        this.processedVersion = requested;
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.publish({
          ...this.snapshot,
          revision: this.snapshot.revision + 1,
          error: failure,
        });
        throw failure;
      }
    }
  }

  private publish(snapshot: LibrarySnapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    // QueryClient structural sharing retains unchanged DTO arrays between polls.
    this.snapshot =
      this.client.setQueryData<LibrarySnapshot>(
        libraryQueryKeys.snapshot(this.scope),
        snapshot,
      ) ?? snapshot;
    for (const listener of this.listeners) listener();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.leases = 0;
    this.lifetime.abort();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.snapshot = {
      ...unloadedSnapshot(this.scope),
      revision: this.snapshot.revision + 1,
    };
    this.client.removeQueries({ queryKey: libraryQueryKeys.root(this.scope) });
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}

const owners = new WeakMap<QueryClient, Map<string, LibraryOwner>>();
export function getLibraryOwner(client: QueryClient, scope: string) {
  let scoped = owners.get(client);
  if (!scoped) {
    scoped = new Map();
    owners.set(client, scoped);
  }
  let owner = scoped.get(scope);
  if (!owner) {
    owner = new LibraryOwner(client, scope);
    scoped.set(scope, owner);
  }
  return owner;
}

export function disposeLibraryScope(client: QueryClient, scope: string) {
  const scoped = owners.get(client);
  scoped?.get(scope)?.dispose();
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
  scoped?.delete(scope);
  client.removeQueries({ queryKey: libraryQueryKeys.root(scope) });
}
