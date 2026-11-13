/**
 * The place rows of a catalogue as both sides of the catalogue import handle
 * them: the app, which publishes them, and the Convex functions,
 * which store them. Plain TypeScript with Web Crypto only, so it runs in the
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

/** The digest after appending `places` to a rowset whose digest so far is
 * `previous` ('' for an empty one). Both sides compute it for every batch,
 * so a finished import is known to hold the rows that were sent, in order. */
export function chainDigest(previous: string, places: readonly PlaceRow[]) {
  return sha256Hex(
    `${previous}\n${JSON.stringify(
      places.map((place) => [
        place.id,
        place.displayName,
        place.kinds,
        place.subtypes,
        place.location.longitude,
        place.location.latitude,
        place.elevationM ?? null,
      ]),
    )}`,
  );
}
