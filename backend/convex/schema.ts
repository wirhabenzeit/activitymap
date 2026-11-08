import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  activityMetadataValidator,
  activityProjectionValidator,
} from './activityValidators';
import { manifestValidator, summaryValidator } from './recordingValidators';

export default defineSchema({
  owners: defineTable({
    userId: v.string(),
    athleteId: v.string(),
    backend: v.union(v.literal('postgres'), v.literal('convex')),
    epoch: v.string(),
    generation: v.string(),
    revoked: v.boolean(),
    catalogue: v.string(),
    matchingVersion: v.string(),
    projectionVersion: v.number(),
  }).index('by_user', ['userId']),
  ownerHeads: defineTable({
    owner: v.id('owners'),
    sequence: v.number(),
    retentionFloor: v.number(),
    catalogueAfter: v.optional(v.string()),
    /** Shadow-write position: the last mirrored Postgres change sequence and
     * the source revision used for it (revisions only ever increase). */
    mirror: v.optional(
      v.object({ sequence: v.number(), revision: v.number() }),
    ),
  }).index('by_owner', ['owner']),
  /** Single-use nonces for signed bridge writes, kept until they expire. */
  bridgeNonces: defineTable({ nonce: v.string(), expiresAt: v.number() })
    .index('by_nonce', ['nonce'])
    .index('by_expiry', ['expiresAt']),
  ownerEpochs: defineTable({ owner: v.id('owners'), epoch: v.string() }).index(
    'by_owner_epoch',
    ['owner', 'epoch'],
  ),
  activities: defineTable({
    owner: v.id('owners'),
    key: v.string(),
    generation: v.string(),
    sourceRevision: v.number(),
    streamSourceRevision: v.number(),
    deleted: v.boolean(),
    dto: v.optional(activityMetadataValidator),
    projection: v.optional(activityProjectionValidator),
    recording: v.optional(v.id('recordings')),
  })
    .index('by_owner_key', ['owner', 'key'])
    .index('by_owner_live_key', ['owner', 'generation', 'deleted', 'key']),
  recordings: defineTable({
    activity: v.id('activities'),
    file: v.id('_storage'),
    generation: v.string(),
    revision: v.string(),
    sourceRevision: v.number(),
    manifest: manifestValidator,
    summary: summaryValidator,
  }).index('by_file', ['file']),
  changes: defineTable({
    owner: v.id('owners'),
    sequence: v.number(),
    entityType: v.literal('activity'),
    entityId: v.string(),
    operation: v.union(v.literal('upsert'), v.literal('delete')),
    changedAt: v.number(),
  })
    .index('by_owner_sequence', ['owner', 'sequence'])
    .index('by_changed_at', ['changedAt']),
});
