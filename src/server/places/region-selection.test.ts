import assert from 'node:assert/strict';

import test from 'node:test';

import { tileOf } from './catalogue-rows';
import { type GeofabrikExtract, parseGeofabrikIndex } from './geofabrik-index';
import { geofabrikIndexFixture } from './geofabrik-index.fixture';
import {
  DEMAND_MIN_ACTIVITIES,
  type RegionOverrides,
  resolvedRegionsDocument,
  selectRegions,
  servableRegions,
} from './region-selection';

const index = parseGeofabrikIndex(geofabrikIndexFixture());
const tile = (longitude: number, latitude: number) =>
  tileOf({ longitude, latitude });
/** Tiles inside one country, on the alpland–bergland border (10.1° E runs
 * through the tile from 10° to 10.25°), in ringland's hole, touching
 * alpland's western edge from outside, and in each half of bigland. */
const TILES = {
  alpland: tile(8.1, 46.1),
  border: tile(10.1, 47.1),
  hole: tile(22.1, 52.1),
  edge: tile(6.9, 46.1),
  bigWest: tile(-115.1, 40.1),
  bigEast: tile(-105.1, 40.1),
};
const none: RegionOverrides = { include: [], exclude: [] };

function run(
  options: {
    live?: string[];
    demand?: Record<string, number> | null;
    overrides?: RegionOverrides;
    sizes?: Record<string, number>;
  } = {},
) {
  const asked: string[] = [];
  return {
    asked,
    result: selectRegions({
      index,
      live: options.live ?? ['alpland'],
      demand:
        options.demand === null
          ? null
          : new Map(Object.entries(options.demand ?? {})),
      overrides: options.overrides ?? none,
      sizes: (extract: GeofabrikExtract) => {
        asked.push(extract.region);
        return Promise.resolve(
          options.sizes?.[extract.region] ?? 1_000_000_000,
        );
      },
    }),
  };
}
const regions = async (selection: ReturnType<typeof run>) =>
  (await selection.result).regions.map(
    ({ region, reason }) => `${region}:${reason}`,
  );

void test('a demanded tile pulls in every country it intersects, border tiles both', async () => {
  const many = DEMAND_MIN_ACTIVITIES;
  assert.deepEqual(
    await regions(
      run({ live: ['ringland'], demand: { [TILES.alpland]: many } }),
    ),
    ['alpland:demand', 'ringland:live'],
  );
  assert.deepEqual(
    await regions(
      run({ live: ['ringland'], demand: { [TILES.border]: many } }),
    ),
    ['alpland:demand', 'bergland:demand', 'ringland:live'],
  );
  // A tile in a hole, or one that only touches a boundary, is outside.
  assert.deepEqual(
    await regions(
      run({
        live: ['bigland-east'],
        demand: { [TILES.hole]: many, [TILES.edge]: many },
      }),
    ),
    ['bigland-east:live'],
  );
});

void test('a tile needs at least two activities to demand a region', async () => {
  assert.equal(DEMAND_MIN_ACTIVITIES, 2);
  assert.deepEqual(await regions(run({ demand: { [TILES.border]: 1 } })), [
    'alpland:live',
  ]);
  assert.deepEqual(await regions(run({ demand: { [TILES.border]: 2 } })), [
    'alpland:live',
    'bergland:demand',
  ]);
});

void test('a country above the size cap is taken as its demanded parts', async () => {
  const big = run({
    demand: { [TILES.bigWest]: 3, [TILES.border]: 2 },
    sizes: { bigland: 7_000_000_000, bergland: 900_000_000 },
  });
  assert.deepEqual(await regions(big), [
    'alpland:live',
    'bergland:demand',
    'bigland-west:demand',
  ]);
  // Only newly demanded countries are measured, never a held one.
  assert.deepEqual(big.asked.sort(), ['bergland', 'bigland']);

  const small = run({
    demand: { [TILES.bigWest]: 3 },
    sizes: { bigland: 5_000_000_000 },
  });
  assert.deepEqual(await regions(small), ['alpland:live', 'bigland:demand']);
});

void test('a country held whole stays whole, one held in parts grows by parts', async () => {
  const whole = run({
    live: ['bigland'],
    demand: { [TILES.bigWest]: 2, [TILES.bigEast]: 2 },
    sizes: { bigland: 99_000_000_000 },
  });
  assert.deepEqual(await regions(whole), ['bigland:live']);
  assert.deepEqual(whole.asked, []);

  const parts = run({
    live: ['alpland', 'bigland-east'],
    demand: { [TILES.bigWest]: 2 },
    sizes: { bigland: 1 },
  });
  assert.deepEqual(await regions(parts), [
    'alpland:live',
    'bigland-east:live',
    'bigland-west:demand',
  ]);
  assert.deepEqual(parts.asked, []);

  // A live region stays without any demand.
  assert.deepEqual(
    await regions(run({ live: ['alpland', 'bergland'], demand: null })),
    ['alpland:live', 'bergland:live'],
  );
});

void test('overrides include and exclude regions, exclude winning', async () => {
  const selection = await run({
    live: ['alpland', 'bergland'],
    demand: { [TILES.bigWest]: 5, [TILES.hole]: 5 },
    overrides: {
      include: ['ringland', 'bergland', 'alpland-nord'],
      exclude: ['bergland', 'bigland'],
    },
  }).result;
  assert.deepEqual(
    selection.regions.map(({ region, reason }) => `${region}:${reason}`),
    ['alpland:live', 'alpland-nord:include', 'ringland:include'],
  );
  assert.deepEqual(selection.added, ['alpland-nord', 'ringland']);
  assert.deepEqual(selection.counts, {
    live: 1,
    demanded: 0,
    included: 2,
    excluded: 2,
  });

  await assert.rejects(
    run({ overrides: { include: ['atlantis'], exclude: [] } }).result,
    /Unknown region in the include overrides: atlantis/,
  );
  await assert.rejects(
    run({ overrides: { include: [], exclude: ['atlantis'] } }).result,
    /Unknown region in the exclude overrides: atlantis/,
  );
  await assert.rejects(
    run({ overrides: { include: ['alps'], exclude: [] } }).result,
    /Only a country or a part of one can be included: alps/,
  );
});

void test('a live region the index no longer lists fails unless excluded', async () => {
  await assert.rejects(
    run({ live: ['alpland', 'atlantis'] }).result,
    /Live catalogue region atlantis is not in the Geofabrik index/,
  );
  const removed = await run({
    live: ['alpland', 'atlantis'],
    overrides: { include: [], exclude: ['atlantis'] },
  }).result;
  assert.deepEqual(
    removed.regions.map(({ region }) => region),
    ['alpland'],
  );
  assert.equal(removed.counts.excluded, 1);
});

void test('a demanded region the catalogue cannot take is skipped, live ones never', async () => {
  const demand = { [TILES.border]: 2, [TILES.bigWest]: 2 };
  const selection = await run({ live: ['alpland'], demand }).result;
  assert.deepEqual(
    selection.regions.map(({ region }) => region),
    ['alpland', 'bergland', 'bigland'],
  );
  assert.deepEqual(servableRegions(selection).skipped, []);

  // No room for more regions than the live one and one more.
  const limited = servableRegions(selection, { regions: 2 });
  assert.deepEqual(
    limited.regions.map(({ region }) => region),
    ['alpland', 'bergland'],
  );
  assert.deepEqual(limited.skipped, [{ region: 'bigland', reason: 'limit' }]);
  assert.deepEqual(limited.added, ['bergland']);
  assert.equal(limited.counts.demanded, 1);

  // No room for more boundary than the live region's own.
  const tight = servableRegions(selection, { vertices: 1 });
  assert.deepEqual(
    tight.regions.map(({ region }) => region),
    ['alpland'],
  );
  assert.deepEqual(tight.skipped, [
    { region: 'bergland', reason: 'coverage' },
    { region: 'bigland', reason: 'coverage' },
  ]);
});

void test('the resolve document lists dated URLs and names no tile', async () => {
  const demand = Object.fromEntries(
    Object.values(TILES).map((tile) => [tile, 9]),
  );
  const selection = await run({ live: ['bergland', 'alpland'], demand }).result;
  const document = resolvedRegionsDocument(
    servableRegions(selection),
    '261122',
  );
  assert.deepEqual(document.regions[0], {
    region: 'alpland',
    pbf: 'https://download.geofabrik.de/europe/alpland/alpland-261122.osm.pbf',
    poly: 'https://download.geofabrik.de/europe/alpland/alpland.poly',
    reason: 'live',
  });
  assert.deepEqual(
    document.regions.map(({ region }) => region),
    ['alpland', 'bergland', 'bigland'],
  );
  const texts = [JSON.stringify(document)];
  for (const failing of [
    run({ live: ['atlantis'], demand }),
    run({ demand, overrides: { include: ['atlantis'], exclude: [] } }),
    run({ demand: { ...demand, '99999,1': 2 } }),
    run({ demand: { ...demand, [`${TILES.alpland} `]: 2 } }),
  ])
    texts.push(
      await failing.result.then(
        () => assert.fail('expected a failure'),
        (error: Error) => error.message,
      ),
    );
  for (const text of texts)
    for (const tile of [...Object.values(TILES), '99999,1'])
      assert.ok(!text.includes(tile), 'a tile appears in the output');
});
