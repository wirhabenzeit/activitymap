'use client';

import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

import type { ActivityDTO } from '~/contracts/v1/activity';

/**
 * Live library reads from the Convex application backend for `live` preview
 * owners (docs/convex-reactive-reads.md).
 *
 * `library.list` is subscribed page by page. Once a page's end is known it is
 * re-subscribed pinned to that cursor range, so page boundaries never move and
 * a row disappearing from a page means it was deleted. The last page stays
 * open-ended and picks up new activities.
 *
 * Writes into the browser library store are diffed against the previous
 * *Convex* version of each row, not against the store: a local edit that has
 * not reached Convex yet (it arrives through the shadow mirror) is not
 * reverted when an unrelated row on the same page changes.
 */

type Card = Omit<ActivityDTO, 'map_polyline'>;
type ListPage = { page: Card[]; isDone: boolean; continueCursor: string };
type PaginationOpts = {
  numItems: number;
  cursor: string | null;
  endCursor?: string | null;
};

const listQuery = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOpts },
  ListPage
>('library:list');
const activityQuery = makeFunctionReference<
  'query',
  { id: string },
  ActivityDTO | null
>('library:activity');

export const LIVE_PAGE_SIZE = 256;

export type LiveLibraryStore = {
  upsert: (items: ActivityDTO[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  /** IDs currently held for this account, to drop rows Convex no longer has. */
  heldIds: () => Promise<string[]>;
  complete: (state: { placeMatchingVersion?: string }) => Promise<void>;
};

export type LiveLibraryEvents = {
  /** The first page is written: the map can render. */
  onFirstPage?: () => void;
  /** Every page is written once. */
  onComplete?: () => void;
  /** Authentication or a query failed; the caller falls back to REST. */
  onError: (error: Error) => void;
};

/** The minimal client surface used here, so tests can drive pages directly. */
export type LiveClient = {
  onUpdate: (
    query: typeof listQuery,
    args: { paginationOpts: PaginationOpts },
    callback: (page: ListPage) => void,
    onError: (error: Error) => void,
  ) => () => void;
  query: (
    query: typeof activityQuery,
    args: { id: string },
  ) => Promise<unknown>;
  close: () => Promise<void> | void;
};

type PageState = {
  cursor: string | null;
  /** Set once the page's end is known and its subscription is pinned. */
  end: string | null;
  unsubscribe: () => void;
  rows: Map<string, string>;
  loaded: boolean;
};

const toDTO = (card: Card): ActivityDTO => ({ ...card, map_polyline: null });

export class LiveLibrary {
  private readonly pages: PageState[] = [];
  private writes: Promise<void> = Promise.resolve();
  private disposed = false;
  private firstPage = false;
  private completed = false;
  private failed = false;

  constructor(
    private readonly client: LiveClient,
    private readonly store: LiveLibraryStore,
    private readonly events: LiveLibraryEvents,
    private readonly pageSize = LIVE_PAGE_SIZE,
  ) {
    this.subscribe(0, null, null);
  }

  /** The full activity, including the detailed polyline. */
  async activity(id: string): Promise<ActivityDTO | null> {
    return (await this.client.query(activityQuery, {
      id,
    })) as ActivityDTO | null;
  }

  private subscribe(index: number, cursor: string | null, end: string | null) {
    const previous = this.pages[index];
    const state: PageState = {
      cursor,
      end,
      rows: previous?.rows ?? new Map<string, string>(),
      loaded: previous?.loaded ?? false,
      unsubscribe: () => undefined,
    };
    this.pages[index] = state;
    state.unsubscribe = this.client.onUpdate(
      listQuery,
      {
        paginationOpts: {
          numItems: this.pageSize,
          cursor,
          ...(end !== null && { endCursor: end }),
        },
      },
      (page) => {
        if (this.disposed || this.pages[index] !== state) return;
        this.receive(index, state, page);
      },
      (error) => this.fail(error),
    );
    previous?.unsubscribe();
  }

  private receive(index: number, state: PageState, page: ListPage) {
    const next = new Map(
      page.page.map((card) => [card.id, JSON.stringify(card)]),
    );
    const changed = page.page.filter(
      (card) => state.rows.get(card.id) !== next.get(card.id),
    );
    const removed = [...state.rows.keys()].filter((id) => !next.has(id));
    state.rows = next;
    const firstLoad = !state.loaded;
    state.loaded = true;
    this.enqueue(async () => {
      await this.store.upsert(changed.map(toDTO));
      await this.store.remove(removed);
    });
    if (index === 0 && !this.firstPage) {
      this.firstPage = true;
      this.enqueue(async () => this.events.onFirstPage?.());
    }
    if (!page.isDone && state.end === null) {
      // Pin this page to its range, then load the one after it.
      this.subscribe(index, state.cursor, page.continueCursor);
      if (!this.pages[index + 1])
        this.subscribe(index + 1, page.continueCursor, null);
    }
    if (firstLoad && page.isDone) this.maybeComplete();
  }

  private maybeComplete() {
    if (this.completed) return;
    const last = this.pages.at(-1);
    if (!last?.loaded || !this.pages.every((page) => page.loaded)) return;
    this.completed = true;
    const seen = new Set(this.pages.flatMap((page) => [...page.rows.keys()]));
    const placeMatchingVersion = this.pages
      .flatMap((page) => [...page.rows.values()])
      .map((json) => (JSON.parse(json) as Card).placeMatches?.matchingVersion)
      .find((version) => version !== undefined);
    this.enqueue(async () => {
      // Rows left over from an earlier REST sync that Convex does not have.
      const stale = (await this.store.heldIds()).filter((id) => !seen.has(id));
      await this.store.remove(stale);
      await this.store.complete({ placeMatchingVersion });
      this.events.onComplete?.();
    });
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
    this.events.onError(error);
  }

  /** Resolves once every write received so far is committed. */
  settled() {
    return this.writes;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const page of this.pages) page.unsubscribe();
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
