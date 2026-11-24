import { createHmac, randomBytes } from 'node:crypto';

/**
 * Signed access to the live place catalogue on the Convex backend
 * (`backend/convex/http.ts`). Reads (`/internal/places/v1`: its state, its
 * row hashes and the tiles that hold activities) and writes
 * (`/internal/places/write/v1`) each have their own key, so a job that only
 * reviews or plans a publication never holds the key that can write. Neither
 * key can read or write a library.
 */

type Operation = { kind: string; [field: string]: unknown };

export type CatalogueReader = {
  read<T = unknown>(operation: Operation): Promise<T>;
};

export type CatalogueWriter = {
  write<T = unknown>(operation: Operation): Promise<T>;
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

/** Posts signed operations to one catalogue route; null when no Convex site
 * is configured. */
function catalogueClient(
  {
    path,
    domain,
    keyId,
    signingKey,
    name,
    timeout,
    nonce,
  }: {
    path: string;
    domain: string;
    keyId: string;
    signingKey: string;
    name: string;
    timeout: number;
    nonce: boolean;
  },
  fetcher: typeof fetch,
) {
  const origin = process.env.ACTIVITYMAP_CONVEX_SITE;
  if (!origin) return null;
  const url = new URL(path, origin);
  const version = process.env[keyId] ?? '';
  const secret = process.env[signingKey] ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !/^[0-9a-f]{64}$/.test(secret)
  )
    throw new Error(
      `Invalid Convex ${name} configuration (check ${keyId} and ${signingKey})`,
    );
  return async <T>(operation: Operation) => {
    const body = JSON.stringify(
      nonce
        ? { nonce: randomBytes(18).toString('base64url'), operation }
        : { operation },
    );
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`${domain}\n${version}\n${timestamp}\n${body}`)
      .digest('hex');
    const response = await fetcher(url, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
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
        `Convex ${name} rejected ${operation.kind} (${response.status})`,
      );
    return (await response.json()) as T;
  };
}

/** Null when no Convex site is configured. Uses `ACTIVITYMAP_PLACES_KEY_ID`
 * and `ACTIVITYMAP_PLACES_SIGNING_KEY`. */
export function convexCatalogueReader(
  fetcher: typeof fetch = fetch,
): CatalogueReader | null {
  const read = catalogueClient(
    {
      path: '/internal/places/v1',
      domain: 'activitymap-places-v1',
      keyId: 'ACTIVITYMAP_PLACES_KEY_ID',
      signingKey: 'ACTIVITYMAP_PLACES_SIGNING_KEY',
      name: 'catalogue reader',
      timeout: 60_000,
      nonce: false,
    },
    fetcher,
  );
  return read && { read };
}

/** Null when no Convex site is configured. Uses
 * `ACTIVITYMAP_PLACES_WRITER_KEY_ID` and
 * `ACTIVITYMAP_PLACES_WRITER_SIGNING_KEY`; every request carries a fresh
 * single-use nonce. */
export function convexCatalogueWriter(
  fetcher: typeof fetch = fetch,
): CatalogueWriter | null {
  const write = catalogueClient(
    {
      path: '/internal/places/write/v1',
      domain: 'activitymap-places-write-v1',
      keyId: 'ACTIVITYMAP_PLACES_WRITER_KEY_ID',
      signingKey: 'ACTIVITYMAP_PLACES_WRITER_SIGNING_KEY',
      name: 'catalogue writer',
      // A batch of 500 rows in one call.
      timeout: 120_000,
      nonce: true,
    },
    fetcher,
  );
  return write && { write };
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
