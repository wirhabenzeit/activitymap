import { createHash } from 'node:crypto';

import type { ConvexWriter } from '~/server/sync/convex-writer';

import { coverageClearanceM } from './batch-coverage';
import {
  type ValidatedCatalogue,
  listedPlaceCount,
  validateCatalogue,
} from './catalogue-artifact';
import { type LiveRowHash, diffCatalogue } from './catalogue-diff';
import { V1_PLACE_REGION } from './catalogue-regions';
import {
  EMPTY_SET_DIGEST,
  PLACE_BATCH_LIMIT,
  type PlaceRow,
  addToSetDigest,
  rowHash,
} from './catalogue-rows';
import { type CoverageGeometry, parseCoverageGeometry } from './coverage';
import { coverageChangeTiles } from './coverage-diff';
import { SERVER_MATCHER_POLICY } from './matching-version';
import type { NormalizedPlace } from './types';

/**
 * Publishes a catalogue artifact (`pnpm places:prepare`, `places:combine`)
 * to the Convex backend's live catalogue (`backend/convex/livePlaces.ts`).
 *
 * A publication sends only the difference between the artifact and the live
 * rows, plus the tiles where the coverage changed. When it completes, the
 * backend matches again the activities that pass through a changed tile.
 *
 * A place keeps its ID for as long as its OpenStreetMap object exists: the
 * ID is derived from the object's type and number, so two catalogues name
 * the same place the same way without a database that remembers them.
 */

/** How artifact rows become place rows in a rowset (`sendCatalogue`), the
 * format before the live catalogue. Part of a rowset's identity. */
export const PLACE_ROWS_VERSION = 'osm-rows-v1';

const PLACE_NAMESPACE = Buffer.from('6f1d3c52a8e44b0f9c1e5a7b2d4f6081', 'hex');

/** A name-based UUID (version 5) of the place's OpenStreetMap object. */
export function placeId(row: Pick<NormalizedPlace, 'osm_type' | 'osm_id'>) {
  const bytes = createHash('sha1')
    .update(PLACE_NAMESPACE)
    .update(`${row.osm_type}/${row.osm_id}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** The places the matcher reads: every row the noise filter does not hide,
 * in ascending ID order. */
export function placeRows(catalogue: ValidatedCatalogue): PlaceRow[] {
  const rows = catalogue.rows
    .filter((row) => !row.hidden_reason)
    .map((row): PlaceRow => ({
      id: placeId(row),
      displayName: row.display_name,
      kinds: [...row.kinds],
      subtypes: [...row.subtypes],
      location: {
        longitude: row.location.longitude,
        latitude: row.location.latitude,
      },
      ...(row.elevation_m === undefined ? {} : { elevationM: row.elevation_m }),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let index = 1; index < rows.length; index++)
    if (rows[index]!.id === rows[index - 1]!.id)
      throw new Error(`Two places share the ID ${rows[index]!.id}`);
  if (rows.length !== listedPlaceCount(catalogue.manifest))
    throw new Error('Listed places disagree with the manifest counts');
  return rows;
}

/** The bridge's request limit is 1 MiB; leave room for the envelope. */
const BATCH_BYTES = 768 * 1024;
const EXAMPLES = 5;

type LiveState = {
  revision: number;
  snapshotId: string | null;
  count: number;
  setDigest: string;
  metadataUrl: string | null;
  pending: {
    snapshotId: string;
    revision: number;
    count: number;
    setDigest: string;
    startedAt: number;
  } | null;
} | null;
type Refusal<Reason extends string> = { ok: false; reason: Reason };
type Begun =
  | { ok: true; revision: number; resumed: boolean }
  | (Refusal<'current_changed' | 'pending_other' | 'already_current'> & {
      current: string | null;
      pending: string | null;
    });
type Applied =
  { ok: true; count: number; setDigest: string } | Refusal<'not_pending'>;
type Completed =
  | { ok: true; revision: number }
  | (Refusal<'not_pending' | 'mismatch'> & {
      count: number;
      setDigest: string;
    });

export type ApplyBatch = {
  upserts: PlaceRow[];
  deletes: string[];
  tiles: string[];
};

export type CataloguePublishReport = {
  status: 'unchanged' | 'would_publish' | 'published';
  snapshotId: string;
  /** The snapshot applied last; null before the first publication. */
  current: string | null;
  /** The live revision this run completed (status `published`). */
  revision?: number;
  /** Places in the artifact: its rows without those the filter hides. */
  count: number;
  /** Live places now. */
  liveCount: number;
  hidden: number;
  hiddenByReason: Record<string, number>;
  sourceDataAsOf: string;
  changes: {
    inserts: number;
    updates: number;
    /** Updates that moved to another tile. */
    moved: number;
    deletes: number;
    unchanged: number;
  };
  examples: {
    inserts: { id: string; displayName: string }[];
    updates: { id: string; displayName: string; moved: boolean }[];
    deletes: string[];
  };
  coverageChanged: boolean;
  /** Tiles whose activities are matched again: those of the changed rows
   * and of the coverage change. Only the count: logs may be public. */
  affectedTiles: number;
  /** The artifact has fewer than 80% of the live places. */
  largeRetirement: boolean;
  /** A publication begun and not completed. */
  pending: { snapshotId: string; startedAt: string; ageMinutes: number } | null;
};

/**
 * Publish `catalogue`, or with `apply: false` report what publishing would
 * do. Publishing begins an apply of the artifact, sends the changed rows and
 * tiles, and completes it. Safe to repeat: a run that was interrupted is
 * finished by running it again, which sends only what is still missing.
 * Publishing an older artifact rolls back to it.
 */
export async function publishCatalogue({
  catalogue: input,
  writer,
  upload,
  fetcher = fetch,
  apply = false,
  expectedCurrent,
  allowLargeRetirement = false,
  replacePending,
  regionId = V1_PLACE_REGION,
  progress,
  now = Date.now,
}: {
  catalogue: ValidatedCatalogue;
  writer: ConvexWriter;
  /** POST a file to a Convex upload URL; returns its storage ID. */
  upload: (url: string, file: Uint8Array) => Promise<string>;
  /** Reads the live catalogue's metadata file. */
  fetcher?: typeof fetch;
  apply?: boolean;
  /** Compare-and-set: the snapshot the dry run reported as current; null
   * when nothing was published yet. Required to apply. */
  expectedCurrent?: string | null;
  allowLargeRetirement?: boolean;
  /** Abandon the pending publication of this snapshot. */
  replacePending?: string;
  regionId?: string;
  /** Rows and tiles sent of those to send. */
  progress?: (sent: number, total: number) => void;
  now?: () => number;
}): Promise<CataloguePublishReport> {
  const catalogue = validateCatalogue(input);
  if (catalogue.manifest.region_id !== regionId)
    throw new Error(
      `The artifact is for region ${catalogue.manifest.region_id ?? '(none)'}, not ${regionId}`,
    );
  if (apply && expectedCurrent === undefined)
    throw new Error('Publication requires expectedCurrent from a dry run');
  const snapshotId = catalogue.manifest.catalogue_snapshot_id;
  const rows = placeRows(catalogue);
  const hashes = await Promise.all(rows.map(rowHash));
  const live = await writer.write<LiveState>({ kind: 'liveState' });
  const diff = diffCatalogue(
    rows.map((place, index) => ({ place, hash: hashes[index]! })),
    await liveHashes(writer),
  );
  // Before the first completed publication nothing was matched against the
  // live catalogue, so a coverage change concerns no activity.
  const previous = live?.metadataUrl
    ? await readCoverage(live.metadataUrl, fetcher)
    : null;
  const coverageTiles = previous
    ? coverageChangeTiles(
        previous,
        catalogue.coverage,
        coverageClearanceM(SERVER_MATCHER_POLICY.discoveryRadiusM),
      )
    : [];
  const upserts = [...diff.inserts, ...diff.updates.map(({ place }) => place)];
  const hiddenByReason: Record<string, number> = {};
  for (const { hidden_reason: reason } of catalogue.rows)
    if (reason) hiddenByReason[reason] = (hiddenByReason[reason] ?? 0) + 1;
  const current = live?.snapshotId ?? null;
  const pending = live?.pending ?? null;
  const report = {
    snapshotId,
    current,
    count: rows.length,
    liveCount: live?.count ?? 0,
    hidden: catalogue.rows.length - rows.length,
    hiddenByReason,
    sourceDataAsOf: catalogue.manifest.source.data_as_of,
    changes: {
      inserts: diff.inserts.length,
      updates: diff.updates.length,
      moved: diff.updates.filter(({ moved }) => moved).length,
      deletes: diff.deletes.length,
      unchanged: diff.unchanged,
    },
    examples: {
      inserts: diff.inserts
        .slice(0, EXAMPLES)
        .map(({ id, displayName }) => ({ id, displayName })),
      updates: diff.updates.slice(0, EXAMPLES).map(({ place, moved }) => ({
        id: place.id,
        displayName: place.displayName,
        moved,
      })),
      deletes: diff.deletes.slice(0, EXAMPLES),
    },
    coverageChanged: coverageTiles.length > 0,
    affectedTiles: new Set([...diff.tiles, ...coverageTiles]).size,
    largeRetirement: !!live && rows.length < live.count * 0.8,
    pending: pending && {
      snapshotId: pending.snapshotId,
      startedAt: new Date(pending.startedAt).toISOString(),
      ageMinutes: Math.floor((now() - pending.startedAt) / 60_000),
    },
  };
  // A pending apply, even of this artifact, still has to be completed or
  // replaced, so only a settled catalogue is unchanged.
  const unchanged =
    !pending &&
    !upserts.length &&
    !diff.deletes.length &&
    !coverageTiles.length;
  if (unchanged) return { status: 'unchanged', ...report };
  if (!apply) return { status: 'would_publish', ...report };

  if (expectedCurrent !== current)
    throw new Error(
      `The live catalogue is ${current ?? 'none'}, not ${expectedCurrent ?? 'none'} as expected: review a new dry run`,
    );
  if (report.largeRetirement && !allowLargeRetirement)
    throw new Error(
      'The catalogue would lose more than 20% of its places; inspect the artifact and explicitly allow large retirement',
    );

  // Upload URLs are issued under an owner's current assignment.
  const owner = await writer.write<{ epoch: string } | null>({ kind: 'state' });
  if (!owner) throw new Error('The signing owner is not provisioned');
  const [url] = await writer.write<string[]>(
    { kind: 'uploadUrls', count: 1 },
    owner.epoch,
  );
  const metadata = await upload(
    url!,
    new TextEncoder().encode(
      JSON.stringify({
        manifest: catalogue.manifest,
        coverage: catalogue.coverage,
      }),
    ),
  );
  const begun = await writer.write<Begun>({
    kind: 'beginApply',
    expectCurrent: expectedCurrent,
    snapshotId,
    metadata,
    count: rows.length,
    setDigest: hashes.reduce(addToSetDigest, EMPTY_SET_DIGEST),
    ...(replacePending === undefined ? {} : { replacePending }),
  });
  if (!begun.ok) throw new Error(beginRefusal(snapshotId, begun));

  const batches = applyBatches(diff.deletes, upserts, coverageTiles);
  const total = diff.deletes.length + upserts.length + coverageTiles.length;
  let sent = 0;
  progress?.(sent, total);
  for (const batch of batches) {
    const applied = await writer.write<Applied>({
      kind: 'applyBatch',
      snapshotId,
      ...batch,
    });
    if (!applied.ok) throw new Error(notPending(snapshotId));
    sent += batch.upserts.length + batch.deletes.length + batch.tiles.length;
    progress?.(sent, total);
  }

  const completed = await writer.write<Completed>({
    kind: 'completeApply',
    snapshotId,
  });
  if (!completed.ok)
    throw new Error(
      completed.reason === 'not_pending'
        ? notPending(snapshotId)
        : `The live catalogue holds ${completed.count} places with digest ${completed.setDigest}, not the artifact's ${rows.length}: run the same command again to send what is still missing`,
    );
  return { status: 'published', ...report, revision: completed.revision };
}

/** Every live row's key, hash and tile. */
async function liveHashes(writer: ConvexWriter) {
  const rows: LiveRowHash[] = [];
  for (let cursor: string | null = null; ;) {
    const result: {
      page: LiveRowHash[];
      isDone: boolean;
      continueCursor: string;
    } = await writer.write({ kind: 'liveHashes', cursor });
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
}

/** The coverage of the last completed publication, from its metadata file. */
async function readCoverage(
  url: string,
  fetcher: typeof fetch,
): Promise<CoverageGeometry> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok)
    throw new Error(
      `Reading the live catalogue's metadata failed: ${response.status}`,
    );
  const { coverage } = (await response.json()) as { coverage: unknown };
  return parseCoverageGeometry(coverage);
}

/**
 * Split the writes into `applyBatch` requests: deletes, then upserts, at most
 * `PLACE_BATCH_LIMIT` a request and well under the bridge's request size;
 * then the coverage tiles, `PLACE_BATCH_LIMIT` a request.
 */
export function applyBatches(
  deletes: readonly string[],
  upserts: readonly PlaceRow[],
  tiles: readonly string[],
  maxBytes = BATCH_BYTES,
): ApplyBatch[] {
  const batches: ApplyBatch[] = [];
  let batch: ApplyBatch = { upserts: [], deletes: [], tiles: [] };
  let bytes = 0;
  const add = (item: { delete: string } | { upsert: PlaceRow }) => {
    const size =
      Buffer.byteLength(
        JSON.stringify('delete' in item ? item.delete : item.upsert),
      ) + 1;
    if (size > maxBytes) throw new Error('A place row exceeds the batch size');
    if (
      batch.upserts.length + batch.deletes.length >= PLACE_BATCH_LIMIT ||
      bytes + size > maxBytes
    ) {
      batches.push(batch);
      batch = { upserts: [], deletes: [], tiles: [] };
      bytes = 0;
    }
    if ('delete' in item) batch.deletes.push(item.delete);
    else batch.upserts.push(item.upsert);
    bytes += size;
  };
  for (const key of deletes) add({ delete: key });
  for (const place of upserts) add({ upsert: place });
  if (bytes) batches.push(batch);
  for (let start = 0; start < tiles.length; start += PLACE_BATCH_LIMIT)
    batches.push({
      upserts: [],
      deletes: [],
      tiles: tiles.slice(start, start + PLACE_BATCH_LIMIT),
    });
  return batches;
}

function beginRefusal(
  snapshotId: string,
  refusal: Extract<Begun, { ok: false }>,
): string {
  switch (refusal.reason) {
    case 'current_changed':
      return `The live catalogue is now ${refusal.current ?? 'none'}: review a new dry run`;
    case 'pending_other':
      return `The publication of ${refusal.pending} is not complete. Finish it by running its publish command again, or abandon it with --replace-pending ${refusal.pending}`;
    case 'already_current':
      return `${snapshotId} is already the live catalogue, yet the live rows differ from it: inspect the live catalogue before publishing`;
  }
}

const notPending = (snapshotId: string) =>
  `The publication of ${snapshotId} is no longer pending: another run replaced or completed it. Review a new dry run`;
