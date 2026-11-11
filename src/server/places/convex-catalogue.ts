import {
  PLACE_BATCH_LIMIT,
  type PlaceRow,
  chainDigest,
  datasetFor,
} from '~/server/places/catalogue-rows';
import type { ConvexWriter } from '~/server/sync/convex-writer';

/**
 * Sends a place catalogue to the Convex backend (`backend/convex/places.ts`),
 * where activities are matched against it.
 *
 * A rowset is one catalogue snapshot at one revision. It is sent once, in
 * place-ID order, in batches; a run that stops (deadline, error) continues
 * from the last imported ID next time. Both sides keep a digest over the
 * rows, and Convex accepts the rowset only when count and digest agree. If
 * the source changes while it is being sent, the rowset is abandoned and the
 * next run starts the new one.
 */

export type CatalogueSource = {
  /** The catalogue to send. `count` is the number of rows `places` will
   * return in total. */
  current(): Promise<{
    snapshotId: string;
    revision: string;
    count: number;
    /** The catalogue manifest and coverage, as the matcher needs them. */
    metadata: unknown;
  }>;
  /** Up to `limit` places of `snapshotId` with an ID after `after` ('' for
   * the start), in ascending ID order. */
  places(snapshotId: string, after: string, limit: number): Promise<PlaceRow[]>;
};

type Progress = {
  snapshotId: string;
  revision: string;
  count: number;
  imported: number;
  after: string;
  digest: string;
  complete: boolean;
};

export type CatalogueSendResult = {
  dataset: string;
  count: number;
  imported: number;
  /** Rows sent in this run. */
  sent: number;
  complete: boolean;
  /** Why an incomplete run stopped. */
  stopped?: 'deadline' | 'catalogue changed';
};

export async function sendCatalogue({
  source,
  writer,
  upload,
  deadline = Infinity,
  now = Date.now,
  batchSize = PLACE_BATCH_LIMIT,
}: {
  source: CatalogueSource;
  writer: ConvexWriter;
  /** POST a file to a Convex upload URL; returns its storage ID. */
  upload: (url: string, file: Uint8Array) => Promise<string>;
  deadline?: number;
  now?: () => number;
  batchSize?: number;
}): Promise<CatalogueSendResult> {
  const catalogue = await source.current();
  const dataset = await datasetFor(catalogue.snapshotId, catalogue.revision);
  let progress = await writer.write<Progress | null>({
    kind: 'catalogueState',
    dataset,
  });
  const result = (extra: Partial<CatalogueSendResult> = {}) => ({
    dataset,
    count: catalogue.count,
    imported: progress?.imported ?? 0,
    sent,
    complete: progress?.complete ?? false,
    ...extra,
  });
  let sent = 0;
  if (progress?.complete) return result();
  if (!progress) {
    // Upload URLs are issued under an owner's current assignment.
    const owner = await writer.write<{ epoch: string } | null>({
      kind: 'state',
    });
    if (!owner) throw new Error('The signing owner is not provisioned');
    const [url] = await writer.write<string[]>(
      { kind: 'uploadUrls', count: 1 },
      owner.epoch,
    );
    const metadata = await upload(
      url!,
      new TextEncoder().encode(JSON.stringify(catalogue.metadata)),
    );
    progress = await writer.write<Progress>({
      kind: 'beginCatalogue',
      dataset,
      snapshotId: catalogue.snapshotId,
      revision: catalogue.revision,
      count: catalogue.count,
      metadata,
    });
  }
  while (progress.imported < progress.count) {
    if (now() > deadline) return result({ stopped: 'deadline' });
    const places = await source.places(
      catalogue.snapshotId,
      progress.after,
      batchSize,
    );
    if (places.length === 0) break;
    const expected = await chainDigest(progress.digest, places);
    const after: string = progress.after;
    progress = await writer.write<Progress>({
      kind: 'importPlaces',
      dataset,
      after,
      places,
    });
    // Another sender may have moved the position; then this batch was not
    // applied and the next read continues from where Convex is.
    if (progress.after === places.at(-1)!.id) {
      if (progress.digest !== expected)
        throw new Error('Catalogue rows differ after import');
      sent += places.length;
    } else if (progress.after === after)
      throw new Error('Catalogue import made no progress');
  }
  // Rows read in several steps are one rowset only if the source did not
  // change meanwhile.
  const latest = await source.current();
  if (
    latest.snapshotId !== catalogue.snapshotId ||
    latest.revision !== catalogue.revision
  )
    return result({ stopped: 'catalogue changed' });
  if (progress.imported !== progress.count)
    throw new Error(
      `Catalogue holds ${progress.imported} of ${progress.count} rows`,
    );
  progress = await writer.write<Progress>({
    kind: 'completeCatalogue',
    dataset,
    digest: progress.digest,
  });
  return result();
}

/** POST a file to a Convex upload URL; returns its storage ID. Retries a
 * failed upload a few times. */
export async function uploadFile(
  url: string,
  file: Uint8Array,
  contentType = 'application/json',
) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(file),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      return ((await response.json()) as { storageId: string }).storageId;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}
