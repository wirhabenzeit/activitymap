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
    .index('by_owner_received', ['owner', 'receivedAt'])
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
    phase: v.union(
      v.literal('source'),
      v.literal('recording'),
      v.literal('match'),
    ),
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
    /** A match against the owner's current catalogue is owed, and no
     * provider read with it (ingestion.requestMatch). Set while a run holds
     * the job, and on a job queued only for that match. */
    rematch: v.optional(v.boolean()),
    /** How the job ended before it was queued for a match alone. A match
     * says nothing about the provider read that failed, so the job goes back
     * to this when the match is done; the next read of the source drops it. */
    failure: v.optional(
      v.object({
        status: v.union(v.literal('blocked'), v.literal('failed')),
        attempt: v.number(),
        error: v.optional(v.string()),
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
    /** When a scan last reached the end of the provider's list. The sweep
     * itself completes later, once it has asked for what is missing. */
    listReadAt: v.optional(v.number()),
  }).index('by_owner', ['owner']),
  /** Private share links of an owner Convex writes for (convex/shares.ts).
   * `activities` are activity keys. */
  shareLinks: defineTable({
    owner: v.id('owners'),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    fields: v.object({ showRouteEnds: v.boolean() }),
    activities: v.array(v.string()),
  })
    .index('by_token', ['tokenHash'])
    .index('by_owner', ['owner']),
  /** The sign-in store (convex/authStore.ts): one document per record of
   * the auth library's models. `key` is the record's id; the fields next to
   * `doc` are copies the library looks records up by. */
  authRecords: defineTable({
    model: v.string(),
    key: v.string(),
    doc: v.any(),
    userId: v.optional(v.string()),
    token: v.optional(v.string()),
    identifier: v.optional(v.string()),
    accountId: v.optional(v.string()),
    email: v.optional(v.string()),
  })
    .index('by_model_key', ['model', 'key'])
    .index('by_model_userId', ['model', 'userId'])
    .index('by_model_token', ['model', 'token'])
    .index('by_model_identifier', ['model', 'identifier'])
    .index('by_model_accountId', ['model', 'accountId'])
    .index('by_model_email', ['model', 'email']),
  /** The app's API rate limit counters (convex/appState.ts): one row per
   * caller key and fixed window. */
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index('by_key_window', ['key', 'windowStart'])
    .index('by_window', ['windowStart']),
  /** The provider's shared request budget (convex/appState.ts): one row per
   * window key. */
  providerBudget: defineTable({
    key: v.string(),
    windowStart: v.number(),
    used: v.number(),
    inFlight: v.number(),
    ceiling: v.number(),
    blockedUntil: v.optional(v.number()),
  }).index('by_key', ['key']),
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
  /** The catalogue libraries were last told to move to (one row;
   * catalogue.adopt). A continuation of an earlier adoption stops when it
   * is no longer the one named here. `snapshotId` is the rowset's snapshot
   * or the live catalogue's (`LIVE_CATALOGUE`), set once the adoption has
   * moved every owner. */
  catalogueAdoptions: defineTable({
    catalogue: v.string(),
    matchingVersion: v.string(),
    snapshotId: v.optional(v.string()),
  }),
  /** The places of a rowset by quarter-degree tile. `key` is the place ID. */
  places: defineTable({
    dataset: v.string(),
    key: v.string(),
    tile: v.string(),
    place: placeValidator,
  })
    .index('by_dataset_tile', ['dataset', 'tile', 'key'])
    .index('by_dataset_key', ['dataset', 'key']),
  /** The live place catalogue (convex/livePlaces.ts): one row per place,
   * updated in place by a publication. `key` is the place ID, `hash` the
   * row hash (`rowHash` in src/server/places/catalogue-rows.ts) and
   * `revision` the catalogue revision that last wrote the row. */
  livePlaces: defineTable({
    key: v.string(),
    tile: v.string(),
    place: placeValidator,
    hash: v.string(),
    revision: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_tile_key', ['tile', 'key']),
  /** The state of the live catalogue (one row). `revision` counts completed
   * publications and is 0 before the first. `snapshotId` and `metadata`
   * (a stored file with the manifest and coverage) are those of the last
   * completed publication. `count` and `setDigest` describe the rows as
   * they are now and are maintained by every write. `pending` is the
   * publication being applied: the revision it will become and the count
   * and digest the rows must reach. */
  placeCatalogueState: defineTable({
    revision: v.number(),
    snapshotId: v.optional(v.string()),
    metadata: v.optional(v.id('_storage')),
    count: v.number(),
    setDigest: v.string(),
    pending: v.optional(
      v.object({
        snapshotId: v.string(),
        revision: v.number(),
        metadata: v.id('_storage'),
        count: v.number(),
        setDigest: v.string(),
        startedAt: v.number(),
      }),
    ),
  }),
  /** The tiles a publication changed: the old and new tile of every place
   * it wrote or deleted, and the tiles where coverage changed. One row per
   * revision and tile, deleted when the revision's re-match walk has
   * finished the tile (catalogue.rematchTiles). */
  placeTileChanges: defineTable({
    revision: v.number(),
    tile: v.string(),
  }).index('by_revision_tile', ['revision', 'tile']),
  /** One row per publication of the live catalogue, from its beginning
   * (convex/livePlaces.ts), and how far its re-match walk has come. A
   * replaced pending publication hands its revision and its row on. */
  placePublications: defineTable({
    revision: v.number(),
    snapshotId: v.string(),
    completedAt: v.optional(v.number()),
    /** What the publisher says about the artifact: the date of its source
     * data and the number of its regions. */
    source: v.optional(v.object({ dataAsOf: v.number(), regions: v.number() })),
    /** Changed tiles, and those the walk has finished. */
    tiles: v.number(),
    tilesDone: v.number(),
    /** The walk's last step. */
    walkedAt: v.optional(v.number()),
  }).index('by_revision', ['revision']),
  /** Place match counts per owner (convex/placeCounts.ts). `rebuildAfter` is
   * set while a recount runs: the last activity key it has counted. */
  placeMatchCounts: defineTable({
    owner: v.id('owners'),
    /** Activities with a match for the owner's catalogue. */
    matched: v.number(),
    /** Matches of live catalogue revision `revision` that replaced one of an
     * older revision. */
    rematched: v.number(),
    revision: v.number(),
    rebuildAfter: v.optional(v.string()),
  }).index('by_owner', ['owner']),
  /** The catalogue tiles each activity's match read, so a catalogue change
   * finds the activities it affects. `activity` is the activity key. */
  activityPlaceTiles: defineTable({
    owner: v.id('owners'),
    activity: v.string(),
    tile: v.string(),
  })
    .index('by_owner_activity', ['owner', 'activity'])
    .index('by_tile_owner', ['tile', 'owner', 'activity']),
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
