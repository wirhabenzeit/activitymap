import assert from 'node:assert/strict';

import { getFunctionName } from 'convex/server';
import test from 'node:test';

import {
  type ChangesResult,
  type LiveClient,
  type LiveCursor,
  LiveLibrary,
  type LiveLibraryStore,
} from './convex-live';

type ListPage = { page: unknown[]; isDone: boolean; continueCursor: string };
type Subscription = {
  after: number;
  callback: (result: ChangesResult) => void;
  onError: (error: Error) => void;
  active: boolean;
};

const card = (id: string, name = `Ride ${id}`) =>
  ({ id, name, map_summary_polyline: `summary-${id}` }) as never;

const position = (sequence: number, version = 'v1') => ({
  sequence,
  version,
  matchingVersion: `match-${version}`,
});
const reload = (sequence: number, version = 'v1'): ChangesResult => ({
  reload: true,
  ...position(sequence, version),
});
const changed = (
  sequence: number,
  upserts: string[] = [],
  deletes: string[] = [],
  more = false,
): ChangesResult => ({
  reload: false,
  ...position(sequence),
  more,
  upserts: upserts.map((id) => card(id, `Renamed ${id}`)),
  deletes,
});

/** `changes` answers one-shot reads; `pages` maps a list cursor to its page. */
function fakeClient(
  changes: (after: number | null) => ChangesResult,
  pages: Record<string, ListPage> = {},
  photoPages: Record<string, { items: unknown[]; next: string | null }> = {},
) {
  const subscriptions: Subscription[] = [];
  const reads: string[] = [];
  let closed = false;
  const client: LiveClient = {
    onUpdate: (_query, { after }, callback, onError) => {
      const subscription = { after, callback, onError, active: true };
      subscriptions.push(subscription);
      return () => {
        subscription.active = false;
      };
    },
    query: (async (query: never, args: Record<string, unknown>) => {
      const name = getFunctionName(query);
      if (name === 'library:changes') {
        const after = args.after as number | null;
        reads.push(`changes ${after}`);
        return changes(after);
      }
      if (name === 'library:list') {
        const cursor = (args.paginationOpts as { cursor: string | null })
          .cursor;
        reads.push(`list ${cursor}`);
        return pages[cursor ?? 'start'];
      }
      if (name === 'library:photos') {
        const after = args.after as string | null;
        reads.push(`photos ${after}`);
        return photoPages[after ?? 'start'];
      }
      throw new Error(`unexpected ${name}`);
    }) as LiveClient['query'],
    close: () => {
      closed = true;
    },
  };
  const active = () => subscriptions.filter((item) => item.active);
  const following = () => {
    const [only, ...rest] = active();
    assert(only && rest.length === 0, 'exactly one active subscription');
    return only;
  };
  return { client, reads, active, following, closed: () => closed };
}

function fakeStore(cursor: LiveCursor | null, held: string[] = []) {
  const log: string[] = [];
  const store: LiveLibraryStore = {
    cursor: async () => cursor,
    apply: async ({ upserts, deletes, cursor: next }) => {
      log.push(
        [
          ...upserts.map((item) => `+${item.id}:${item.map_polyline}`),
          ...deletes.map((id) => `-${id}`),
          next ? `@${next.sequence}/${next.version}` : '@reloading',
        ].join(' '),
      );
    },
    heldIds: async () => held,
  };
  return { store, log };
}

function events() {
  const seen: string[] = [];
  return {
    seen,
    events: {
      onReady: () => seen.push('ready'),
      onComplete: () => seen.push('complete'),
      onChange: () => seen.push('change'),
      onPhotoChange: () => seen.push('photos'),
      onError: (error: Error) => seen.push(`error ${error.message}`),
    },
  };
}

void test('a stored position resumes with only the changes since, then follows new ones', async () => {
  const { client, reads, following, active, closed } = fakeClient((after) =>
    after === 5 ? changed(7, ['a'], ['b']) : reload(7),
  );
  const { store, log } = fakeStore({ sequence: 5, version: 'v1' });
  const { seen, events: handlers } = events();
  const library = new LiveLibrary(client, store, handlers, 2);
  await library.settled();

  // Nothing is read through `list`: the cached library stays.
  assert.deepEqual(reads, ['changes 5']);
  assert.deepEqual(log, ['+a:null -b @7/v1']);
  assert.deepEqual(seen, ['ready', 'change', 'complete']);
  assert.equal(following().after, 7);

  // A re-run with nothing new keeps the subscription and writes nothing.
  following().callback(changed(7));
  await library.settled();
  assert.equal(following().after, 7);
  assert.equal(log.length, 1);

  // A pushed change is written and the subscription moves past it.
  following().callback(changed(8, ['d']));
  await library.settled();
  assert.deepEqual(log.at(-1), '+d:null @8/v1');
  assert.equal(following().after, 8);

  // A batch with more behind it continues at once.
  following().callback(changed(9, ['e'], [], true));
  await library.settled();
  assert.equal(following().after, 9);

  library.dispose();
  assert.equal(active().length, 0);
  assert.equal(closed(), true);
  // Each committed batch with added or changed activities reports a change.
  assert.deepEqual(seen, ['ready', 'change', 'complete', 'change', 'change']);
});

void test('without a usable position the library is read once and followed from the head read first', async () => {
  const pages = {
    start: {
      page: [card('a'), card('b')],
      isDone: false,
      continueCursor: 'k2',
    },
    k2: { page: [card('c')], isDone: true, continueCursor: 'end' },
  };
  let head = reload(5);
  const { client, reads, following } = fakeClient(
    (after) => (after === null ? head : changed(5)),
    pages,
  );
  // Stored under a library version Convex no longer serves.
  const { store, log } = fakeStore({ sequence: 3, version: 'v0' }, [
    'a',
    'gone',
  ]);
  const { seen, events: handlers } = events();
  const library = new LiveLibrary(client, store, handlers, 2);
  await library.settled();

  assert.deepEqual(reads, [
    'changes 3',
    'changes null',
    'list null',
    'list k2',
  ]);
  assert.deepEqual(log, [
    '+a:null +b:null @reloading',
    '+c:null @reloading',
    // Left over from an earlier load and unknown to Convex.
    '-gone @5/v1',
  ]);
  assert.equal(following().after, 5);
  assert.deepEqual(seen, ['ready']);

  following().callback(changed(5));
  await library.settled();
  assert.deepEqual(seen, ['ready', 'complete']);

  // The feed asks for a reload (compacted, or a new library version).
  reads.length = 0;
  log.length = 0;
  head = reload(9, 'v2');
  following().callback(head);
  await library.settled();
  assert.deepEqual(reads, ['changes null', 'list null', 'list k2']);
  assert.equal(log.at(-1), '-gone @9/v2');
  assert.equal(following().after, 9);
});

void test('a failed subscription reports once so the caller can fall back', async () => {
  const { client, following } = fakeClient(() => changed(1));
  const { store } = fakeStore({ sequence: 1, version: 'v1' });
  const { seen, events: handlers } = events();
  const library = new LiveLibrary(client, store, handlers);
  await library.settled();
  const subscription = following();
  subscription.onError(new Error('not_authorized'));
  subscription.onError(new Error('again'));
  await library.settled();
  assert.deepEqual(seen, ['ready', 'complete', 'error not_authorized']);
});

void test('photo changes are announced and the photo list is read in pages', async () => {
  const photoOnly = { ...changed(9), photos: true } as ChangesResult;
  const { client, reads, following } = fakeClient(
    () => changed(7),
    {},
    {
      start: { items: [{ unique_id: 'a' }, { unique_id: 'b' }], next: 'b' },
      b: { items: [{ unique_id: 'c' }], next: null },
    },
  );
  const { store, log } = fakeStore({ sequence: 7, version: 'v1' });
  const { seen, events: handlers } = events();
  const library = new LiveLibrary(client, store, handlers, 2);
  await library.settled();
  assert.deepEqual(seen, ['ready', 'complete']);

  // A read with photo changes only moves the position and reports them.
  following().callback(photoOnly);
  await library.settled();
  assert.deepEqual(log, ['@9/v1']);
  assert.deepEqual(seen, ['ready', 'complete', 'photos']);
  assert.equal(following().after, 9);

  assert.deepEqual(
    (await library.photos()).map((item) => item.unique_id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(reads.slice(-2), ['photos null', 'photos b']);
});

void test('a reload after the first catch-up asks for the photo list again', async () => {
  const pages = {
    start: { page: [card('a')], isDone: true, continueCursor: '' },
  };
  // First load: the completion covers photos, so no separate report.
  const fresh = fakeClient(() => reload(4), pages);
  const first = events();
  const loading = new LiveLibrary(
    fresh.client,
    fakeStore(null).store,
    first.events,
    2,
  );
  await loading.settled();
  fresh.following().callback(changed(4));
  assert.deepEqual(first.seen, ['ready', 'complete']);

  // A session that was current, then fell behind the retained history.
  const { client, reads, following } = fakeClient(
    (after) => (after === 7 ? changed(7) : reload(40)),
    pages,
  );
  const { store, log } = fakeStore({ sequence: 7, version: 'v1' });
  const { seen, events: handlers } = events();
  const library = new LiveLibrary(client, store, handlers, 2);
  await library.settled();
  assert.deepEqual(seen, ['ready', 'complete']);

  following().callback(reload(40));
  await library.settled();
  assert.deepEqual(reads.slice(1), ['changes null', 'list null']);
  assert.equal(log.at(-1), '@40/v1');
  assert.deepEqual(seen, ['ready', 'complete', 'photos']);
  assert.equal(following().after, 40);
});
