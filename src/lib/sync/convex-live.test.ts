import assert from 'node:assert/strict';

import test from 'node:test';

import {
  type LiveClient,
  LiveLibrary,
  type LiveLibraryStore,
} from './convex-live';

type Args = {
  paginationOpts: {
    numItems: number;
    cursor: string | null;
    endCursor?: string | null;
  };
};
type Subscription = {
  args: Args;
  callback: (page: unknown) => void;
  onError: (error: Error) => void;
  active: boolean;
};

function fakeClient() {
  const subscriptions: Subscription[] = [];
  let closed = false;
  const client: LiveClient = {
    onUpdate: (_query, args, callback, onError) => {
      const subscription = {
        args,
        callback: callback as (page: unknown) => void,
        onError,
        active: true,
      };
      subscriptions.push(subscription);
      return () => {
        subscription.active = false;
      };
    },
    query: async () => null,
    close: () => {
      closed = true;
    },
  };
  const active = () => subscriptions.filter((item) => item.active);
  const find = (cursor: string | null, end?: string) => {
    const match = active().find(
      (item) =>
        item.args.paginationOpts.cursor === cursor &&
        (item.args.paginationOpts.endCursor ?? undefined) === end,
    );
    assert(match, `no active subscription for ${cursor}..${end}`);
    return match;
  };
  return { client, active, find, closed: () => closed };
}

const card = (id: string, name = `Ride ${id}`, matchingVersion?: string) =>
  ({
    id,
    name,
    map_summary_polyline: `summary-${id}`,
    ...(matchingVersion && { placeMatches: { matchingVersion } }),
  }) as never;
const page = (cards: unknown[], isDone: boolean, continueCursor = 'end') => ({
  page: cards,
  isDone,
  continueCursor,
});

function fakeStore(held: string[] = []) {
  const log: string[] = [];
  let completed: { placeMatchingVersion?: string } | null = null;
  const store: LiveLibraryStore = {
    upsert: async (items) => {
      if (items.length)
        log.push(
          `upsert ${items.map((item) => `${item.id}:${item.name}:${item.map_polyline}`).join(',')}`,
        );
    },
    remove: async (ids) => {
      if (ids.length) log.push(`remove ${ids.join(',')}`);
    },
    heldIds: async () => held,
    complete: async (state) => {
      completed = state;
    },
  };
  return { store, log, completed: () => completed };
}

void test('pages load in order, pin their ranges, and write only what changed', async () => {
  const { client, active, find, closed } = fakeClient();
  const { store, log, completed } = fakeStore(['a', 'b', 'c', 'gone']);
  const events: string[] = [];
  const library = new LiveLibrary(
    client,
    store,
    {
      onFirstPage: () => events.push('first'),
      onComplete: () => events.push('complete'),
      onError: (error) => events.push(`error ${error.message}`),
    },
    2,
  );

  find(null).callback(page([card('a'), card('b')], false, 'k2'));
  // The first page is now pinned to [start, k2) and the next page subscribed.
  assert.deepEqual(
    active().map((item) => item.args.paginationOpts),
    [
      { numItems: 2, cursor: null, endCursor: 'k2' },
      { numItems: 2, cursor: 'k2' },
    ],
  );
  find('k2').callback(page([card('c', 'Ride c', 'v1')], true));
  await library.settled();
  assert.deepEqual(log, [
    'upsert a:Ride a:null,b:Ride b:null',
    'upsert c:Ride c:null',
    // Left over from an earlier REST sync and unknown to Convex.
    'remove gone',
  ]);
  assert.deepEqual(events, ['first', 'complete']);
  assert.deepEqual(completed(), { placeMatchingVersion: 'v1' });

  log.length = 0;
  // A rename on page one writes only that row (a pending local edit of `b`
  // stays untouched because its Convex version did not change).
  find(null, 'k2').callback(
    page([card('a', 'Renamed'), card('b')], false, 'k2'),
  );
  // A deletion on page one, and a new activity on the open last page.
  find(null, 'k2').callback(page([card('a', 'Renamed')], false, 'k2'));
  find('k2').callback(page([card('c', 'Ride c', 'v1'), card('d')], true));
  await library.settled();
  assert.deepEqual(log, [
    'upsert a:Renamed:null',
    'remove b',
    'upsert d:Ride d:null',
  ]);
  assert.equal(active().length, 2, 'pinned pages are not re-subscribed again');

  library.dispose();
  assert.equal(active().length, 0);
  assert.equal(closed(), true);
});

void test('a failed subscription reports once so the caller can fall back', async () => {
  const { client, find } = fakeClient();
  const { store } = fakeStore();
  const errors: string[] = [];
  const library = new LiveLibrary(client, store, {
    onError: (error) => errors.push(error.message),
  });
  find(null).onError(new Error('not_authorized'));
  find(null).onError(new Error('again'));
  await library.settled();
  assert.deepEqual(errors, ['not_authorized']);
});
