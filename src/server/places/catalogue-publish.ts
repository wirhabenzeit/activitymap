import { createHash } from 'node:crypto';

import type { ConvexWriter } from '~/server/sync/convex-writer';

import {
  type ValidatedCatalogue,
  listedPlaceCount,
  validateCatalogue,
} from './catalogue-artifact';
import { V1_PLACE_REGION } from './catalogue-regions';
import type { PlaceRow } from './catalogue-rows';
import { type CatalogueSource, sendCatalogue } from './convex-catalogue';
import type { NormalizedPlace } from './types';

/**
 * Publishes a catalogue artifact (`pnpm places:prepare`, `places:combine`)
 * to the Convex backend, and has every library matched against it.
 *
 * A place keeps its ID for as long as its OpenStreetMap object exists: the
 * ID is derived from the object's type and number, so two catalogues name
 * the same place the same way without a database that remembers them.
 */

/** How artifact rows become place rows: which rows are sent and how their
 * IDs are derived. Part of a rowset's identity, so a change here publishes
 * the same artifact as a new rowset. */
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

/** An artifact as a source of `sendCatalogue`. */
export function artifactSource(catalogue: ValidatedCatalogue): CatalogueSource {
  const rows = placeRows(catalogue);
  const snapshotId = catalogue.manifest.catalogue_snapshot_id;
  return {
    current: async () => ({
      snapshotId,
      revision: PLACE_ROWS_VERSION,
      count: rows.length,
      metadata: { manifest: catalogue.manifest, coverage: catalogue.coverage },
    }),
    async places(snapshot, after, limit) {
      if (snapshot !== snapshotId)
        throw new Error('Unknown catalogue snapshot');
      // Binary search for the first ID after `after`.
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (rows[middle]!.id <= after) low = middle + 1;
        else high = middle;
      }
      return rows.slice(low, low + limit);
    },
  };
}

type Rowset = { snapshotId: string; revision: string; count: number };

export type CataloguePublishReport = {
  status: 'unchanged' | 'would_publish' | 'published';
  snapshotId: string;
  /** Places sent: the artifact's rows without those the filter hides. */
  count: number;
  hidden: number;
  sourceDataAsOf: string;
  /** What libraries are matched against now; null before the first one. */
  current: Rowset | null;
  /** The share of the current count that the new catalogue lacks. */
  largeRetirement: boolean;
  /** Libraries moved to the catalogue by this run. */
  libraries?: number;
};

/**
 * Publish `catalogue`, or with `apply: false` report what publishing would
 * do. Publishing sends the rowset, then moves every library to it, which
 * hides their old matches and matches every recording again. Safe to repeat:
 * a rowset that is already complete sends nothing, and libraries that are
 * already on it are left alone, so a run that was interrupted is finished by
 * running it again.
 */
export async function publishCatalogue({
  catalogue: input,
  writer,
  upload,
  apply = false,
  expectedCurrent,
  allowLargeRetirement = false,
  regionId = V1_PLACE_REGION,
  progress,
}: {
  catalogue: ValidatedCatalogue;
  writer: ConvexWriter;
  upload: (url: string, file: Uint8Array) => Promise<string>;
  apply?: boolean;
  /** Compare-and-set: the snapshot the dry run reported as current; null
   * when nothing was published yet. Required to apply. */
  expectedCurrent?: string | null;
  allowLargeRetirement?: boolean;
  regionId?: string;
  progress?: (imported: number, count: number) => void;
}): Promise<CataloguePublishReport> {
  const catalogue = validateCatalogue(input);
  if (catalogue.manifest.region_id !== regionId)
    throw new Error(
      `The artifact is for region ${catalogue.manifest.region_id ?? '(none)'}, not ${regionId}`,
    );
  const source = artifactSource(catalogue);
  const next = await source.current();
  const current = await writer.write<Rowset | null>({
    kind: 'latestCatalogue',
  });
  const same =
    current?.snapshotId === next.snapshotId &&
    current.revision === next.revision;
  const report = {
    snapshotId: next.snapshotId,
    count: next.count,
    hidden: catalogue.rows.length - next.count,
    sourceDataAsOf: catalogue.manifest.source.data_as_of,
    current,
    largeRetirement: !!current && next.count < current.count * 0.8,
  };
  if (!apply)
    return { status: same ? 'unchanged' : 'would_publish', ...report };

  if (expectedCurrent === undefined)
    throw new Error('Publication requires expectedCurrent from a dry run');
  if (!same && expectedCurrent !== (current?.snapshotId ?? null))
    throw new Error('Catalogue changed since dry run; review a new dry run');
  if (report.largeRetirement && !allowLargeRetirement)
    throw new Error(
      'The catalogue would lose more than 20% of its places; inspect the artifact and explicitly allow large retirement',
    );
  if (!same) {
    for (;;) {
      const sent = await sendCatalogue({
        source,
        writer,
        upload,
        // One run sends for at most a minute, then reports and continues.
        deadline: Date.now() + 60_000,
      });
      progress?.(sent.imported, sent.count);
      if (sent.complete) break;
    }
    // Libraries move to the newest complete rowset. A rowset that was
    // complete before a newer one cannot become current again.
    const latest = await writer.write<Rowset | null>({
      kind: 'latestCatalogue',
    });
    if (
      latest?.snapshotId !== next.snapshotId ||
      latest.revision !== next.revision
    )
      throw new Error(
        'A catalogue published after this one was first sent is current; this one is not published',
      );
  }
  const adopted = await writer.write<{ libraries: number }>({
    kind: 'adoptCatalogue',
  });
  return {
    status: same && adopted.libraries === 0 ? 'unchanged' : 'published',
    ...report,
    libraries: adopted.libraries,
  };
}
