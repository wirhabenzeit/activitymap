import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import test from 'node:test';

import {
  type CatalogueReader,
  convexCatalogueReader,
  readDemandTiles,
  readLiveHashes,
  readLiveMetadata,
} from './catalogue-reader';

const secret = '3'.repeat(64);

function withEnv(t: test.TestContext, env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
    t.after(() => {
      if (previous === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = previous;
    });
  }
}

const configured = {
  ACTIVITYMAP_CONVEX_SITE: 'https://convex.invalid',
  ACTIVITYMAP_CONVEX_KEY_ID: 'reader',
  ACTIVITYMAP_CONVEX_SIGNING_KEY: secret,
};

void test('reads are signed with the read key under the places domain', async (t) => {
  withEnv(t, configured);
  const requests: { url: string; init: RequestInit }[] = [];
  const reader = convexCatalogueReader(async (url, init) => {
    requests.push({ url: (url as URL).href, init: init! });
    return Response.json({ revision: 3 });
  })!;
  assert.deepEqual(await reader.read({ kind: 'liveState' }), { revision: 3 });

  const [{ url, init }] = requests as [(typeof requests)[number]];
  assert.equal(url, 'https://convex.invalid/internal/places/v1');
  assert.equal(init.method, 'POST');
  const body = init.body as string;
  assert.deepEqual(JSON.parse(body), { operation: { kind: 'liveState' } });
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['X-ActivityMap-Key-Id'], 'reader');
  const timestamp = headers['X-ActivityMap-Timestamp']!;
  assert.match(timestamp, /^\d{13}$/);
  assert.equal(
    headers['X-ActivityMap-Signature'],
    createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`activitymap-places-v1\nreader\n${timestamp}\n${body}`)
      .digest('hex'),
  );
});

void test('a missing site gives no reader, a bad key or a refusal throws', async (t) => {
  withEnv(t, { ...configured, ACTIVITYMAP_CONVEX_SITE: undefined });
  assert.equal(convexCatalogueReader(), null);
  process.env.ACTIVITYMAP_CONVEX_SITE = 'http://convex.invalid';
  assert.throws(() => convexCatalogueReader(), /configuration/);
  process.env.ACTIVITYMAP_CONVEX_SITE = configured.ACTIVITYMAP_CONVEX_SITE;
  process.env.ACTIVITYMAP_CONVEX_SIGNING_KEY = 'short';
  assert.throws(() => convexCatalogueReader(), /configuration/);
  process.env.ACTIVITYMAP_CONVEX_SIGNING_KEY = secret;
  const refused = convexCatalogueReader(
    async () => new Response(null, { status: 401 }),
  )!;
  await assert.rejects(
    refused.read({ kind: 'liveHashes', cursor: null }),
    /rejected liveHashes \(401\)/,
  );
});

/** A reader that serves `pages` of each kind in order. */
function pagedReader(pages: Record<string, unknown[][]>) {
  const cursors: (string | null)[] = [];
  const reader: CatalogueReader = {
    async read<T>(operation: { kind: string; [field: string]: unknown }) {
      const cursor = operation.cursor as string | null;
      cursors.push(cursor);
      const all = pages[operation.kind]!;
      const index = cursor === null ? 0 : Number(cursor);
      return {
        page: all[index],
        isDone: index === all.length - 1,
        continueCursor: String(index + 1),
      } as T;
    },
  };
  return { reader, cursors };
}

void test('row hashes are read a page at a time', async () => {
  const row = (key: string) => ({ key, hash: `${key}-hash`, tile: '1,1' });
  const { reader, cursors } = pagedReader({
    liveHashes: [[row('a'), row('b')], [row('c')]],
  });
  assert.deepEqual(
    (await readLiveHashes(reader)).map(({ key }) => key),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(cursors, [null, '1']);
});

void test('demand sums a tile that continues on the next page', async () => {
  const { reader } = pagedReader({
    demandTiles: [
      [
        { tile: '10,10', activities: 2 },
        { tile: '10,11', activities: 4 },
      ],
      [
        { tile: '10,11', activities: 3 },
        { tile: '12,10', activities: 1 },
      ],
      [],
    ],
  });
  assert.deepEqual(
    await readDemandTiles(reader),
    new Map([
      ['10,10', 2],
      ['10,11', 7],
      ['12,10', 1],
    ]),
  );
});

void test('the live metadata is read from its URL, and is null before the first publication', async () => {
  const state = {
    revision: 1,
    snapshotId: 'snap-1',
    count: 0,
    setDigest: '0'.repeat(64),
    metadataUrl: 'https://storage.invalid/file',
    pending: null,
  };
  const fetcher = (async (url: string) =>
    url === state.metadataUrl
      ? Response.json({ manifest: { region_id: 'x' }, coverage: null })
      : new Response(null, { status: 404 })) as typeof fetch;
  assert.equal(await readLiveMetadata(null, fetcher), null);
  assert.equal(
    await readLiveMetadata({ ...state, metadataUrl: null }, fetcher),
    null,
  );
  assert.deepEqual(await readLiveMetadata(state, fetcher), {
    manifest: { region_id: 'x' },
    coverage: null,
  });
  await assert.rejects(
    readLiveMetadata(
      { ...state, metadataUrl: 'https://storage.invalid/gone' },
      fetcher,
    ),
    /metadata failed: 404/,
  );
});
