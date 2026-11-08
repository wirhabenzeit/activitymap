import { v } from 'convex/values';

export const manifestValidator = v.object({
  codec: v.literal('gzip-json-v1'),
  contentHash: v.string(),
  compressedBytes: v.number(),
  uncompressedBytes: v.number(),
  counts: v.object({
    time: v.optional(v.number()),
    distance: v.optional(v.number()),
    latlng: v.optional(v.number()),
    altitude: v.optional(v.number()),
    watts: v.optional(v.number()),
    heartrate: v.optional(v.number()),
  }),
});

const basis = v.union(v.literal('distance'), v.literal('time'), v.null());
const encoded = v.optional(v.string());
const samples = v.optional(v.array(v.number()));
export const summaryValidator = v.union(
  v.null(),
  v.object({
    codec: v.literal('polyline-v1'),
    algorithm_version: v.number(),
    basis,
    count: v.number(),
    time: encoded,
    distance: encoded,
    latlng: encoded,
    altitude: encoded,
    watts: encoded,
    heartrate: encoded,
  }),
  v.object({
    version: v.number(),
    basis,
    time: samples,
    distance: samples,
    latlng: v.optional(v.array(v.array(v.number()))),
    altitude: samples,
    watts: samples,
    heartrate: samples,
  }),
);
