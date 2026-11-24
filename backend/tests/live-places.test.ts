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
 * bridge operations, the demand tiles and the restart of unfinished
 * re-match walks.
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
  // A refused sender's metadata copy is deleted.
  assert.deepEqual(
    (await convex.run((ctx) => ctx.db.system.query('_storage').collect())).map(
      (file) => file._id,
    ),
    [firstMetadata],
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

/** Set bridge key maps for one test. */
function keys(t: test.TestContext, env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

/** POST `body` to `path`, signed under `domain` with key `id`. */
function signed(
  convex: Convex,
  path: string,
  { domain, id, secret }: { domain: string; id: string; secret: string },
  body: string,
) {
  const timestamp = String(Date.now());
  return convex.fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ActivityMap-Key-Id': id,
      'X-ActivityMap-Timestamp': timestamp,
      'X-ActivityMap-Signature': createHmac(
        'sha256',
        Buffer.from(secret, 'hex'),
      )
        .update(`${domain}\n${id}\n${timestamp}\n${body}`)
        .digest('hex'),
    },
    body,
  });
}

const readerKey = { id: 'reader', secret: 'd'.repeat(64) };
const writerKey = { id: 'app', secret: 'e'.repeat(64) };

void test('catalogue reads pass their own route with the read key and no nonce', async (t) => {
  const convex = setup();
  keys(t, {
    ACTIVITYMAP_BRIDGE_SIGNING_KEYS: JSON.stringify({
      [readerKey.id]: readerKey.secret,
    }),
    ACTIVITYMAP_BRIDGE_WRITER_KEYS: JSON.stringify({
      [writerKey.id]: writerKey.secret,
    }),
  });
  const read = (operation: object, key = readerKey, domain = 'places') =>
    signed(
      convex,
      '/internal/places/v1',
      { domain: `activitymap-${domain}-v1`, ...key },
      JSON.stringify({ operation }),
    );

  const empty = await read({ kind: 'liveState' });
  assert.equal(empty.status, 200);
  assert.equal(await empty.json(), null);

  await publish(convex, 'snap-1', [a, b, c], null);
  const state = await read({ kind: 'liveState' });
  assert.equal(((await state.json()) as { revision: number }).revision, 1);

  type Page<Row> = { page: Row[]; isDone: boolean; continueCursor: string };
  const page = { kind: 'liveHashes', cursor: null, limit: 2 };
  const first = (await (await read(page)).json()) as Page<{ key: string }>;
  // The same signed read again is answered too.
  assert.deepEqual(await (await read(page)).json(), first);
  assert.deepEqual(first.page, [
    { key: 'a', hash: await rowHash(a), tile: tileOf(a.location) },
    { key: 'b', hash: await rowHash(b), tile: tileOf(b.location) },
  ]);
  const rest = (await (
    await read({ kind: 'liveHashes', cursor: first.continueCursor })
  ).json()) as Page<{ key: string }>;
  assert.deepEqual(
    [rest.page.map((row) => row.key), rest.isDone],
    [['c'], true],
  );
  assert.equal(
    (await read({ kind: 'liveHashes', cursor: null, limit: 4097 })).status,
    400,
  );
  const demand = await read({ kind: 'demandTiles', cursor: null });
  assert.equal(demand.status, 200);
  const tiles = (await demand.json()) as Page<unknown>;
  assert.deepEqual([tiles.page, tiles.isDone], [[], true]);
  assert.deepEqual(
    await convex.run((ctx) => ctx.db.query('bridgeNonces').collect()),
    [],
  );

  // Only reads, and only signed for this route by a read key.
  assert.equal((await read({ kind: 'completeApply' })).status, 400);
  assert.equal((await read({ kind: 'beginApply' })).status, 400);
  assert.equal(
    (await read({ kind: 'liveState' }, readerKey, 'sync')).status,
    401,
  );
  assert.equal(
    (await read({ kind: 'liveState' }, readerKey, 'write')).status,
    401,
  );
  assert.equal((await read({ kind: 'liveState' }, writerKey)).status, 401);
  assert.equal(
    (
      await convex.fetch('/internal/places/v1', {
        method: 'POST',
        body: JSON.stringify({ operation: { kind: 'liveState' } }),
      })
    ).status,
    401,
  );
  // A places signature is no library read either.
  assert.equal(
    (
      await signed(
        convex,
        '/internal/sync/v1',
        { domain: 'activitymap-places-v1', ...readerKey },
        JSON.stringify({ operation: { kind: 'head' } }),
      )
    ).status,
    401,
  );
});

void test('the write route no longer reads the live catalogue, and every write needs a nonce', async (t) => {
  const convex = setup();
  keys(t, {
    ACTIVITYMAP_BRIDGE_WRITER_KEYS: JSON.stringify({
      [writerKey.id]: writerKey.secret,
    }),
  });
  await publish(convex, 'snap-1', [a, b, c], null);
  const write = (operation: object, nonce?: string) =>
    signed(
      convex,
      '/internal/write/v1',
      { domain: 'activitymap-write-v1', ...writerKey },
      JSON.stringify({ nonce, operation }),
    );
  for (const kind of ['liveState', 'liveHashes', 'demandTiles']) {
    assert.equal((await write({ kind, cursor: null })).status, 400);
    assert.equal(
      (await write({ kind, cursor: null }, `nonce-for-${kind}-01`)).status,
      400,
    );
  }

  const complete = { kind: 'completeApply', snapshotId: 'snap-1' };
  assert.equal((await write(complete)).status, 400);
  const accepted = await write(complete, 'nonce-for-complete-1');
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true, revision: 1 });
  assert.equal((await write(complete, 'nonce-for-complete-1')).status, 409);
});

void test('demand tiles count the activities of each tile, a page at a time, naming none', async () => {
  const convex = setup();
  const tiles = await convex.run(async (ctx) => {
    const owners = [];
    for (const userId of ['user-1', 'user-2'])
      owners.push(
        await ctx.db.insert('owners', {
          userId,
          athleteId: userId.at(-1)!,
          backend: 'convex',
          epoch: `${userId}-epoch-0001`,
          generation: 'generation-01',
          revoked: false,
          catalogue: 'c'.repeat(64),
          matchingVersion: 'd'.repeat(64),
          projectionVersion: 1,
        }),
      );
    // Two owners' activities in 10,10; one activity across three tiles.
    const rows = [
      [owners[0]!, '1', '10,10'],
      [owners[0]!, '2', '10,10'],
      [owners[1]!, '1', '10,10'],
      [owners[1]!, '2', '10,11'],
      [owners[1]!, '2', '11,10'],
      [owners[1]!, '2', '12,10'],
    ] as const;
    for (const [owner, activity, tile] of rows)
      await ctx.db.insert('activityPlaceTiles', { owner, activity, tile });
    return rows.length;
  });

  const all = await convex.query(internal.livePlaces.demandTiles, {
    cursor: null,
  });
  assert.deepEqual(all.page, [
    { tile: '10,10', activities: 3 },
    { tile: '10,11', activities: 1 },
    { tile: '11,10', activities: 1 },
    { tile: '12,10', activities: 1 },
  ]);
  assert.equal(all.isDone, true);

  // Pages of two rows: 10,10 continues on the second page and is listed on
  // both; the sums agree.
  const pages = [];
  for (let cursor: string | null = null; ;) {
    const page: typeof all = await convex.query(
      internal.livePlaces.demandTiles,
      { cursor, limit: 2 },
    );
    pages.push(page.page);
    for (const entry of page.page)
      assert.deepEqual(Object.keys(entry).sort(), ['activities', 'tile']);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  assert.deepEqual(pages.slice(0, 3), [
    [{ tile: '10,10', activities: 2 }],
    [
      { tile: '10,10', activities: 1 },
      { tile: '10,11', activities: 1 },
    ],
    [
      { tile: '11,10', activities: 1 },
      { tile: '12,10', activities: 1 },
    ],
  ]);
  assert.equal(
    pages.flat().reduce((sum, entry) => sum + entry.activities, 0),
    tiles,
  );
  await assert.rejects(
    convex.query(internal.livePlaces.demandTiles, { cursor: null, limit: 0 }),
  );
  await assert.rejects(
    convex.query(internal.livePlaces.demandTiles, {
      cursor: null,
      limit: 8193,
    }),
  );
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
