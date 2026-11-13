import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { activityProjectionValidator } from '../../../../../backend/convex/activityValidators';

export const previewTables = {
  previewOwners: defineTable({
    userId: v.string(),
    athleteId: v.number(),
    epoch: v.string(),
    erasing: v.optional(v.boolean()),
    sequence: v.number(),
    lastChangedAt: v.optional(v.number()),
    retentionFloor: v.optional(v.number()),
    fixtureAccount: v.optional(v.id('ingestionAccounts')),
    retainedRun: v.optional(v.id('matchingRuns')),
    retainedOwner: v.optional(v.id('matchingOwners')),
    lastSummaryReconciledAt: v.optional(v.number()),
    matchingVersion: v.optional(v.string()),
    projectionVersion: v.optional(v.number()),
    projectionBackfill: v.optional(
      v.object({
        version: v.number(),
        after: v.union(v.number(), v.null()),
        count: v.number(),
        bytes: v.number(),
      }),
    ),
  })
    .index('user', ['userId'])
    .index('fixture_account', ['fixtureAccount']),
  previewActivities: defineTable({
    owner: v.id('previewOwners'),
    id: v.number(),
    dto: v.any(),
    projection: v.optional(activityProjectionValidator),
    storedPhotos: v.optional(v.number()),
    target: v.optional(v.id('recordingTargets')),
  })
    .index('owner_activity', ['owner', 'id'])
    .index('target', ['target']),
  previewPhotos: defineTable({
    owner: v.id('previewOwners'),
    id: v.string(),
    activityId: v.number(),
    dto: v.any(),
  })
    .index('owner_photo', ['owner', 'id'])
    .index('owner_activity', ['owner', 'activityId']),
  previewChanges: defineTable({
    owner: v.id('previewOwners'),
    sequence: v.number(),
    entityType: v.union(v.literal('activity'), v.literal('photo')),
    entityId: v.string(),
    operation: v.union(v.literal('upsert'), v.literal('delete')),
    changedAt: v.number(),
  })
    .index('owner_sequence', ['owner', 'sequence'])
    .index('owner_time', ['owner', 'changedAt']),
};
