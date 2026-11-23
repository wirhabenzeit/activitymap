import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, mock } from 'node:test';

import {
  EMPTY_SET_DIGEST,
  type PlaceRow,
  addToSetDigest,
  rowHash,
  tileOf,
} from '../../src/server/places/catalogue-rows';
import { internal } from '../convex/_generated/api';
import schema from '../convex/schema';

/**
 * The live place catalogue (convex/livePlaces.ts): applying a publication
 * in batches, resuming and abandoning it, the tiles it records, its signed
 * bridge operations and the restart of unfinished re-match walks.
 */

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => mock.timers.reset());

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './bridge.ts': () => import('../convex/bridge'),
  './catalogue.ts': () => import('../convex/catalogue'),
  './http.ts': () => import('../convex/http'),
  './livePlaces.ts': () => import('../convex/livePlaces'),
  './maintenance.ts': () => import('../convex/maintenance'),
};
type Convex = ReturnType<typeof setup>;

function setup() {
  return convexTest(schema, modules);
}

function place(id: string, longitude: number, latitude: number, name = id) {
  return {
    id,
    displayName: name,
    kinds: ['peak'],
    subtypes: [],
    location: { longitude, latitude },
  } satisfies PlaceRow;
}

async function digestOf(rows: PlaceRow[]) {
  let digest = EMPTY_SET_DIGEST;
  for (const row of rows) digest = addToSetDigest(digest, await rowHash(row));
  return digest;
}

function metadata(convex: Convex) {
  return convex.run((ctx) => ctx.storage.store(new Blob(['{}'])));
}

async function begin(
  convex: Convex,
  snapshotId: string,
  rows: PlaceRow[],
  expectCurrent: string | null,
  extra: { replacePending?: string } = {},
) {
  return convex.mutation(internal.livePlaces.beginApply, {
    expectCurrent,
    snapshotId,
    metadata: await metadata(convex),
    count: rows.length,
    setDigest: await digestOf(rows),
    ...extra,
  });
}

function batch(
  convex: Convex,
  snapshotId: string,
  {
    upserts = [],
    deletes = [],
    tiles = [],
  }: Partial<{
    upserts: PlaceRow[];
    deletes: string[];
    tiles: string[];
  }>,
) {
  return convex.mutation(internal.livePlaces.applyBatch, {
    snapshotId,
    upserts,
    deletes,
    tiles,
  });
}

/** Apply `rows` as a whole publication over an empty or matching table. */
async function publish(
  convex: Convex,
  snapshotId: string,
  rows: PlaceRow[],
  expectCurrent: string | null,
) {
  assert.equal((await begin(convex, snapshotId, rows, expectCurrent)).ok, true);
  await batch(convex, snapshotId, { upserts: rows });
  assert.equal(
    (await convex.mutation(internal.livePlaces.completeApply, { snapshotId }))
      .ok,
    true,
  );
}

function tileChanges(convex: Convex, revision: number) {
  return convex.run(async (ctx) =>
    (
      await ctx.db
        .query('placeTileChanges')
        .withIndex('by_revision_tile', (q) => q.eq('revision', revision))
        .collect()
    ).map((row) => row.tile),
  );
}

function walks(convex: Convex) {
  return convex.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.name === 'catalogue:rematchTiles')
      .map((job) => job.args[0]),
  );
}

const a = place('a', 10.1, 47.1);
const b = place('b', 11.1, 48.1);
const c = place('c', 12.1, 49.1);

void test('a first apply inserts every row, completes and starts the walk once', async () => {
  const convex = setup();
  assert.equal(await convex.query(internal.livePlaces.state, {}), null);
  assert.deepEqual(await begin(convex, 'snap-1', [a, b, c], null), {
    ok: true,
    revision: 1,
    resumed: false,
  });
  assert.deepEqual(await batch(convex, 'snap-1', { upserts: [a, b, c] }), {
    ok: true,
    count: 3,
    setDigest: await digestOf([a, b, c]),
  });
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      await convex.mutation(internal.livePlaces.completeApply, {
        snapshotId: 'snap-1',
      }),
      { ok: true, revision: 1 },
    );
  assert.deepEqual(await walks(convex), [{ revision: 1 }]);

  const state = await convex.query(internal.livePlaces.state, {});
  assert.equal(typeof state?.metadataUrl, 'string');
  assert.deepEqual(
    { ...state, metadataUrl: undefined },
    {
      revision: 1,
      snapshotId: 'snap-1',
      count: 3,
      setDigest: await digestOf([a, b, c]),
      metadataUrl: undefined,
      pending: null,
    },
  );
  assert.deepEqual(
    (await tileChanges(convex, 1)).sort(),
    [a, b, c].map((row) => tileOf(row.location)).sort(),
  );
  const rows = await convex.run((ctx) => ctx.db.query('livePlaces').collect());
  assert.deepEqual(
    rows.map((row) => [row.key, row.revision]),
    [
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ],
  );
  // Nothing pending under that snapshot any more.
  assert.deepEqual(await batch(convex, 'snap-1', { upserts: [a] }), {
    ok: false,
    reason: 'not_pending',
  });
});

void test('an interrupted apply resumes, and a repeated batch changes nothing', async () => {
  const convex = setup();
  const first = await begin(convex, 'snap-1', [a, b, c], null);
  assert.deepEqual(first, { ok: true, revision: 1, resumed: false });
  const applied = await batch(convex, 'snap-1', { upserts: [a, b] });
  const tiles = await tileChanges(convex, 1);
  const rows = await convex.run((ctx) => ctx.db.query('livePlaces').collect());

  // The run stops here; the next one begins again with a new metadata copy.
  const copy = await metadata(convex);
  assert.deepEqual(
    await convex.mutation(internal.livePlaces.beginApply, {
      expectCurrent: null,
      snapshotId: 'snap-1',
      metadata: copy,
      count: 3,
      setDigest: await digestOf([a, b, c]),
    }),
    { ok: true, revision: 1, resumed: true },
  );
  assert.equal(await convex.run((ctx) => ctx.storage.get(copy)), null);
  await assert.rejects(begin(convex, 'snap-1', [a, b], null));

  assert.deepEqual(await batch(convex, 'snap-1', { upserts: [a, b] }), applied);
  assert.deepEqual(await tileChanges(convex, 1), tiles);
  assert.deepEqual(
    await convex.run((ctx) => ctx.db.query('livePlaces').collect()),
    rows,
  );

  assert.deepEqual(
    await convex.mutation(internal.livePlaces.completeApply, {
      snapshotId: 'snap-1',
    }),
    {
      ok: false,
      reason: 'mismatch',
      count: 2,
      setDigest: await digestOf([a, b]),
    },
  );
  await batch(convex, 'snap-1', { upserts: [c] });
  assert.deepEqual(
    await convex.mutation(internal.livePlaces.completeApply, {
      snapshotId: 'snap-1',
    }),
    { ok: true, revision: 1 },
  );
});

void test('completion refuses a wrong count or digest', async () => {
  const convex = setup();
  // Announces a row it never sends, and the right count with other rows.
  await begin(convex, 'snap-1', [a, b], null);
  await batch(convex, 'snap-1', { upserts: [a] });
  const complete = () =>
    convex.mutation(internal.livePlaces.completeApply, {
      snapshotId: 'snap-1',
    });
  assert.equal((await complete()).ok, false);
  await batch(convex, 'snap-1', { upserts: [c] });
  assert.deepEqual(await complete(), {
    ok: false,
    reason: 'mismatch',
    count: 2,
    setDigest: await digestOf([a, c]),
  });
  assert.deepEqual(
    await convex.mutation(internal.livePlaces.completeApply, {
      snapshotId: 'snap-2',
    }),
    {
      ok: false,
      reason: 'not_pending',
      count: 2,
      setDigest: await digestOf([a, c]),
    },
  );
  assert.deepEqual(await walks(convex), []);
});

void test('expectCurrent races and other artifacts refuse; replacePending abandons one', async () => {
  const convex = setup();
  await publish(convex, 'snap-1', [a, b, c], null);
  const firstMetadata = (await convex.run((ctx) =>
    ctx.db.query('placeCatalogueState').unique(),
  ))!.metadata!;

  assert.deepEqual(await begin(convex, 'snap-2', [a, b], null), {
    ok: false,
    reason: 'current_changed',
    current: 'snap-1',
    pending: null,
  });
  assert.deepEqual(await begin(convex, 'snap-1', [a, b, c], 'snap-1'), {
    ok: false,
    reason: 'already_current',
    current: 'snap-1',
    pending: null,
  });
  assert.deepEqual(
    await begin(convex, 'snap-2', [a, b], 'snap-1', {
      replacePending: 'snap-0',
    }),
    { ok: false, reason: 'pending_other', current: 'snap-1', pending: null },
  );

  // A bad artifact fails halfway: c is deleted, nothing else yet.
  assert.deepEqual(await begin(convex, 'snap-2', [a], 'snap-1'), {
    ok: true,
    revision: 2,
    resumed: false,
  });
  await batch(convex, 'snap-2', { deletes: ['c'] });
  const pendingMetadata = (await convex.run((ctx) =>
    ctx.db.query('placeCatalogueState').unique(),
  ))!.pending!.metadata;

  assert.deepEqual(await begin(convex, 'snap-3', [a, b], 'snap-1'), {
    ok: false,
    reason: 'pending_other',
    current: 'snap-1',
    pending: 'snap-2',
  });
  assert.deepEqual(
    await begin(convex, 'snap-3', [a, b], 'snap-1', {
      replacePending: 'snap-9',
    }),
    {
      ok: false,
      reason: 'pending_other',
      current: 'snap-1',
      pending: 'snap-2',
    },
  );

  // Publishing the previous artifact again reverts the half-applied change.
  assert.deepEqual(
    await begin(convex, 'snap-1', [a, b, c], 'snap-1', {
      replacePending: 'snap-2',
    }),
    { ok: true, revision: 2, resumed: false },
  );
  assert.equal(
    await convex.run((ctx) => ctx.storage.get(pendingMetadata)),
    null,
  );
  assert.deepEqual(await batch(convex, 'snap-2', { upserts: [c] }), {
    ok: false,
    reason: 'not_pending',
  });
  assert.deepEqual(await tileChanges(convex, 2), [tileOf(c.location)]);
  await batch(convex, 'snap-1', { upserts: [a, b, c] });
  assert.deepEqual(
    await convex.mutation(internal.livePlaces.completeApply, {
      snapshotId: 'snap-1',
    }),
    { ok: true, revision: 2 },
  );
  assert.deepEqual(await tileChanges(convex, 2), [tileOf(c.location)]);
  assert.deepEqual(await walks(convex), [{ revision: 1 }, { revision: 2 }]);
  // The replaced publication's metadata is gone, the new one is served.
  assert.equal(await convex.run((ctx) => ctx.storage.get(firstMetadata)), null);
  const state = await convex.query(internal.livePlaces.state, {});
  assert.deepEqual(
    [state?.revision, state?.snapshotId, state?.count],
    [2, 'snap-1', 3],
  );
});

void test('tile changes record inserts, updates, moves and deletes, not no-ops', async () => {
  const convex = setup();
  const gone = place('f', 15.1, 52.1);
  await publish(convex, 'snap-1', [a, b, c, gone], null);
  await convex.run(async (ctx) => {
    for (const row of await ctx.db.query('placeTileChanges').collect())
      await ctx.db.delete('placeTileChanges', row._id);
  });

  const renamed = place('b', 11.1, 48.1, 'B renamed');
  const moved = place('c', 13.1, 50.1);
  const added = place('e', 14.1, 51.1);
  const final = [a, renamed, moved, added];
  await begin(convex, 'snap-2', final, 'snap-1');
  assert.deepEqual(
    await batch(convex, 'snap-2', {
      upserts: [a, renamed, moved, added],
      deletes: ['f', 'absent'],
      tiles: ['9,9', tileOf(moved.location)],
    }),
    { ok: true, count: 4, setDigest: await digestOf(final) },
  );
  // Already recorded tiles are not recorded twice.
  await batch(convex, 'snap-2', { tiles: ['9,9', tileOf(b.location)] });
  const expected = [
    tileOf(b.location),
    tileOf(c.location),
    tileOf(moved.location),
    tileOf(added.location),
    tileOf(gone.location),
    '9,9',
  ].sort();
  assert.deepEqual((await tileChanges(convex, 2)).sort(), expected);
  assert(!expected.includes(tileOf(a.location)));

  const rows = await convex.run((ctx) => ctx.db.query('livePlaces').collect());
  assert.deepEqual(
    rows.map((row) => [row.key, row.tile, row.revision, row.place.displayName]),
    [
      ['a', tileOf(a.location), 1, 'a'],
      ['b', tileOf(b.location), 2, 'B renamed'],
      ['c', tileOf(moved.location), 2, 'c'],
      ['e', tileOf(added.location), 2, 'e'],
    ],
  );

  // A batch of only no-ops writes nothing.
  assert.deepEqual(
    await batch(convex, 'snap-2', { upserts: [a], deletes: ['f'] }),
    { ok: true, count: 4, setDigest: await digestOf(final) },
  );
  assert.equal((await tileChanges(convex, 2)).length, expected.length);

  await assert.rejects(batch(convex, 'snap-2', {}));
  await assert.rejects(
    batch(convex, 'snap-2', { upserts: [a], deletes: ['a'] }),
  );
  await assert.rejects(batch(convex, 'snap-2', { tiles: ['north'] }));
  await assert.rejects(
    batch(convex, 'snap-2', { upserts: [place('x', 200, 0)] }),
  );
  await assert.rejects(
    batch(convex, 'snap-2', {
      deletes: Array.from({ length: 501 }, (_, i) => `k${i}`),
    }),
  );
});

void test('catalogue reads pass the bridge without a nonce; writes still need one', async (t) => {
  const convex = setup();
  const secret = 'e'.repeat(64);
  const previous = process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS;
  process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS = JSON.stringify({ app: secret });
  t.after(() => {
    if (previous === undefined)
      delete process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS;
    else process.env.ACTIVITYMAP_BRIDGE_WRITER_KEYS = previous;
  });
  const send = (body: string) => {
    const timestamp = String(Date.now());
    return convex.fetch('/internal/write/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ActivityMap-Key-Id': 'app',
        'X-ActivityMap-Timestamp': timestamp,
        'X-ActivityMap-Signature': createHmac(
          'sha256',
          Buffer.from(secret, 'hex'),
        )
          .update(`activitymap-write-v1\napp\n${timestamp}\n${body}`)
          .digest('hex'),
      },
      body,
    });
  };
  const request = (operation: object, nonce?: string) =>
    JSON.stringify({ nonce, operation });

  const empty = await send(request({ kind: 'liveState' }));
  assert.equal(empty.status, 200);
  assert.equal(await empty.json(), null);

  await publish(convex, 'snap-1', [a, b, c], null);
  const state = await send(request({ kind: 'liveState' }));
  assert.equal(state.status, 200);
  assert.equal(((await state.json()) as { revision: number }).revision, 1);

  const page = request({ kind: 'liveHashes', cursor: null, limit: 2 });
  type Page = {
    page: { key: string; hash: string; tile: string }[];
    isDone: boolean;
    continueCursor: string;
  };
  const first = (await (await send(page)).json()) as Page;
  // The same signed read again is answered too.
  assert.deepEqual((await (await send(page)).json()) as Page, first);
  assert.deepEqual(first.page, [
    { key: 'a', hash: await rowHash(a), tile: tileOf(a.location) },
    { key: 'b', hash: await rowHash(b), tile: tileOf(b.location) },
  ]);
  assert.equal(first.isDone, false);
  const rest = (await (
    await send(request({ kind: 'liveHashes', cursor: first.continueCursor }))
  ).json()) as Page;
  assert.deepEqual(
    rest.page.map((row) => row.key),
    ['c'],
  );
  assert.equal(rest.isDone, true);
  assert.equal(
    (await send(request({ kind: 'liveHashes', cursor: null, limit: 4097 })))
      .status,
    400,
  );
  assert.deepEqual(
    await convex.run((ctx) => ctx.db.query('bridgeNonces').collect()),
    [],
  );

  const complete = { kind: 'completeApply', snapshotId: 'snap-1' };
  assert.equal((await send(request(complete))).status, 400);
  const signed = request(complete, 'nonce-for-complete-1');
  const accepted = await send(signed);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true, revision: 1 });
  assert.equal((await send(signed)).status, 409);
  const unsigned = await convex.fetch('/internal/write/v1', {
    method: 'POST',
    body: request({ kind: 'liveState' }),
  });
  assert.equal(unsigned.status, 401);
});

void test('the daily job restarts the re-match walk of completed revisions with tiles left', async () => {
  const convex = setup();
  const resume = () =>
    convex.mutation(internal.maintenance.resumeRematchWalks, {});
  const walk = (revision: number) =>
    convex.mutation(internal.catalogue.rematchTiles, { revision });
  await convex.run(async (ctx) => {
    for (let i = 0; i < 70; i++)
      await ctx.db.insert('placeTileChanges', { revision: 1, tile: `${i},0` });
    await ctx.db.insert('placeTileChanges', { revision: 2, tile: '0,0' });
    await ctx.db.insert('placeTileChanges', { revision: 3, tile: '0,0' });
  });
  // Nothing completed yet: nothing to walk.
  assert.deepEqual(await resume(), []);
  await convex.run((ctx) =>
    ctx.db.insert('placeCatalogueState', {
      revision: 2,
      count: 0,
      setDigest: EMPTY_SET_DIGEST,
    }),
  );
  // Revision 3 is pending: its tiles wait for its completion.
  assert.deepEqual(await resume(), [1, 2]);
  assert.deepEqual(await walks(convex), [{ revision: 1 }, { revision: 2 }]);
  assert.deepEqual(await walk(3), { done: true });
  assert.deepEqual(await tileChanges(convex, 3), ['0,0']);

  // A walk deletes each tile it has finished, a page of tiles a step, so
  // what is left is the work left; walking again is harmless.
  assert.deepEqual(await walk(1), { done: false });
  assert.equal((await tileChanges(convex, 1)).length, 6);
  assert.deepEqual(await walk(1), { done: true });
  assert.deepEqual(await walk(1), { done: true });
  assert.deepEqual(await tileChanges(convex, 1), []);
  assert.deepEqual(await resume(), [2]);
});
