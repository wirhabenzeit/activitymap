'use client';

import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

import type { ActivityDTO } from '~/contracts/v1/activity';
import type { PhotoDTO } from '~/contracts/v1/photo';

/**
 * Live library reads from the Convex application backend for `live` preview
 * owners (docs/convex-reactive-reads.md).
 *
 * The browser library store is the cache. It remembers the change-feed
 * position its cards were brought up to (`LiveCursor`). A load resumes from
 * there: one subscription to `library.changes` delivers only what changed
 * since, and keeps delivering new changes while the page is open. Only
 * without a usable position (first load, compacted history, or a different
 * library version) is the library read once through `library.list`, after
 * which the feed continues from the head sequence read before the first page.
 *
 * Only activities that changed in Convex are written, so a local edit that
 * has not reached Convex yet (it arrives through the shadow mirror) is not
 * reverted by unrelated changes.
 *
 * Photos are not part of the cards. The feed only says that photos changed
 * (`photos`); the caller then reads the photo list (`LiveLibrary.photos`)
 * and reconciles the store (`live-photos.ts`).
 */

type Card = Omit<ActivityDTO, 'map_polyline'>;
type ListPage = { page: Card[]; isDone: boolean; continueCursor: string };
type PaginationOpts = { numItems: number; cursor: string | null };
type Position = {
  sequence: number;
  version: string;
  matchingVersion: string;
};
export type ChangesResult =
  | (Position & { reload: true })
  | (Position & {
      reload: false;
      more: boolean;
      /** Photos changed in this read. */
      photos?: boolean;
      upserts: Card[];
      deletes: string[];
    });

const listQuery = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOpts },
  ListPage
>('library:list');
const changesQuery = makeFunctionReference<
  'query',
  { after: number | null },
  ChangesResult
>('library:changes');
const activityQuery = makeFunctionReference<
  'query',
  { id: string },
  ActivityDTO | null
>('library:activity');
const photosQuery = makeFunctionReference<
  'query',
  { after: string | null },
  { items: PhotoDTO[]; next: string | null }
>('library:photos');

export const LIVE_PAGE_SIZE = 256;

/** The change-feed position the stored cards are current to. */
export type LiveCursor = { sequence: number; version: string };

export type LiveLibraryStore = {
  /** The stored position, or null when the store must be loaded again. */
  cursor: () => Promise<LiveCursor | null>;
  /** Commit cards, deletions and the position they bring the store to in
   * one transaction. A null cursor marks the store as being reloaded. */
  apply: (change: {
    upserts: ActivityDTO[];
    deletes: string[];
    cursor: LiveCursor | null;
    matchingVersion: string;
  }) => Promise<void>;
  /** IDs currently held for this account, to drop rows Convex no longer has. */
  heldIds: () => Promise<string[]>;
};

export type LiveLibraryEvents = {
  /** The store holds a usable library: resumed, or the first page loaded. */
  onReady?: () => void;
  /** The store has caught up with Convex once. */
  onComplete?: () => void;
  /** A batch that added or changed activities was committed. */
  onChange?: () => void;
  /** A committed batch included photo changes. */
  onPhotoChange?: () => void;
  /** Authentication or a query failed; the caller falls back to REST. */
  onError: (error: Error) => void;
};

/** The minimal client surface used here, so tests can drive results. */
export type LiveClient = {
  onUpdate: (
    query: typeof changesQuery,
    args: { after: number },
    callback: (result: ChangesResult) => void,
    onError: (error: Error) => void,
  ) => () => void;
  query: <
    Query extends
      | typeof listQuery
      | typeof changesQuery
      | typeof activityQuery
      | typeof photosQuery,
  >(
    query: Query,
    args: Query['_args'],
  ) => Promise<Query['_returnType']>;
  close: () => Promise<void> | void;
};

const toDTO = (card: Card): ActivityDTO => ({ ...card, map_polyline: null });

export class LiveLibrary {
  private writes: Promise<void> = Promise.resolve();
  private unsubscribe: () => void = () => undefined;
  /** The sequence the current subscription reads after. */
  private following: number | null = null;
  private version = '';
  private disposed = false;
  private ready = false;
  private completed = false;
  private failed = false;

  constructor(
    private readonly client: LiveClient,
    private readonly store: LiveLibraryStore,
    private readonly events: LiveLibraryEvents,
    private readonly pageSize = LIVE_PAGE_SIZE,
  ) {
    this.enqueue(async () => this.resume(await this.store.cursor()));
  }

  /** The full activity, including the detailed polyline. */
  async activity(id: string): Promise<ActivityDTO | null> {
    return await this.client.query(activityQuery, { id });
  }

  /** The owner's whole photo list as Convex holds it now. */
  async photos(): Promise<PhotoDTO[]> {
    const all: PhotoDTO[] = [];
    let after: string | null = null;
    do {
      const page: { items: PhotoDTO[]; next: string | null } =
        await this.client.query(photosQuery, { after });
      all.push(...page.items);
      after = page.next;
    } while (after !== null && !this.disposed);
    return all;
  }

  /** Continue from a stored position, or load the library when there is none
   * (or it is no longer valid). */
  private async resume(saved: LiveCursor | null) {
    this.stopFollowing();
    let result = await this.client.query(changesQuery, {
      after: saved?.sequence ?? null,
    });
    if (!result.reload && result.version !== saved?.version)
      result = await this.client.query(changesQuery, { after: null });
    if (result.reload) {
      await this.reload(result);
      return;
    }
    // The stored cards are current up to `saved`: usable right away.
    this.version = result.version;
    this.markReady();
    await this.receive(saved!.sequence, result);
  }

  /** Read the whole library once, then follow the feed from `start`. */
  private async reload(start: Position) {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page: ListPage = await this.client.query(listQuery, {
        paginationOpts: { numItems: this.pageSize, cursor },
      });
      if (this.disposed) return;
      for (const card of page.page) seen.add(card.id);
      await this.store.apply({
        upserts: page.page.map(toDTO),
        deletes: [],
        cursor: null,
        matchingVersion: start.matchingVersion,
      });
      this.markReady();
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    // Rows from an earlier load that Convex no longer has. Changes made while
    // the pages were read have sequences after `start` and follow below.
    const stale = (await this.store.heldIds()).filter((id) => !seen.has(id));
    await this.store.apply({
      upserts: [],
      deletes: stale,
      cursor: { sequence: start.sequence, version: start.version },
      matchingVersion: start.matchingVersion,
    });
    this.version = start.version;
    this.follow(start.sequence);
  }

  private follow(after: number) {
    this.stopFollowing();
    this.following = after;
    this.unsubscribe = this.client.onUpdate(
      changesQuery,
      { after },
      (result) => {
        if (this.disposed || this.following !== after) return;
        // Nothing new (the first result, or a re-run for an unrelated head
        // update): the store is current; keep this subscription.
        if (
          !result.reload &&
          result.version === this.version &&
          result.sequence === after
        ) {
          this.markComplete();
          return;
        }
        // Stop listening to this position while its result is written.
        this.stopFollowing();
        this.enqueue(() => this.receive(after, result));
      },
      (error) => this.fail(error),
    );
  }

  private stopFollowing() {
    this.following = null;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = () => undefined;
    unsubscribe();
  }

  private async receive(after: number, result: ChangesResult) {
    if (this.disposed) return;
    if (result.reload || result.version !== this.version) {
      await this.resume(null);
      return;
    }
    if (result.sequence !== after) {
      await this.store.apply({
        upserts: result.upserts.map(toDTO),
        deletes: result.deletes,
        cursor: { sequence: result.sequence, version: result.version },
        matchingVersion: result.matchingVersion,
      });
      if (result.upserts.length > 0) this.events.onChange?.();
      if (result.photos) this.events.onPhotoChange?.();
    }
    if (!result.more) this.markComplete();
    this.follow(result.sequence);
  }

  private markComplete() {
    if (this.completed) return;
    this.completed = true;
    this.events.onComplete?.();
  }

  private markReady() {
    if (this.ready) return;
    this.ready = true;
    this.events.onReady?.();
  }

  private enqueue(task: () => Promise<void> | void) {
    this.writes = this.writes
      .then(async () => {
        if (!this.disposed) await task();
      })
      .catch((error: unknown) =>
        this.fail(error instanceof Error ? error : new Error(String(error))),
      );
  }

  private fail(error: Error) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.stopFollowing();
    this.events.onError(error);
  }

  /** Resolves once every result received so far is committed. */
  settled() {
    return this.writes;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFollowing();
    void this.client.close();
  }
}

/** A Convex client that authenticates with short-lived Better Auth tokens. */
export function createLiveClient(
  url: string,
  fetchToken: () => Promise<string | null>,
  onAuthChange: (authenticated: boolean) => void,
): LiveClient {
  const client = new ConvexClient(url);
  client.setAuth(fetchToken, onAuthChange);
  return {
    onUpdate: (query, args, callback, onError) =>
      client.onUpdate(query, args, callback, onError),
    query: (query, args) => client.query(query, args),
    close: () => client.close(),
  };
}
