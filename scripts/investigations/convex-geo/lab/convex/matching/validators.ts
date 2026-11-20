import { v } from 'convex/values';

export const locationHint = v.object({
  bounds: v.optional(v.union(v.array(v.number()), v.null())),
  start: v.optional(v.union(v.array(v.number()), v.null())),
});

export const catalogueIdentity = {
  snapshotId: v.string(),
  revision: v.string(),
  recipe: v.string(),
};

export const mode = v.union(
  v.literal('actual'),
  v.literal('frozen'),
  v.literal('single'),
  v.literal('parallel'),
  v.literal('bounded'),
  v.literal('isolated'),
  v.literal('profile-cold'),
);

export const response = v.object({
  userId: v.string(),
  activityId: v.string(),
  status: v.union(
    v.literal('complete'),
    v.literal('partial'),
    v.literal('uncovered'),
    v.literal('missing_streams'),
  ),
  streamGeneration: v.string(),
  streamRevision: v.string(),
  catalogueSnapshotId: v.string(),
  matcherVersion: v.string(),
  places: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      kinds: v.array(
        v.union(v.literal('peak'), v.literal('pass'), v.literal('hut')),
      ),
      longitude: v.number(),
      latitude: v.number(),
      elevationM: v.union(v.number(), v.null()),
      visits: v.array(v.object({ distanceM: v.union(v.number(), v.null()) })),
    }),
  ),
});

export const rectangle = v.object({
  west: v.number(),
  south: v.number(),
  east: v.number(),
  north: v.number(),
});

export const claimFields = {
  group: v.id('matchingGroups'),
  attempt: v.number(),
};
export const metrics = v.object({
  prepareMs: v.number(),
  fileMs: v.number(),
  decodeMs: v.number(),
  tileMs: v.number(),
  scoreMs: v.number(),
  pages: v.number(),
  tiles: v.number(),
  scanned: v.number(),
  compressedBytes: v.number(),
  rssMiB: v.number(),
  rssHighWaterAtStartMiB: v.optional(v.number()),
  rssObservedMiB: v.optional(v.number()),
  samples: v.number(),
  sections: v.number(),
  activities: v.optional(v.number()),
  rawBytes: v.optional(v.number()),
  candidates: v.optional(v.number()),
  windows: v.optional(v.number()),
  rssAtStartMiB: v.optional(v.number()),
  heapAtStartMiB: v.optional(v.number()),
  heapPeakMiB: v.optional(v.number()),
  rssAfterPrepareMiB: v.optional(v.number()),
  heapAfterPrepareMiB: v.optional(v.number()),
  rssAfterCatalogueMiB: v.optional(v.number()),
  heapAfterCatalogueMiB: v.optional(v.number()),
  rssAfterScoreMiB: v.optional(v.number()),
  heapAfterScoreMiB: v.optional(v.number()),
  workerMs: v.optional(v.number()),
});
