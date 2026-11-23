/**
 * The place rows of a catalogue as both sides of a publication handle them:
 * the app, which publishes them, and the Convex functions, which store them. Plain TypeScript with Web Crypto only, so it runs in the
 * Convex runtime as well as in Node.
 */

/** A matcher candidate (`CandidatePlace` in src/server/places/run-types.ts). */
export type PlaceRow = {
  id: string;
  displayName: string;
  kinds: string[];
  subtypes: string[];
  location: { longitude: number; latitude: number };
  elevationM?: number;
};

export const PLACE_BATCH_LIMIT = 500;

/** The live catalogue as matching versions name it: the one live table,
 * whatever snapshot it holds, so a publication changes no owner's matching
 * version. Only a recipe change does (`matchingVersion`). */
export const LIVE_CATALOGUE = Object.freeze({
  snapshotId: 'places-live',
  revision: 'live-rows-v1',
});

/** The quarter-degree tile a point falls in (see `readMatchingTiles`). */
export function tileOf(location: { longitude: number; latitude: number }) {
  return `${Math.floor((location.longitude + 180) * 4)},${Math.floor(
    (location.latitude + 90) * 4,
  )}`;
}

async function sha256Hex(text: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Identifies one rowset: a catalogue snapshot at one catalogue revision. */
export function datasetFor(snapshotId: string, revision: string) {
  return sha256Hex(`places-v1\n${snapshotId}\n${revision}`);
}

/** A place row's fields in the fixed order both digests are taken over. */
function canonicalRow(place: PlaceRow) {
  return [
    place.id,
    place.displayName,
    place.kinds,
    place.subtypes,
    place.location.longitude,
    place.location.latitude,
    place.elevationM ?? null,
  ];
}

/** The hash of one live catalogue row: SHA-256 of its canonical form. Two
 * rows with the same hash are the same place row. */
export function rowHash(place: PlaceRow) {
  return sha256Hex(JSON.stringify(canonicalRow(place)));
}

/** The digest of the live catalogue: the sum of its row hashes modulo
 * 2^256, as 64 hex digits. It does not depend on the order of the rows, and
 * a write updates it by subtracting the old row hash and adding the new. */
export const EMPTY_SET_DIGEST = '0'.repeat(64);
const SET_DIGEST_MASK = (1n << 256n) - 1n;
function setDigestStep(digest: string, hash: string, sign: 1n | -1n) {
  if (!/^[0-9a-f]{64}$/.test(digest) || !/^[0-9a-f]{64}$/.test(hash))
    throw new Error('Invalid digest');
  return (
    (BigInt(`0x${digest}`) + sign * BigInt(`0x${hash}`)) &
    SET_DIGEST_MASK
  )
    .toString(16)
    .padStart(64, '0');
}
export const addToSetDigest = (digest: string, hash: string) =>
  setDigestStep(digest, hash, 1n);
export const removeFromSetDigest = (digest: string, hash: string) =>
  setDigestStep(digest, hash, -1n);

/** The digest after appending `places` to a rowset whose digest so far is
 * `previous` ('' for an empty one). Both sides compute it for every batch,
 * so a finished import is known to hold the rows that were sent, in order. */
export function chainDigest(previous: string, places: readonly PlaceRow[]) {
  return sha256Hex(`${previous}\n${JSON.stringify(places.map(canonicalRow))}`);
}
