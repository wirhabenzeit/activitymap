import { type PlaceRow, tileOf } from './catalogue-rows';

/** A live catalogue row as the publisher reads it. */
export type LiveRowHash = { key: string; hash: string; tile: string };

export type CatalogueDiff = {
  inserts: PlaceRow[];
  /** Live places whose row changed; `moved` when it changed tile. */
  updates: { place: PlaceRow; moved: boolean }[];
  /** Keys of live places the artifact lacks. */
  deletes: string[];
  unchanged: number;
  /** The tiles of every changed row: old and new tile of an update. */
  tiles: Set<string>;
};

/**
 * Compare the artifact's rows, each with its `rowHash`, with the live rows by
 * place ID. Applying the inserts, updates and deletes turns the live rows into
 * the artifact's.
 */
export function diffCatalogue(
  rows: readonly { place: PlaceRow; hash: string }[],
  live: readonly LiveRowHash[],
): CatalogueDiff {
  const byKey = new Map(live.map((row) => [row.key, row]));
  if (byKey.size !== live.length)
    throw new Error('The live catalogue lists a place twice');
  const diff: CatalogueDiff = {
    inserts: [],
    updates: [],
    deletes: [],
    unchanged: 0,
    tiles: new Set(),
  };
  for (const { place, hash } of rows) {
    const current = byKey.get(place.id);
    byKey.delete(place.id);
    if (current?.hash === hash) {
      diff.unchanged++;
      continue;
    }
    const tile = tileOf(place.location);
    diff.tiles.add(tile);
    if (!current) diff.inserts.push(place);
    else {
      diff.tiles.add(current.tile);
      diff.updates.push({ place, moved: current.tile !== tile });
    }
  }
  for (const { key, tile } of byKey.values()) {
    diff.deletes.push(key);
    diff.tiles.add(tile);
  }
  return diff;
}
