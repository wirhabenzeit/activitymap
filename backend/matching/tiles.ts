import type { PlaceQueryWindow } from '../../src/server/places/query-windows';

type Candidate = {
  key: string;
  longitude: number;
  latitude: number;
  metadata?: unknown;
};
type TilePage = { page: Candidate[]; isDone: boolean; continueCursor: string };

export async function readMatchingTiles(
  windows: readonly PlaceQueryWindow[],
  readPage: (tile: string, cursor: string | null) => Promise<TilePage>,
  parallelism: 1 | 4,
) {
  const started = Date.now();
  const tiles = new Set<string>();
  if (windows.length > 2000) throw new Error('Window budget exceeded');
  for (const box of windows) {
    if (
      ![box.west, box.south, box.east, box.north].every(Number.isFinite) ||
      box.west > box.east ||
      box.south > box.north ||
      box.west < -180 ||
      box.east > 180 ||
      box.south < -90 ||
      box.north > 90
    )
      throw new Error('Invalid bounds');
    for (
      let x = Math.floor((box.west + 180) * 4);
      x <= Math.floor((box.east + 180) * 4);
      x++
    ) {
      for (
        let y = Math.floor((box.south + 90) * 4);
        y <= Math.floor((box.north + 90) * 4);
        y++
      ) {
        tiles.add(`${x},${y}`);
        if (tiles.size > 256)
          throw new Error('Tile budget exceeded: result incomplete');
      }
    }
  }
  const found = new Map<string, unknown>();
  let pages = 0;
  let scanned = 0;
  const scanTile = async (tile: string) => {
    let cursor: string | null = null;
    const seen = new Set<string>();
    while (true) {
      if (++pages > 1000)
        throw new Error('Page budget exceeded: result incomplete');
      const page = await readPage(tile, cursor);
      scanned += page.page.length;
      for (const p of page.page) {
        if (
          windows.some(
            (b) =>
              p.longitude >= b.west &&
              p.longitude <= b.east &&
              p.latitude >= b.south &&
              p.latitude <= b.north,
          )
        )
          found.set(p.key, p.metadata ?? p);
      }
      if (found.size > 5000)
        throw new Error('Result budget exceeded: result incomplete');
      if (page.isDone) return;
      if (seen.has(page.continueCursor) || !page.page.length)
        throw new Error('Non-advancing cursor');
      seen.add(page.continueCursor);
      cursor = page.continueCursor;
    }
  };
  const keys = [...tiles];
  for (let start = 0; start < keys.length; start += parallelism)
    await Promise.all(keys.slice(start, start + parallelism).map(scanTile));
  return {
    places: [...found.values()],
    pages,
    scanned,
    tiles: tiles.size,
    elapsedMs: Date.now() - started,
  };
}
