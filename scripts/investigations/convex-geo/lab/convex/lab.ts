import { GeospatialIndex } from '@convex-dev/geospatial';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { readTiledWindows } from './matching/tiles';

const geo = new GeospatialIndex(components.geospatial, { logLevel: 'INFO' });
const rectangle = v.object({
  west: v.number(),
  south: v.number(),
  east: v.number(),
  north: v.number(),
});
const tile = (lon: number, lat: number) =>
  `${Math.floor((lon + 180) * 4)},${Math.floor((lat + 90) * 4)}`;

// All entrypoints are internal: accessible through authenticated CLI/dashboard only.
export const seedChunk = internalMutation({
  args: {
    dataset: v.union(v.literal('dense'), v.literal('sparse')),
    start: v.number(),
    count: v.number(),
  },
  handler: async (ctx, { dataset, start, count }) => {
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 50
    )
      throw new Error('Invalid seed chunk');
    const total = dataset === 'dense' ? 303 : 1100;
    for (let i = start; i < Math.min(start + count, total); i++) {
      const p =
        dataset === 'sparse'
          ? { latitude: 46, longitude: 8.000001 }
          : i < 300
            ? {
                latitude: 46 + (i % 20) * 0.0001,
                longitude: 8 + Math.floor(i / 20) * 0.0001,
              }
            : [
                { latitude: 46, longitude: 180 },
                { latitude: 46, longitude: -180 },
                { latitude: 89.999, longitude: 0 },
              ][i - 300];
      const key = `${dataset}:${i}`;
      const existing = await ctx.db
        .query('places')
        .withIndex('dataset_key', (q) =>
          q.eq('dataset', dataset).eq('key', key),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert('places', {
        dataset,
        key,
        ...p,
        tile: tile(p.longitude, p.latitude),
      });
      await geo.insert(ctx, key, p, { dataset }, dataset === 'dense' ? 1 : i);
    }
  },
});

export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const dataset of ['dense', 'sparse'] as const) {
      const total = dataset === 'dense' ? 303 : 1100;
      for (let start = 0; start < total; start += 50)
        await ctx.runMutation(internal.lab.seedChunk, {
          dataset,
          start,
          count: 50,
        });
    }
    return { dense: 303, sparse: 1100 };
  },
});

export const geoPage = internalQuery({
  args: {
    dataset: v.string(),
    rectangle,
    cursor: v.optional(v.string()),
    limit: v.number(),
    nonce: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 256)
      throw new Error('Invalid page size');
    return await geo.query(
      ctx,
      {
        shape: { type: 'rectangle', rectangle: args.rectangle },
        filter: (q) => q.eq('dataset', args.dataset),
        limit: args.limit,
      },
      args.cursor,
    );
  },
});

export const tilePage = internalQuery({
  args: {
    dataset: v.string(),
    tile: v.string(),
    paginationOpts: paginationOptsValidator,
    nonce: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems > 256)
      throw new Error('Invalid page size');
    return await ctx.db
      .query('places')
      .withIndex('dataset_tile', (q) =>
        q.eq('dataset', args.dataset).eq('tile', args.tile),
      )
      .paginate(args.paginationOpts);
  },
});

export const tiledWindows = internalAction({
  args: {
    dataset: v.string(),
    windows: v.array(rectangle),
    nonce: v.optional(v.string()),
  },
  handler: (ctx, args) => readTiledWindows(ctx, args, 1),
});

// Catalogue import uses the ordinary table first; build the component in bounded chunks.
export const indexChunk = internalMutation({
  args: { dataset: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems > 50)
      throw new Error('Index at most 50 points per call');
    const page = await ctx.db
      .query('places')
      .withIndex('dataset_key', (q) => q.eq('dataset', args.dataset))
      .paginate(args.paginationOpts);
    for (const p of page.page)
      await geo.insert(
        ctx,
        p.key,
        { latitude: p.latitude, longitude: p.longitude },
        { dataset: args.dataset },
        1,
      );
    return {
      cursor: page.continueCursor,
      done: page.isDone,
      count: page.page.length,
    };
  },
});

export const probe = internalAction({
  args: {},
  handler: async (ctx) => {
    const cases = [
      {
        name: 'dense-pagination',
        dataset: 'dense',
        rectangle: { west: 7.99, east: 8.01, south: 45.99, north: 46.01 },
        limit: 17,
        expected: 300,
      },
      {
        name: 'dateline-east',
        dataset: 'dense',
        rectangle: { west: 179.99, east: 180, south: 45, north: 47 },
        limit: 17,
        expected: 1,
      },
      {
        name: 'dateline-west',
        dataset: 'dense',
        rectangle: { west: -180, east: -179.99, south: 45, north: 47 },
        limit: 17,
        expected: 1,
      },
      {
        name: 'polar',
        dataset: 'dense',
        rectangle: { west: -180, east: 180, south: 89.99, north: 90 },
        limit: 17,
        expected: 1,
      },
      {
        name: 'world',
        dataset: 'dense',
        rectangle: { west: -180, east: 180, south: -90, north: 90 },
        limit: 17,
        expected: 303,
      },
      {
        name: 'wide',
        dataset: 'dense',
        rectangle: { west: -170, east: 170, south: 45, north: 47 },
        limit: 17,
        expected: 300,
      },
      {
        name: 'sparse-postfilter',
        dataset: 'sparse',
        rectangle: {
          west: 7.99999999,
          east: 8.00000001,
          south: 45.99999999,
          north: 46.00000001,
        },
        limit: 1,
        expected: 0,
      },
    ];
    const results = [];
    for (const scenario of cases) {
      const started = Date.now();
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0,
        returned = 0;
      try {
        do {
          const response: { results: { key: string }[]; nextCursor?: string } =
            await ctx.runQuery(internal.lab.geoPage, {
              dataset: scenario.dataset,
              rectangle: scenario.rectangle,
              limit: scenario.limit,
              cursor,
              nonce: `${started}:${pages}`,
            });
          pages++;
          returned += response.results.length;
          response.results.forEach((p) => seen.add(p.key));
          if (
            response.nextCursor !== undefined &&
            response.nextCursor === cursor
          )
            throw new Error('Non-advancing cursor');
          cursor = response.nextCursor;
          if (pages >= 100) throw new Error('Page budget exhausted');
        } while (cursor !== undefined);
        results.push({
          name: scenario.name,
          expectedCartesian: scenario.expected,
          found: seen.size,
          duplicates: returned - seen.size,
          pages,
          elapsedMs: Date.now() - started,
          complete: true,
        });
      } catch (error) {
        results.push({
          name: scenario.name,
          complete: false,
          pages,
          elapsedMs: Date.now() - started,
          error: String(error),
        });
      }
    }
    return { componentVersion: '0.2.1', results };
  },
});
