import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  activityMetadataValidator,
  activityProjectionValidator,
  photoValidator,
  placeMatchValidator,
} from './activityValidators';
import { writerValidator } from './ownerScope';
import { placeValidator } from './placeValidators';
import { manifestValidator, summaryValidator } from './recordingValidators';
import { countsValidator } from './statsShape';

export default defineSchema({
  owners: defineTable({
    userId: v.string(),
    athleteId: v.string(),
    backend: v.union(v.literal('postgres'), v.literal('convex')),
    /** Who writes the library, separately from who serves it (`backend`).
     * Absent means Postgres. Changed only by `owners.setWriter`, which
     * counts `writerEpoch` up; the routing `epoch` stays as it is. */
    writer: v.optional(writerValidator),
    writerEpoch: v.optional(v.number()),
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
      v.object({
        sequence: v.number(),
        revision: v.number(),
        /** An unfinished full copy: last copied activity ID and the change
         * sequence it started from. */
        full: v.optional(v.object({ after: v.string(), through: v.number() })),
        /** Photo catch-up: last activity ID copied, or null when finished. */
        photos: v.optional(v.union(v.string(), v.null())),
        /** The last mirrored photo change sequence. */
        photoSequence: v.optional(v.number()),
      }),
    ),
  }).index('by_owner', ['owner']),
  /** Library counts per owner (convex/stats.ts). `rebuildAfter` is set while
   * a recount runs: the last activity key it has counted. */
  ownerStats: defineTable({
    owner: v.id('owners'),
    counts: countsValidator,
    rebuildAfter: v.optional(v.string()),
  }).index('by_owner', ['owner']),
  /** Single-use nonces for signed bridge writes, kept until they expire. */
  bridgeNonces: defineTable({ nonce: v.string(), expiresAt: v.number() })
    .index('by_nonce', ['nonce'])
    .index('by_expiry', ['expiresAt']),
  /** Provider events received for an owner Convex writes for
   * (convex/providerEvents.ts): the durable receipt its ingestion works
   * from. `event` is the sender's ID for the delivery, so a repeat is one
   * row. */
  providerEvents: defineTable({
    owner: v.id('owners'),
    event: v.string(),
    activity: v.string(),
    aspect: v.union(
      v.literal('create'),
      v.literal('update'),
      v.literal('delete'),
    ),
    eventTime: v.number(),
    receivedAt: v.number(),
  })
    .index('by_owner_event', ['owner', 'event'])
    .index('by_received', ['receivedAt']),
  /** Convex ingestion (convex/ingestion.ts): one job per owner and activity.
   * `requested` counts the times the activity was asked for; a run that
   * ends with a different count than it started with runs again. */
  ingestionJobs: defineTable({
    owner: v.id('owners'),
    /** The activity key (owners.idKey). */
    activity: v.string(),
    status: v.union(
      /** Waiting for `dueAt`, or running when it holds a lease. */
      v.literal('queued'),
      /** Nothing to do. */
      v.literal('idle'),
      /** The owner must reconnect; a new request tries once more. */
      v.literal('blocked'),
      /** Gave up; a new request starts over. */
      v.literal('failed'),
    ),
    phase: v.union(v.literal('source'), v.literal('recording')),
    requested: v.number(),
    /** Failed attempts since the job last made progress. */
    attempt: v.number(),
    dueAt: v.optional(v.number()),
    /** The last source revision a run of this job was given. */
    revision: v.number(),
    /** How many runs have claimed the job; a lease names its claim. */
    claims: v.number(),
    lease: v.optional(
      v.object({
        claim: v.number(),
        expiresAt: v.number(),
        requested: v.number(),
      }),
    ),
    /** Why the last run did not finish. */
    error: v.optional(v.string()),
    /** Reconciliation (convex/ingestionSweep.ts): a fingerprint of the last
     * provider summary seen for the activity, and the sweep that saw it. */
    summary: v.optional(v.string()),
    seen: v.optional(v.number()),
  })
    .index('by_owner_activity', ['owner', 'activity'])
    .index('by_owner_status', ['owner', 'status', 'activity']),
  /** Reconciliation of an owner's library with the provider's activity
   * list (convex/ingestionSweep.ts): one row per owner. */
  ingestionSweeps: defineTable({
    owner: v.id('owners'),
    /** How many sweeps have started. */
    number: v.number(),
    phase: v.union(
      v.literal('idle'),
      /** Reading the provider's list, page by page. */
      v.literal('scanning'),
      /** Asking for the activities the list did not contain. */
      v.literal('confirming'),
    ),
    dueAt: v.number(),
    /** The sweep lists activities that started before this (epoch seconds). */
    scanBefore: v.number(),
    page: v.number(),
    /** Confirming: the last activity key looked at. */
    after: v.string(),
    attempt: v.number(),
    claims: v.number(),
    lease: v.optional(v.object({ claim: v.number(), expiresAt: v.number() })),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  }).index('by_owner', ['owner']),
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
    .index('by_owner_live_key', ['owner', 'generation', 'deleted', 'key'])
    // Oldest and newest activity for the live status view.
    .index('by_owner_live_start', [
      'owner',
      'generation',
      'deleted',
      'dto.start_date',
    ]),
  recordings: defineTable({
    activity: v.id('activities'),
    file: v.id('_storage'),
    generation: v.string(),
    revision: v.string(),
    sourceRevision: v.number(),
    manifest: manifestValidator,
    summary: summaryValidator,
  }).index('by_file', ['file']),
  /** Provider photo metadata, one document per photo (convex/photos.ts).
   * `key` is the provider's unique ID and `activity` the activity key. */
  photos: defineTable({
    owner: v.id('owners'),
    key: v.string(),
    activity: v.string(),
    generation: v.string(),
    sourceRevision: v.number(),
    dto: photoValidator,
  })
    .index('by_owner_key', ['owner', 'key'])
    .index('by_owner_live_key', ['owner', 'generation', 'key'])
    .index('by_owner_activity', ['owner', 'activity']),
  /** The source revision of each activity's photo set, kept also for an
   * empty set, so a stale writer can neither replace nor delete photos. */
  photoSets: defineTable({
    owner: v.id('owners'),
    activity: v.string(),
    revision: v.number(),
  }).index('by_owner_activity', ['owner', 'activity']),
  /** Imported place rowsets, one per catalogue snapshot and revision
   * (convex/places.ts). `after` and `digest` describe the rows imported so
   * far; nothing reads a rowset until it is complete. */
  placeCatalogues: defineTable({
    dataset: v.string(),
    snapshotId: v.string(),
    revision: v.string(),
    count: v.number(),
    /** A stored file with the catalogue manifest and coverage. */
    metadata: v.id('_storage'),
    imported: v.number(),
    after: v.string(),
    digest: v.string(),
    complete: v.boolean(),
  }).index('by_dataset', ['dataset']),
  /** The places of a rowset by quarter-degree tile. `key` is the Postgres
   * place ID. */
  places: defineTable({
    dataset: v.string(),
    key: v.string(),
    tile: v.string(),
    place: placeValidator,
  })
    .index('by_dataset_tile', ['dataset', 'tile', 'key'])
    .index('by_dataset_key', ['dataset', 'key']),
  /** One pass of the shadow matcher over an owner's library
   * (convex/shadowMatching.ts). `after` is the last activity key handled. */
  shadowMatchRuns: defineTable({
    owner: v.id('owners'),
    dataset: v.string(),
    after: v.string(),
    done: v.boolean(),
    matched: v.number(),
    /** Activities without a current recording. */
    skipped: v.number(),
    /** Results dropped because the recording changed during matching. */
    stale: v.number(),
    failed: v.array(v.object({ key: v.string(), reason: v.string() })),
    error: v.optional(v.string()),
    /** Comparison with the results copied from Postgres. */
    comparison: v.optional(
      v.object({
        after: v.string(),
        done: v.boolean(),
        same: v.number(),
        different: v.number(),
        onlyPostgres: v.number(),
        onlyShadow: v.number(),
        neither: v.number(),
        examples: v.array(
          v.object({
            key: v.string(),
            postgres: v.string(),
            shadow: v.string(),
          }),
        ),
      }),
    ),
  }).index('by_owner', ['owner']),
  /** Match results computed here, kept apart from the results clients read
   * (`activities.projection.match`) until the two have been compared. */
  shadowMatches: defineTable({
    owner: v.id('owners'),
    activity: v.string(),
    recording: v.id('recordings'),
    dataset: v.string(),
    result: placeMatchValidator,
  }).index('by_owner_activity', ['owner', 'activity']),
  changes: defineTable({
    owner: v.id('owners'),
    sequence: v.number(),
    entityType: v.union(v.literal('activity'), v.literal('photo')),
    entityId: v.string(),
    operation: v.union(v.literal('upsert'), v.literal('delete')),
    changedAt: v.number(),
  })
    .index('by_owner_sequence', ['owner', 'sequence'])
    .index('by_changed_at', ['changedAt']),
});
