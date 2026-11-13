// Copy to the root of the pinned upstream checkout; see README.md.
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';

import { api } from './src/component/_generated/api.js';
import { S2Bindings } from './src/component/lib/s2Bindings.js';
import schema from './src/component/schema.js';

const modules = import.meta.glob('./src/component/**/*.{ts,js}');

const opts = { minLevel: 4, maxLevel: 16, levelMod: 2, maxCells: 8 };
const world = { west: -180, east: 180, south: -90, north: 90 };

test('measure covering fanout, including the issue 57 world rectangle', async () => {
  const s2 = await S2Bindings.load();
  for (const [name, box] of Object.entries({
    world,
    northwest: { west: -180, east: 0, south: 0, north: 90 },
    alps: { west: 5, east: 17, south: 44, north: 49 },
    route: { west: 8, east: 8.1, south: 46, north: 46.1 },
  })) {
    const cells = s2.coverRectangle(box, 4, 16, 2, 8);
    console.log(JSON.stringify({ name, cells: cells.length }));
    expect(cells.length).toBeGreaterThan(0);
  }
});

test('characterize pagination and rectangle semantics (not a parity certificate)', async () => {
  const t = convexTest(schema, modules);
  const points = Array.from({ length: 300 }, (_, i) => ({
    latitude: 46 + (i % 20) * 0.0001,
    longitude: 8 + Math.floor(i / 20) * 0.0001,
  })).concat([
    { latitude: 46, longitude: 180 },
    { latitude: 46, longitude: -180 },
    { latitude: 89.999, longitude: 0 },
  ]);
  for (const [i, coordinates] of points.entries())
    await t.mutation(api.document.insert, {
      ...opts,
      document: {
        key: String(i),
        coordinates,
        sortKey: 1,
        filterKeys: { snapshot: 'fixture' },
      },
    });
  for (const rectangle of [
    { west: 7.99, east: 8.01, south: 45.99, north: 46.01 },
    { west: 179.99, east: 180, south: 45, north: 47 },
    { west: -180, east: -179.99, south: 45, north: 47 },
    { west: -180, east: 180, south: 89.99, north: 90 },
  ]) {
    const s2 = await S2Bindings.load();
    const expected = points.flatMap((p, i) =>
      s2.rectangleContains(rectangle, p) ? [String(i)] : [],
    );
    const found = [];
    let cursor;
    let pages = 0;
    do {
      const result = await t.query(api.query.execute, {
        ...opts,
        logLevel: 'ERROR',
        cursor,
        query: {
          rectangle,
          filtering: [
            { occur: 'must', filterKey: 'snapshot', filterValue: 'fixture' },
          ],
          sorting: { interval: {} },
          maxResults: 17,
        },
      });
      found.push(...result.results.map((p) => p.key));
      expect(
        result.nextCursor === undefined || result.nextCursor !== cursor,
      ).toBe(true);
      cursor = result.nextCursor;
      expect(++pages).toBeLessThan(100);
    } while (cursor !== undefined);
    expect(found.length).toBe(new Set(found).size);
    expect(found.sort()).toEqual(expected.sort());
    console.log(JSON.stringify({ rectangle, points: found.length, pages }));
  }
}, 60000);

test('characterize full-longitude and wide-rectangle false negatives', async () => {
  const s2 = await S2Bindings.load();
  for (const [rectangle, point] of [
    [world, { latitude: 46, longitude: 8 }],
    [
      { west: -180, east: 180, south: 89.99, north: 90 },
      { latitude: 89.999, longitude: 0 },
    ],
    [
      { west: -170, east: 170, south: -10, north: 10 },
      { latitude: 0, longitude: 0 },
    ],
  ]) {
    const cartesianContains =
      point.longitude >= rectangle.west &&
      point.longitude <= rectangle.east &&
      point.latitude >= rectangle.south &&
      point.latitude <= rectangle.north;
    expect(cartesianContains).toBe(true);
    expect(Boolean(s2.rectangleContains(rectangle, point))).toBe(false);
    console.log(
      JSON.stringify({ rectangle, point, expected: true, actual: false }),
    );
  }
});

test('a one-result page can scan more than the internal 1024-row target', async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 1100; i++)
    await t.mutation(api.document.insert, {
      ...opts,
      document: {
        key: String(i),
        coordinates: { latitude: 46, longitude: 8.000001 },
        sortKey: i,
        filterKeys: {},
      },
    });
  const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  let result, stats;
  try {
    result = await t.query(api.query.execute, {
      ...opts,
      logLevel: 'INFO',
      query: {
        rectangle: {
          west: 7.99999999,
          east: 8.00000001,
          south: 45.99999999,
          north: 46.00000001,
        },
        filtering: [],
        sorting: { interval: {} },
        maxResults: 1,
      },
    });
    const message = logs.mock.calls
      .flat()
      .find((x) => typeof x === 'string' && x.startsWith('Found '));
    stats = JSON.parse(
      message.slice(message.indexOf('{'), message.lastIndexOf('}') + 1),
    );
  } finally {
    logs.mockRestore();
  }
  console.log(
    JSON.stringify({
      sparseRectangle: stats,
      results: result.results.length,
      nextCursor: result.nextCursor ?? null,
    }),
  );
  expect(result.results).toEqual([]);
  expect(stats.rowsPostFiltered).toBe(1100);
  expect(stats.rowsRead).toBeGreaterThan(1024);
}, 60000);
