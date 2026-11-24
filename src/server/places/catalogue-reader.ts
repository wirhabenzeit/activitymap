import { createHmac } from 'node:crypto';

/**
 * Read-only access to the live place catalogue on the Convex backend
 * (`/internal/places/v1` in `backend/convex/http.ts`): its state, its row
 * hashes and the tiles that hold activities. Signed with the read bridge's
 * key under a domain of its own, so a job that only reviews or plans a
 * publication never holds the key that can write.
 */

export type CatalogueReader = {
  read<T = unknown>(operation: {
    kind: string;
    [field: string]: unknown;
  }): Promise<T>;
};

/** The live catalogue's state (`livePlaces.state`), null before anything was
 * applied. `metadataUrl` is the manifest and coverage of the last completed
 * publication. */
export type LiveState = {
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

export type LiveRowHash = { key: string; hash: string; tile: string };

/** Null when no Convex site is configured. Uses
 * `ACTIVITYMAP_CONVEX_KEY_ID` and `ACTIVITYMAP_CONVEX_SIGNING_KEY`, the read
 * bridge's key. */
export function convexCatalogueReader(
  fetcher: typeof fetch = fetch,
): CatalogueReader | null {
  const origin = process.env.ACTIVITYMAP_CONVEX_SITE;
  if (!origin) return null;
  const url = new URL('/internal/places/v1', origin);
  const version = process.env.ACTIVITYMAP_CONVEX_KEY_ID ?? '';
  const secret = process.env.ACTIVITYMAP_CONVEX_SIGNING_KEY ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !/^[0-9a-f]{64}$/.test(secret)
  )
    throw new Error('Invalid Convex catalogue reader configuration');
  return {
    async read<T>(operation: { kind: string; [field: string]: unknown }) {
      const body = JSON.stringify({ operation });
      const timestamp = String(Date.now());
      const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
        .update(`activitymap-places-v1\n${version}\n${timestamp}\n${body}`)
        .digest('hex');
      const response = await fetcher(url, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
        headers: {
          'Content-Type': 'application/json',
          'X-ActivityMap-Key-Id': version,
          'X-ActivityMap-Timestamp': timestamp,
          'X-ActivityMap-Signature': signature,
        },
        body,
      });
      if (!response.ok)
        throw new Error(
          `Convex catalogue reader rejected ${operation.kind} (${response.status})`,
        );
      return (await response.json()) as T;
    },
  };
}

type Page<Row> = { page: Row[]; isDone: boolean; continueCursor: string };

async function readPages<Row>(reader: CatalogueReader, kind: string) {
  const rows: Row[] = [];
  for (let cursor: string | null = null; ;) {
    const result: Page<Row> = await reader.read({ kind, cursor });
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
}

export const readLiveState = (reader: CatalogueReader) =>
  reader.read<LiveState>({ kind: 'liveState' });

/** Every live row's key, hash and tile. */
export const readLiveHashes = (reader: CatalogueReader) =>
  readPages<LiveRowHash>(reader, 'liveHashes');

/** The manifest and coverage of the last completed publication, unparsed;
 * null before the first. */
export async function readLiveMetadata(
  state: LiveState,
  fetcher: typeof fetch = fetch,
): Promise<{ manifest: unknown; coverage: unknown } | null> {
  if (!state?.metadataUrl) return null;
  const response = await fetcher(state.metadataUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(
      `Reading the live catalogue's metadata failed: ${response.status}`,
    );
  return (await response.json()) as { manifest: unknown; coverage: unknown };
}

/**
 * The quarter-degree tiles ("x,y", as `tileOf` names them) that hold
 * activities, each with the number of activities whose match read it. No
 * owner or activity is named. Tiles locate users' activities: they stay in
 * the process and are never logged.
 */
export async function readDemandTiles(reader: CatalogueReader) {
  const demand = new Map<string, number>();
  // A tile may continue on the next page.
  for (const { tile, activities } of await readPages<{
    tile: string;
    activities: number;
  }>(reader, 'demandTiles'))
    demand.set(tile, (demand.get(tile) ?? 0) + activities);
  return demand;
}
