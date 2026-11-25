import assert from 'node:assert/strict';

import test from 'node:test';
import { z } from 'zod';

import { combineCatalogues } from './catalogue-combine';
import {
  applyBatches,
  placeId,
  placeRows,
  publishCatalogue,
} from './catalogue-publish';
import type { CatalogueReader, CatalogueWriter } from './catalogue-reader';
import { LIVE_PLACE_REGION } from './catalogue-regions';
import {
  EMPTY_SET_DIGEST,
  PLACE_BATCH_LIMIT,
  type PlaceRow,
  addToSetDigest,
  removeFromSetDigest,
  rowHash,
  tileOf,
} from './catalogue-rows';
import { createSyntheticCatalogue } from './catalogue.fixture';
import type { NormalizedPlace } from './types';

void test('a place is named after its OpenStreetMap object', () => {
  const id = placeId({ osm_type: 'node', osm_id: '26863664' });
  assert.equal(id, placeId({ osm_type: 'node', osm_id: '26863664' }));
  assert.equal(z.uuid().safeParse(id).success, true);
  assert.equal(id[14], '5');
  assert.notEqual(id, placeId({ osm_type: 'way', osm_id: '26863664' }));
  assert.notEqual(id, placeId({ osm_type: 'node', osm_id: '26863665' }));
  // The ID is part of what clients and stored matches refer to: it must not
  // change with this code.
  assert.equal(id, '8154d608-bb20-59da-8cdc-b812f0a8783d');
});

void test('the rows sent are the listed places, in ID order, under stable IDs', () => {
  const catalogue = createSyntheticCatalogue({ regionId: LIVE_PLACE_REGION });
  const rows = placeRows(catalogue);
  assert.equal(
    rows.length,
    catalogue.rows.filter((row) => !row.hidden_reason).length,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    rows.map((row) => row.id).sort(),
  );
  // A later extract with the same objects names them the same way.
  const later = createSyntheticCatalogue({
    regionId: LIVE_PLACE_REGION,
    dataAsOf: '2026-11-01T00:00:00Z',
  });
  assert.notEqual(
    later.manifest.catalogue_snapshot_id,
    catalogue.manifest.catalogue_snapshot_id,
  );
  assert.deepEqual(
    placeRows(later).map((row) => row.id),
    rows.map((row) => row.id),
  );
});

void test('writes are batched by count and by request size', () => {
  const row = (index: number): PlaceRow => ({
    id: `place-${index}`,
    displayName: 'ü'.repeat(100),
    kinds: ['peak'],
    subtypes: ['peak'],
    location: { longitude: 8, latitude: 46 },
  });
  const upserts = Array.from({ length: 1_200 }, (_, index) => row(index));
  const deletes = ['gone-1', 'gone-2'];
  const tiles = Array.from({ length: 501 }, (_, index) => `${index},1`);
  const batches = applyBatches(deletes, upserts, tiles);
  assert.deepEqual(
    batches.map((batch) => [
      batch.deletes.length,
      batch.upserts.length,
      batch.tiles.length,
    ]),
    [
      [2, 498, 0],
      [0, 500, 0],
      [0, 202, 0],
      [0, 0, 500],
      [0, 0, 1],
    ],
  );
  // A smaller request budget splits by bytes (UTF-8, not characters).
  const bytes = Buffer.byteLength(JSON.stringify(upserts[0])) + 1;
  const small = applyBatches([], upserts.slice(0, 10), [], bytes * 4);
  assert.deepEqual(
    small.map((batch) => batch.upserts.length),
    [4, 4, 2],
  );
  for (const batch of small)
    assert.ok(Buffer.byteLength(JSON.stringify(batch.upserts)) < bytes * 4 + 2);
  assert.deepEqual(applyBatches([], [], []), []);
});

/**
 * An in-memory live catalogue that answers the catalogue reader's and the
 * write bridge's operations as `backend/convex/livePlaces.ts` does,
 * including its refusals. Each operation is only answered on its own
 * channel.
 */
function fakeBackend() {
  type Live = { place: PlaceRow; hash: string; tile: string };
  type Pending = {
    snapshotId: string;
    revision: number;
    metadata: string;
    count: number;
    setDigest: string;
    startedAt: number;
  };
  const rows = new Map<string, Live>();
  const files = new Map<string, string>();
  const tileChanges = new Map<number, Set<string>>();
  const rematched: number[] = [];
  let state: {
    revision: number;
    snapshotId?: string;
    metadata?: string;
    count: number;
    setDigest: string;
    pending?: Pending;
  } | null = null;
  const operations: { kind: string; [field: string]: unknown }[] = [];
  /** Fails the next operation of this kind, before or after it is applied. */
  let failure: { kind: string; after: boolean } | null = null;

  async function handle(operation: {
    kind: string;
    [field: string]: unknown;
  }): Promise<unknown> {
    const args: unknown = operation;
    switch (operation.kind) {
      case 'uploadUrl':
        return 'https://upload.invalid/1';
      case 'liveState':
        return (
          state && {
            revision: state.revision,
            snapshotId: state.snapshotId ?? null,
            count: state.count,
            setDigest: state.setDigest,
            metadataUrl: state.metadata
              ? `https://storage.invalid/${state.metadata}`
              : null,
            pending: state.pending
              ? {
                  snapshotId: state.pending.snapshotId,
                  revision: state.pending.revision,
                  count: state.pending.count,
                  setDigest: state.pending.setDigest,
                  startedAt: state.pending.startedAt,
                }
              : null,
          }
        );
      case 'liveHashes': {
        const { cursor, limit = 64 } = args as {
          cursor: string | null;
          limit?: number;
        };
        const keys = [...rows.keys()].sort();
        const start = cursor === null ? 0 : Number(cursor);
        const end = Math.min(keys.length, start + limit);
        return {
          page: keys.slice(start, end).map((key) => {
            const { hash, tile } = rows.get(key)!;
            return { key, hash, tile };
          }),
          isDone: end === keys.length,
          continueCursor: String(end),
        };
      }
      case 'beginApply': {
        const begin = args as {
          expectCurrent: string | null;
          snapshotId: string;
          metadata: string;
          count: number;
          setDigest: string;
          replacePending?: string;
        };
        assert.ok(files.has(begin.metadata));
        state ??= { revision: 0, count: 0, setDigest: EMPTY_SET_DIGEST };
        const current = state.snapshotId ?? null;
        const { pending } = state;
        const refuse = (reason: string) => ({
          ok: false,
          reason,
          current,
          pending: pending?.snapshotId ?? null,
        });
        if (begin.expectCurrent !== current) return refuse('current_changed');
        if (pending?.snapshotId === begin.snapshotId) {
          assert.deepEqual(
            [pending.count, pending.setDigest],
            [begin.count, begin.setDigest],
          );
          return { ok: true, revision: pending.revision, resumed: true };
        }
        if (begin.replacePending !== pending?.snapshotId)
          return refuse('pending_other');
        if (!pending && begin.snapshotId === current)
          return refuse('already_current');
        state.pending = {
          snapshotId: begin.snapshotId,
          revision: state.revision + 1,
          metadata: begin.metadata,
          count: begin.count,
          setDigest: begin.setDigest,
          startedAt: Date.now() - 5 * 60_000,
        };
        return { ok: true, revision: state.revision + 1, resumed: false };
      }
      case 'applyBatch': {
        const batch = args as {
          snapshotId: string;
          upserts: PlaceRow[];
          deletes: string[];
          tiles: string[];
        };
        const writes = batch.upserts.length + batch.deletes.length;
        assert.ok(writes <= PLACE_BATCH_LIMIT && batch.tiles.length <= 500);
        assert.ok(writes + batch.tiles.length > 0);
        const keys = [...batch.upserts.map(({ id }) => id), ...batch.deletes];
        assert.equal(new Set(keys).size, keys.length);
        assert.ok(JSON.stringify(operation).length < 1024 * 1024);
        if (state?.pending?.snapshotId !== batch.snapshotId)
          return { ok: false, reason: 'not_pending' };
        const changed = tileChanges.get(state.pending.revision) ?? new Set();
        tileChanges.set(state.pending.revision, changed);
        for (const tile of batch.tiles) changed.add(tile);
        for (const place of batch.upserts) {
          const hash = await rowHash(place);
          const live = rows.get(place.id);
          if (live?.hash === hash) continue;
          if (live) {
            state.setDigest = removeFromSetDigest(state.setDigest, live.hash);
            changed.add(live.tile);
          } else state.count++;
          const tile = tileOf(place.location);
          rows.set(place.id, { place: structuredClone(place), hash, tile });
          state.setDigest = addToSetDigest(state.setDigest, hash);
          changed.add(tile);
        }
        for (const key of batch.deletes) {
          const live = rows.get(key);
          if (!live) continue;
          rows.delete(key);
          state.count--;
          state.setDigest = removeFromSetDigest(state.setDigest, live.hash);
          changed.add(live.tile);
        }
        return { ok: true, count: state.count, setDigest: state.setDigest };
      }
      case 'completeApply': {
        const { snapshotId } = args as { snapshotId: string };
        const live = {
          count: state?.count ?? 0,
          setDigest: state?.setDigest ?? EMPTY_SET_DIGEST,
        };
        if (state && !state.pending && state.snapshotId === snapshotId)
          return { ok: true, revision: state.revision };
        const pending = state?.pending;
        if (!state || pending?.snapshotId !== snapshotId)
          return { ok: false, reason: 'not_pending', ...live };
        if (
          pending.count !== state.count ||
          pending.setDigest !== state.setDigest
        )
          return { ok: false, reason: 'mismatch', ...live };
        state.revision = pending.revision;
        state.snapshotId = snapshotId;
        state.metadata = pending.metadata;
        delete state.pending;
        rematched.push(pending.revision);
        return { ok: true, revision: pending.revision };
      }
      default:
        throw new Error(`Unexpected operation ${operation.kind}`);
    }
  }

  const reads = new Set(['liveState', 'liveHashes']);
  const reader: CatalogueReader = {
    async read<T>(operation: { kind: string; [field: string]: unknown }) {
      assert.ok(reads.has(operation.kind), `${operation.kind} is no read`);
      operations.push(structuredClone(operation));
      return (await handle(structuredClone(operation))) as T;
    },
  };
  const writer: CatalogueWriter = {
    async write<T>(operation: { kind: string; [field: string]: unknown }) {
      assert.ok(!reads.has(operation.kind), `${operation.kind} is a read`);
      operations.push(structuredClone(operation));
      const fail = failure?.kind === operation.kind ? failure : null;
      if (fail) failure = null;
      if (fail && !fail.after) throw new Error('Connection lost');
      const result = await handle(structuredClone(operation));
      if (fail) throw new Error('Connection lost');
      return result as T;
    },
  };
  let uploads = 0;
  return {
    reader,
    writer,
    upload: async (url: string, file: Uint8Array) => {
      assert.equal(url, 'https://upload.invalid/1');
      const id = `file-${++uploads}`;
      files.set(id, new TextDecoder().decode(file));
      return id;
    },
    fetcher: (async (url: string) => {
      const id = url.replace('https://storage.invalid/', '');
      const file = files.get(id);
      return new Response(file ?? null, { status: file ? 200 : 404 });
    }) as typeof fetch,
    operations,
    /** The operations since the last call. */
    take() {
      return operations.splice(0);
    },
    failNext(kind: string, after: boolean) {
      failure = { kind, after };
    },
    rows,
    tileChanges,
    rematched,
    state: () => state,
  };
}

const coverageBox = (east: number) => ({
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [7, 45],
        [east, 45],
        [east, 48],
        [7, 48],
        [7, 45],
      ],
    ],
  ],
});

/** A synthetic artifact with `peaks` more peaks; `source` (one hex digit)
 * names the snapshot. */
function artifact({
  source,
  peaks = 0,
  edit = (rows) => rows,
  east = 10,
}: {
  source: string;
  peaks?: number;
  edit?: (rows: NormalizedPlace[]) => NormalizedPlace[];
  east?: number;
}) {
  return createSyntheticCatalogue({
    regionId: LIVE_PLACE_REGION,
    sourceSha256: source.repeat(64),
    coverage: coverageBox(east),
    transformRows: (rows) =>
      edit([
        ...rows,
        ...Array.from({ length: peaks }, (_, index) => ({
          ...rows[0]!,
          osm_id: String(1_000 + index),
          display_name: `Peak ${index}`,
          names: { name: `Peak ${index}` },
          tags: { name: `Peak ${index}`, natural: 'peak' },
          location: {
            longitude: 7.5 + (index % 40) * 0.05,
            latitude: 45.5 + Math.floor(index / 40) * 0.05,
          },
          elevation_m: 1_000 + index,
        })),
      ]),
  });
}

const byId = (rows: Iterable<PlaceRow>) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
const kinds = (operations: { kind: string }[]) =>
  operations.map(({ kind }) => kind).filter((kind) => kind !== 'liveHashes');
const batchesOf = (operations: { kind: string; [field: string]: unknown }[]) =>
  operations.filter(({ kind }) => kind === 'applyBatch') as never as {
    upserts: PlaceRow[];
    deletes: string[];
    tiles: string[];
  }[];

/** Live rows equal the artifact's, and count and digest agree. */
async function assertLive(
  backend: ReturnType<typeof fakeBackend>,
  catalogue: ReturnType<typeof artifact>,
) {
  const rows = placeRows(catalogue);
  assert.deepEqual(
    byId([...backend.rows.values()].map(({ place }) => place)),
    rows,
  );
  const hashes = await Promise.all(rows.map(rowHash));
  assert.deepEqual(
    [backend.state()?.count, backend.state()?.setDigest],
    [rows.length, hashes.reduce(addToSetDigest, EMPTY_SET_DIGEST)],
  );
  assert.equal(
    backend.state()?.snapshotId,
    catalogue.manifest.catalogue_snapshot_id,
  );
  assert.equal(backend.state()?.pending, undefined);
}

function publisher(backend: ReturnType<typeof fakeBackend>) {
  return (
    catalogue: ReturnType<typeof artifact>,
    options: Partial<Parameters<typeof publishCatalogue>[0]> = {},
  ) =>
    publishCatalogue({
      catalogue,
      reader: backend.reader,
      writer: backend.writer,
      upload: backend.upload,
      fetcher: backend.fetcher,
      ...options,
    });
}

void test('a first publication inserts every place after a reviewed dry run', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a' });
  const rows = placeRows(a);

  const dry = await publish(a);
  assert.equal(dry.status, 'would_publish');
  assert.equal(dry.current, null);
  assert.deepEqual(dry.changes, {
    inserts: rows.length,
    updates: 0,
    moved: 0,
    deletes: 0,
    unchanged: 0,
  });
  assert.deepEqual(
    dry.examples.inserts,
    rows.map(({ id, displayName }) => ({ id, displayName })),
  );
  assert.equal(
    dry.affectedTiles,
    new Set(rows.map((row) => tileOf(row.location))).size,
  );
  assert.equal(dry.coverageChanged, false);
  assert.equal(dry.hidden, a.rows.length - rows.length);
  assert.equal(
    Object.values(dry.hiddenByReason).reduce((sum, n) => sum + n, 0),
    dry.hidden,
  );
  assert.equal(dry.pending, null);
  assert.deepEqual(kinds(backend.take()), ['liveState']);

  // Publishing needs what the dry run saw, and the serving region.
  await assert.rejects(publish(a, { apply: true }), /expectedCurrent/);
  await assert.rejects(
    publish(a, { apply: true, expectedCurrent: 'osm-places-v1:other' }),
    /live catalogue is none, not osm-places-v1:other.*new dry run/,
  );
  await assert.rejects(
    publish(createSyntheticCatalogue({ regionId: 'switzerland' })),
    /region switzerland/,
  );
  assert.equal(backend.state(), null);
  backend.take();

  const progress: [number, number][] = [];
  const published = await publish(a, {
    apply: true,
    expectedCurrent: null,
    progress: (sent, total) => progress.push([sent, total]),
  });
  assert.deepEqual([published.status, published.revision], ['published', 1]);
  const operations = backend.take();
  assert.deepEqual(kinds(operations), [
    'liveState',
    'uploadUrl',
    'beginApply',
    'applyBatch',
    'completeApply',
  ]);
  assert.deepEqual(
    operations.find(({ kind }) => kind === 'beginApply')!.source,
    { dataAsOf: Date.parse(a.manifest.source.data_as_of), regions: 1 },
  );
  assert.deepEqual(progress, [
    [0, rows.length],
    [rows.length, rows.length],
  ]);
  await assertLive(backend, a);
  assert.deepEqual(backend.rematched, [1]);
  // The metadata the next publication diffs its coverage with.
  const metadata: unknown = await (
    await backend.fetcher(
      `https://storage.invalid/${backend.state()!.metadata}`,
    )
  ).json();
  assert.deepEqual(metadata, { manifest: a.manifest, coverage: a.coverage });
});

void test('a dry run needs only the reader; applying needs the writer', async () => {
  const backend = fakeBackend();
  const a = artifact({ source: 'a' });
  const dry = await publishCatalogue({ catalogue: a, reader: backend.reader });
  assert.equal(dry.status, 'would_publish');
  assert.deepEqual(new Set(kinds(backend.take())), new Set(['liveState']));
  for (const missing of [
    { upload: backend.upload },
    { writer: backend.writer },
  ])
    await assert.rejects(
      publishCatalogue({
        catalogue: a,
        reader: backend.reader,
        apply: true,
        expectedCurrent: null,
        ...missing,
      }),
      /requires the Convex writer and upload/,
    );
  assert.deepEqual(backend.take(), []);
  assert.equal(backend.state(), null);
});

void test('the report sizes the coverage every match reads and names the regions added and removed', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const combined = (...regions: string[]) =>
    combineCatalogues(
      LIVE_PLACE_REGION,
      regions.map((regionId) =>
        createSyntheticCatalogue({ regionId, coverage: coverageBox(10) }),
      ),
    );
  const first = combined('switzerland', 'austria');

  const dry = await publish(first);
  const metadataBytes = Buffer.byteLength(
    JSON.stringify({ manifest: first.manifest, coverage: first.coverage }),
  );
  assert.deepEqual(dry.coverage, {
    polygons: 1,
    vertices: first.coverage.coordinates.flat(2).length,
    metadataBytes,
  });
  assert.ok(dry.coverage.vertices > 4, `${dry.coverage.vertices} vertices`);
  // Before the first publication every region is new.
  assert.deepEqual(
    [dry.regions, dry.regionsAdded, dry.regionsRemoved],
    [['austria', 'switzerland'], ['austria', 'switzerland'], []],
  );
  await publish(first, { apply: true, expectedCurrent: null });
  // The size is that of the file every match downloads.
  const stored = await backend.fetcher(
    `https://storage.invalid/${backend.state()!.metadata}`,
  );
  assert.equal(Buffer.byteLength(await stored.text()), metadataBytes);

  const next = await publish(combined('italy', 'switzerland'));
  assert.deepEqual(
    [next.regions, next.regionsAdded, next.regionsRemoved],
    [['italy', 'switzerland'], ['italy'], ['austria']],
  );
  // A single-region artifact is its own region; no tile is ever reported.
  const single = await publish(artifact({ source: 'a' }));
  assert.deepEqual(
    [single.regions, single.regionsAdded, single.regionsRemoved],
    [[LIVE_PLACE_REGION], [LIVE_PLACE_REGION], ['austria', 'switzerland']],
  );
  assert.doesNotMatch(JSON.stringify(single), /"\d+,\d+"/);
});

void test('an unchanged catalogue writes nothing, even under a new snapshot', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a' });
  await publish(a, { apply: true, expectedCurrent: null });
  backend.take();

  const again = await publish(a, {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  });
  assert.equal(again.status, 'unchanged');
  assert.equal(again.affectedTiles, 0);
  // The same places and coverage from a newer extract.
  const later = artifact({ source: 'b' });
  const dry = await publish(later);
  assert.deepEqual(
    [dry.status, dry.current, dry.snapshotId],
    [
      'unchanged',
      a.manifest.catalogue_snapshot_id,
      later.manifest.catalogue_snapshot_id,
    ],
  );
  const applied = await publish(later, {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  });
  assert.equal(applied.status, 'unchanged');
  assert.deepEqual(new Set(kinds(backend.take())), new Set(['liveState']));
  assert.equal(backend.state()?.snapshotId, a.manifest.catalogue_snapshot_id);
  assert.deepEqual(backend.rematched, [1]);
});

/** `a` with the summit renamed, the hut moved to another tile, the pass
 * removed and a new peak. */
const changed = (source: string, peaks = 0) =>
  artifact({
    source,
    peaks,
    edit: (rows) => [
      ...rows
        .filter((row) => !row.kinds.includes('pass'))
        .map((row) =>
          row.display_name === 'Synthetic summit'
            ? { ...row, display_name: 'Renamed summit' }
            : row.kinds.includes('hut')
              ? { ...row, location: { longitude: 9.3, latitude: 47.2 } }
              : row,
        ),
      {
        ...rows[0]!,
        osm_id: '77',
        display_name: 'New peak',
        names: { name: 'New peak' },
        tags: { name: 'New peak', natural: 'peak' },
        location: { longitude: 9.9, latitude: 45.1 },
      },
    ],
  });

void test('an incremental publication sends only the difference', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a', peaks: 30 });
  const b = changed('b', 30);
  await publish(a, { apply: true, expectedCurrent: null });
  backend.take();

  const before = new Map(placeRows(a).map((row) => [row.id, row]));
  const after = placeRows(b);
  const summit = after.find((row) => row.displayName === 'Renamed summit')!;
  const hut = after.find((row) => row.kinds.includes('hut'))!;
  const added = after.find((row) => row.displayName === 'New peak')!;
  const pass = placeRows(a).find((row) => row.kinds.includes('pass'));

  const dry = await publish(b);
  assert.equal(dry.status, 'would_publish');
  assert.deepEqual(dry.changes, {
    inserts: 1,
    updates: 2,
    moved: 1,
    deletes: pass ? 1 : 0,
    unchanged: after.length - 3,
  });
  assert.deepEqual(dry.examples.inserts, [
    { id: added.id, displayName: 'New peak' },
  ]);
  assert.deepEqual(
    new Set(dry.examples.updates.map(({ id, moved }) => `${id}:${moved}`)),
    new Set([`${summit.id}:false`, `${hut.id}:true`]),
  );
  const tiles = new Set(
    [summit, hut, before.get(hut.id)!, added, ...(pass ? [pass] : [])].map(
      (row) => tileOf(row.location),
    ),
  );
  assert.equal(dry.affectedTiles, tiles.size);
  backend.take();

  const published = await publish(b, {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  });
  assert.deepEqual([published.status, published.revision], ['published', 2]);
  const [batch, ...rest] = batchesOf(backend.take());
  assert.deepEqual(rest, []);
  assert.deepEqual(batch!.deletes, pass ? [pass.id] : []);
  assert.deepEqual(byId(batch!.upserts), byId([summit, hut, added]));
  assert.deepEqual(batch!.tiles, []);
  assert.deepEqual(backend.tileChanges.get(2), tiles);
  await assertLive(backend, b);
  assert.deepEqual(backend.rematched, [1, 2]);
});

void test('a coverage change with unchanged places sends its tiles only', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a' });
  const wider = artifact({ source: 'b', east: 11 });
  await publish(a, { apply: true, expectedCurrent: null });
  backend.take();

  const dry = await publish(wider);
  assert.equal(dry.status, 'would_publish');
  assert.equal(dry.coverageChanged, true);
  assert.equal(dry.changes.unchanged, placeRows(a).length);
  assert.ok(dry.affectedTiles > 12, `${dry.affectedTiles} tiles`);
  backend.take();

  await publish(wider, {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  });
  const batches = batchesOf(backend.take());
  assert.ok(batches.length >= 1);
  for (const batch of batches)
    assert.deepEqual([batch.upserts, batch.deletes], [[], []]);
  const sent = batches.flatMap((batch) => batch.tiles);
  assert.equal(sent.length, dry.affectedTiles);
  assert.deepEqual(backend.tileChanges.get(2), new Set(sent));
  // The added strip from 10°E to 11°E.
  assert.ok(sent.includes(tileOf({ longitude: 10.6, latitude: 46.6 })));
  assert.ok(!sent.includes(tileOf({ longitude: 8, latitude: 46.6 })));
  await assertLive(backend, wider);
});

void test('running the same command again finishes an interrupted publication', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a', peaks: 700 });
  const rows = placeRows(a);
  const options = { apply: true, expectedCurrent: null };

  // The connection is lost after the first batch was applied.
  backend.failNext('applyBatch', true);
  await assert.rejects(publish(a, options), /Connection lost/);
  assert.equal(backend.rows.size, PLACE_BATCH_LIMIT);

  const dry = await publish(a);
  assert.equal(dry.status, 'would_publish');
  assert.equal(dry.changes.inserts, rows.length - PLACE_BATCH_LIMIT);
  assert.equal(dry.pending?.snapshotId, a.manifest.catalogue_snapshot_id);
  assert.equal(dry.pending?.ageMinutes, 5);
  backend.take();

  const resumed = await publish(a, options);
  assert.equal(resumed.status, 'published');
  const batches = batchesOf(backend.take());
  assert.deepEqual(
    batches.map((batch) => batch.upserts.length),
    [rows.length - PLACE_BATCH_LIMIT],
  );
  await assertLive(backend, a);

  // Interrupted after every row was sent: nothing differs, but the pending
  // publication still sends its coverage tiles and completes.
  const b = artifact({ source: 'b', peaks: 700, east: 10.5 });
  const current = {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  };
  backend.failNext('completeApply', false);
  await assert.rejects(publish(b, current), /Connection lost/);
  const firstTiles = batchesOf(backend.take()).flatMap((batch) => batch.tiles);
  assert.ok(firstTiles.length > 0);
  assert.equal(
    backend.state()?.pending?.snapshotId,
    b.manifest.catalogue_snapshot_id,
  );

  const pending = await publish(b);
  assert.equal(pending.status, 'would_publish');
  assert.equal(pending.changes.unchanged, rows.length);
  backend.take();
  const finished = await publish(b, current);
  assert.equal(finished.status, 'published');
  const operations = backend.take();
  assert.deepEqual(
    kinds(operations).filter((kind) => kind !== 'applyBatch'),
    ['liveState', 'uploadUrl', 'beginApply', 'completeApply'],
  );
  assert.deepEqual(
    batchesOf(operations).flatMap((batch) => batch.tiles),
    firstTiles,
  );
  await assertLive(backend, b);
});

void test('another pending publication is finished or explicitly replaced', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a', peaks: 10 });
  const b = changed('b', 10);
  const c = artifact({ source: 'c', peaks: 12 });
  const current = {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  };
  await publish(a, { apply: true, expectedCurrent: null });

  backend.failNext('completeApply', false);
  await assert.rejects(publish(b, current), /Connection lost/);
  const bId = b.manifest.catalogue_snapshot_id;

  const dry = await publish(c);
  assert.equal(dry.pending?.snapshotId, bId);
  backend.take();
  await assert.rejects(
    publish(c, current),
    new RegExp(
      `publication of ${bId} is not complete.*--replace-pending ${bId}`,
    ),
  );
  await assert.rejects(
    publish(c, { ...current, replacePending: 'osm-places-v1:other' }),
    /--replace-pending/,
  );
  // Refused from the live state alone: nothing was uploaded or begun.
  assert.deepEqual(kinds(backend.take()), ['liveState', 'liveState']);
  const replaced = await publish(c, { ...current, replacePending: bId });
  assert.equal(replaced.status, 'published');
  await assertLive(backend, c);
  assert.equal(backend.state()?.revision, 2);
});

void test('the live catalogue changing after the dry run is refused', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a' });
  const b = changed('b');
  await publish(a, { apply: true, expectedCurrent: null });
  await assert.rejects(
    publish(b, { apply: true, expectedCurrent: null }),
    new RegExp(
      `live catalogue is ${a.manifest.catalogue_snapshot_id}, not none`,
    ),
  );
  await assertLive(backend, a);
});

void test('a large retirement must be allowed explicitly', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a', peaks: 20 });
  const small = artifact({ source: 'b', peaks: 5 });
  const current = {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  };
  await publish(a, { apply: true, expectedCurrent: null });

  const dry = await publish(small);
  assert.equal(dry.largeRetirement, true);
  assert.equal(dry.changes.deletes, 15);
  await assert.rejects(publish(small, current), /more than 20%/);
  await assertLive(backend, a);
  const published = await publish(small, {
    ...current,
    allowLargeRetirement: true,
  });
  assert.equal(published.status, 'published');
  await assertLive(backend, small);
});

void test('publishing an older artifact rolls back to it', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a', peaks: 10 });
  const b = changed('b', 10);
  await publish(a, { apply: true, expectedCurrent: null });
  await publish(b, {
    apply: true,
    expectedCurrent: a.manifest.catalogue_snapshot_id,
  });
  await assertLive(backend, b);
  const back = await publish(a, {
    apply: true,
    expectedCurrent: b.manifest.catalogue_snapshot_id,
  });
  assert.deepEqual([back.status, back.revision], ['published', 3]);
  await assertLive(backend, a);
});

void test('the dry run counts what a full comparison of the two artifacts finds', async () => {
  const backend = fakeBackend();
  const publish = publisher(backend);
  const a = artifact({ source: 'a', peaks: 50 });
  const b = artifact({
    source: 'b',
    peaks: 60,
    edit: (rows) =>
      rows
        .filter((_, index) => index % 7 !== 3)
        .map((row, index) =>
          index % 5 === 0
            ? { ...row, elevation_m: (row.elevation_m ?? 0) + 1 }
            : row,
        ),
  });
  await publish(a, { apply: true, expectedCurrent: null });
  const dry = await publish(b);

  const old = new Map(placeRows(a).map((row) => [row.id, row]));
  const next = placeRows(b);
  const expected = {
    inserts: 0,
    updates: 0,
    moved: 0,
    deletes: 0,
    unchanged: 0,
  };
  for (const row of next) {
    const previous = old.get(row.id);
    if (!previous) expected.inserts++;
    else if (JSON.stringify(previous) === JSON.stringify(row))
      expected.unchanged++;
    else {
      expected.updates++;
      if (tileOf(previous.location) !== tileOf(row.location)) expected.moved++;
    }
  }
  const ids = new Set(next.map((row) => row.id));
  expected.deletes = [...old.keys()].filter((id) => !ids.has(id)).length;
  assert.deepEqual(dry.changes, expected);
  assert.ok(expected.inserts && expected.updates && expected.deletes);
});
