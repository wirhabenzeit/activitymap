import { type GeoTIFFImage, fromUrl } from 'geotiff';

import {
  COPERNICUS_GLO30_URL,
  type DemGrid,
  type DemSource,
  metresPerDegree,
} from './terrain';

const ARCSEC = 1 / 3600;
const TILE_ROWS = 3600;

/** GLO-30 longitude spacing grows towards the poles (product handbook, 2.2). */
export function longitudeSpacing(latitude: number): number {
  const band = Math.abs(latitude);
  const factor =
    band < 50
      ? 1
      : band < 60
        ? 1.5
        : band < 70
          ? 2
          : band < 80
            ? 3
            : band < 85
              ? 5
              : 10;
  return factor * ARCSEC;
}

export type TileCell = {
  name: string;
  /** South-west corner in whole degrees. */
  south: number;
  west: number;
  row: number;
  col: number;
  width: number;
};

/**
 * Nearest GLO-30 pixel for a coordinate. Pixels are points: in tile N47 E008,
 * pixel (0, 0) is centred on 48° N 8° E and the last row ends one arc-second
 * north of 47° N, which is the first row of N46.
 */
export function tileCell(lon: number, lat: number): TileCell {
  const globalRow = Math.round((90 - lat) / ARCSEC);
  const north = 90 - Math.floor(globalRow / TILE_ROWS);
  const row = globalRow - (90 - north) * TILE_ROWS;
  const south = north - 1;
  // The band, and hence the spacing, belongs to the tile, not the coordinate.
  const spacing = longitudeSpacing(south < 0 ? north : south);
  const width = Math.round(1 / spacing);
  const globalCol = Math.round((lon + 180) / spacing);
  const westIndex = Math.floor(globalCol / width);
  const west = -180 + westIndex;
  const col = globalCol - westIndex * width;
  return { name: tileName(south, west), south, west, row, col, width };
}

export function tileName(south: number, west: number): string {
  const lat = `${south < 0 ? 'S' : 'N'}${String(Math.abs(south)).padStart(2, '0')}`;
  const lon = `${west < 0 ? 'W' : 'E'}${String(Math.abs(west)).padStart(3, '0')}`;
  return `Copernicus_DSM_COG_10_${lat}_00_${lon}_00_DEM`;
}

type Tile = {
  image: GeoTIFFImage;
  blockWidth: number;
  blockHeight: number;
} | null;

/**
 * Copernicus GLO-30 over HTTP range reads: only the internal 1024² blocks a
 * window needs are fetched and decoded, and kept in a bounded LRU. Missing
 * tiles (HTTP 404) are sea and read as NaN. Every other failure throws, so a
 * network problem cannot silently become "no terrain".
 */
export class CopernicusDem implements DemSource {
  private tiles = new Map<string, Promise<Tile>>();
  private blocks = new Map<string, Promise<Float32Array>>();
  readonly stats = { tiles: 0, seaTiles: 0, blocks: 0, retries: 0 };

  constructor(
    private readonly options: {
      baseUrl?: string;
      maxBlocks?: number;
      fetch?: typeof fetch;
    } = {},
  ) {}

  private url(name: string) {
    return `${this.options.baseUrl ?? COPERNICUS_GLO30_URL}${name}/${name}.tif`;
  }

  private tile(cell: TileCell): Promise<Tile> {
    const { name, south } = cell;
    let tile = this.tiles.get(name);
    if (!tile) {
      tile = (async () => {
        const url = this.url(name);
        const status = await this.retry(async () => {
          const response = await (this.options.fetch ?? fetch)(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(60_000),
          });
          if (response.status !== 404 && !response.ok)
            throw new Error(`DEM tile ${name} failed: HTTP ${response.status}`);
          return response.status;
        });
        if (status === 404) {
          this.stats.seaTiles++;
          return null;
        }
        // geotiff loads block offsets lazily and caches a failed load, so
        // every later read of that block fails again. Load the offset tables
        // up front, on a fresh source per attempt.
        const image = await this.retry(async () => {
          const image = await (await fromUrl(url)).getImage();
          await image.fileDirectory.loadValue('TileOffsets');
          await image.fileDirectory.loadValue('TileByteCounts');
          return image;
        });
        const [originLon, originLat] = image.getOrigin();
        if (
          image.getHeight() !== TILE_ROWS ||
          image.getWidth() !== cell.width ||
          image.getGeoKeys()?.GTRasterTypeGeoKey !== 2 ||
          Math.abs(originLat! - (south + 1)) > 1e-9 ||
          Math.abs(originLon! - cell.west) > 1e-9
        )
          throw new Error(`DEM tile ${name} has an unexpected grid`);
        this.stats.tiles++;
        return {
          image,
          blockWidth: image.getTileWidth(),
          blockHeight: image.getTileHeight(),
        };
      })();
      this.tiles.set(name, tile);
      // Do not cache a failure; the error still reaches this caller.
      tile.catch(() => forget(this.tiles, name));
    }
    return tile;
  }

  private block(name: string, tile: NonNullable<Tile>, bx: number, by: number) {
    const key = `${name}:${bx}:${by}`;
    let block = this.blocks.get(key);
    if (block) {
      forget(this.blocks, key);
      this.blocks.set(key, block); // LRU: most recently used last
      return block;
    }
    const x0 = bx * tile.blockWidth,
      y0 = by * tile.blockHeight;
    const x1 = Math.min(tile.image.getWidth(), x0 + tile.blockWidth),
      y1 = Math.min(tile.image.getHeight(), y0 + tile.blockHeight);
    block = this.retry(async () => {
      // A stalled response body is aborted and retried.
      const raster = await tile.image.readRasters({
        window: [x0, y0, x1, y1],
        samples: [0],
        interleave: true,
        signal: AbortSignal.timeout(60_000),
      });
      if (!(raster instanceof Float32Array))
        throw new Error(`DEM tile ${name} is not Float32`);
      return raster;
    });
    this.blocks.set(key, block);
    this.stats.blocks++;
    block.catch(() => forget(this.blocks, key));
    const limit = this.options.maxBlocks ?? 96;
    while (this.blocks.size > limit)
      forget(this.blocks, this.blocks.keys().next().value!);
    return block;
  }

  /** A grid in the spacing of the centre tile. Cells in other tiles, including
   * a coarser band across 50° N, take their nearest pixel. */
  async window(lon: number, lat: number, radiusM: number): Promise<DemGrid> {
    const scale = metresPerDegree(lat);
    const dy = ARCSEC,
      dx = 1 / tileCell(lon, lat).width;
    const halfX = Math.ceil(radiusM / scale.x / dx) + 1,
      halfY = Math.ceil(radiusM / scale.y / dy) + 1;
    const west = Math.round(lon / dx) * dx - halfX * dx,
      north = Math.round(lat / dy) * dy + halfY * dy;
    const width = 2 * halfX + 1,
      height = 2 * halfY + 1;

    // A pixel's tile row depends only on latitude and its column only on
    // longitude within a spacing band, so map rows and columns separately.
    const rows = Array.from({ length: height }, (_, y) =>
      tileCell(west, north - y * dy),
    );
    const columns = new Map<number, TileCell[]>();
    for (const row of rows)
      if (!columns.has(row.width))
        columns.set(
          row.width,
          Array.from({ length: width }, (_, x) =>
            tileCell(west + x * dx, row.south + 0.5),
          ),
        );
    const tileKey = (south: number, tileWest: number) =>
      (south + 90) * 1_000 + tileWest + 180;
    const tileCells = new Map<number, TileCell>();
    for (const row of rows)
      for (const column of columns.get(row.width)!)
        tileCells.set(tileKey(row.south, column.west), {
          ...column,
          name: tileName(row.south, column.west),
          south: row.south,
          row: row.row,
        });
    const tiles = new Map(
      await Promise.all(
        [...tileCells].map(
          async ([key, cell]) => [key, await this.tile(cell)] as const,
        ),
      ),
    );

    // Load each needed block once, then copy pixels.
    const blockKey = (key: number, bx: number, by: number) =>
      key * 10_000 + by * 100 + bx;
    const needed = new Map<number, Promise<Float32Array>>();
    for (const row of rows)
      for (const column of columns.get(row.width)!) {
        const key = tileKey(row.south, column.west);
        const tile = tiles.get(key);
        if (!tile) continue;
        const bx = Math.floor(column.col / tile.blockWidth),
          by = Math.floor(row.row / tile.blockHeight);
        const block = blockKey(key, bx, by);
        if (!needed.has(block))
          needed.set(block, this.block(tileCells.get(key)!.name, tile, bx, by));
      }
    const blocks = new Map(
      await Promise.all(
        [...needed].map(async ([key, block]) => [key, await block] as const),
      ),
    );
    const values = new Float32Array(width * height);
    rows.forEach((row, y) => {
      columns.get(row.width)!.forEach((column, x) => {
        const key = tileKey(row.south, column.west);
        const tile = tiles.get(key);
        if (!tile) {
          values[y * width + x] = Number.NaN;
          return;
        }
        const bx = Math.floor(column.col / tile.blockWidth),
          by = Math.floor(row.row / tile.blockHeight);
        const blockWidth =
          Math.min(tile.image.getWidth(), (bx + 1) * tile.blockWidth) -
          bx * tile.blockWidth;
        const value = blocks.get(blockKey(key, bx, by))![
          (row.row - by * tile.blockHeight) * blockWidth +
            column.col -
            bx * tile.blockWidth
        ]!;
        // GLO-30 has no nodata value; guard against voids encoded as -32767.
        values[y * width + x] = value < -1000 ? Number.NaN : value;
      });
    });
    return { west, north, dx, dy, width, height, values };
  }

  /** S3 occasionally stalls or drops parallel range reads. Retry for about a
   * minute, then fail the preparation. */
  private async retry<T>(
    operation: () => Promise<T>,
    attempts = 6,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= attempts) throw error;
        this.stats.retries++;
        await new Promise((resolve) =>
          setTimeout(resolve, 1_000 * 2 ** attempt),
        );
      }
    }
  }
}

function forget<K, V>(map: Map<K, V>, key: K) {
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
  map.delete(key);
}
