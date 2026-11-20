import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { event, phase } from './ingestion/validators';
import {
  catalogueIdentity,
  locationHint,
  metrics,
  mode,
  rectangle,
  response,
} from './matching/validators';
import { previewTables } from './previewSchema';
import {
  manifestValidator,
  scopeFields,
  summaryValidator,
} from './recording/validators';

export default defineSchema({
  ...previewTables,
  ingestionAccounts: defineTable({
    app: v.string(),
    matchingCatalogue: v.optional(v.id('matchingCatalogues')),
    generation: v.number(),
    state: v.union(
      v.literal('active'),
      v.literal('blocked'),
      v.literal('revoked'),
    ),
    token: v.number(),
    tokenExpired: v.boolean(),
    refresh: v.optional(
      v.object({
        job: v.id('ingestionJobs'),
        attempt: v.number(),
        until: v.number(),
      }),
    ),
    leaseMs: v.number(),
    reconciliationMs: v.number(),
    reconcileAt: v.optional(v.number()),
    reconcileCursor: v.optional(v.string()),
    reconciliationRuns: v.number(),
  }).index('app', ['app']),
  ingestionFixtures: defineTable({
    account: v.id('ingestionAccounts'),
    ...event,
  }).index('account_key', ['account', 'key']),
  ingestionReceipts: defineTable({
    account: v.id('ingestionAccounts'),
    receipt: v.string(),
  }).index('account_receipt', ['account', 'receipt']),
  ingestionJobs: defineTable({
    account: v.id('ingestionAccounts'),
    ...event,
    generation: v.number(),
    attempt: v.number(),
    revisionAttempts: v.number(),
    failures: v.number(),
    phase,
    due: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    worker: v.optional(v.id('_scheduled_functions')),
    upload: v.optional(v.id('recordingAttempts')),
    target: v.optional(v.id('recordingTargets')),
    name: v.optional(v.string()),
    committedVersion: v.optional(v.number()),
    lastFailure: v.optional(v.string()),
    recoveries: v.number(),
  }).index('account_key', ['account', 'key']),
  ingestionBudgets: defineTable({
    app: v.string(),
    window: v.string(),
    start: v.number(),
    used: v.number(),
    blockedUntil: v.optional(v.number()),
  }).index('app_window', ['app', 'window']),
  recordingTargets: defineTable({
    ...scopeFields,
    latestAttempt: v.optional(v.id('recordingAttempts')),
    current: v.optional(v.id('recordingManifests')),
  }).index('owner_key', ['owner', 'key']),
  recordingAttempts: defineTable({
    target: v.id('recordingTargets'),
    manifest: manifestValidator,
    compressedHash: v.string(),
    expiresAt: v.number(),
  }),
  recordingManifests: defineTable({
    ...scopeFields,
    revision: v.number(),
    file: v.id('_storage'),
    summary: v.id('recordingSummaries'),
    manifest: manifestValidator,
  }),
  recordingSummaries: defineTable({ summary: summaryValidator }),
  matchingCatalogues: defineTable({
    ...catalogueIdentity,
    count: v.number(),
    rowsHash: v.string(),
    artifact: v.string(),
  }).index('snapshot', ['snapshotId']),
  matchingRuns: defineTable({
    label: v.string(),
    generation: v.string(),
    manifestHash: v.string(),
    expected: v.number(),
    expiresAt: v.optional(v.number()),
    catalogue: v.id('matchingCatalogues'),
    state: v.union(
      v.literal('loading'),
      v.literal('ready'),
      v.literal('resetting'),
      v.literal('erasing'),
    ),
    imported: v.number(),
    actualPoolEnd: v.optional(v.number()),
    actualSelected: v.optional(v.number()),
    fixtureAccount: v.optional(v.id('ingestionAccounts')),
  })
    .index('label', ['label'])
    .index('fixture_account', ['fixtureAccount']),
  matchingOwners: defineTable({
    run: v.id('matchingRuns'),
    userId: v.string(),
    generation: v.string(),
    sequence: v.number(),
  }).index('run_user', ['run', 'userId']),
  matchingItems: defineTable({
    run: v.id('matchingRuns'),
    index: v.number(),
    owner: v.id('matchingOwners'),
    target: v.id('recordingTargets'),
    originalRevision: v.string(),
    locationHint,
    samples: v.number(),
    fixtureJob: v.optional(v.id('ingestionJobs')),
    fixtureVersion: v.optional(v.number()),
    fixtureRecording: v.optional(v.id('recordingManifests')),
    phase: v.union(
      v.literal('loading'),
      v.literal('pending'),
      v.literal('actual'),
    ),
  })
    .index('run_index', ['run', 'index'])
    .index('run_phase_index', ['run', 'phase', 'index'])
    .index('fixture_recording', ['fixtureRecording']),
  matchingGroups: defineTable({
    run: v.id('matchingRuns'),
    mode,
    ordinal: v.number(),
    parallelism: v.number(),
    interruptFirstAttempt: v.optional(v.boolean()),
    items: v.optional(v.array(v.number())),
    state: v.union(
      v.literal('pending'),
      v.literal('complete'),
      v.literal('failed'),
    ),
    attempt: v.number(),
    leaseUntil: v.number(),
    worker: v.optional(v.id('_scheduled_functions')),
    failure: v.optional(v.string()),
    windows: v.optional(v.array(rectangle)),
    candidateHash: v.optional(v.string()),
    matches: v.optional(
      v.array(
        v.object({
          index: v.number(),
          hash: v.string(),
          status: v.string(),
        }),
      ),
    ),
    metrics: v.optional(metrics),
  }).index('run_mode_ordinal', ['run', 'mode', 'ordinal']),
  placeChecks: defineTable({
    owner: v.id('matchingOwners'),
    target: v.id('recordingTargets'),
    catalogue: v.id('matchingCatalogues'),
    ...catalogueIdentity,
    accountGeneration: v.string(),
    sourceVersion: v.string(),
    recording: v.id('recordingManifests'),
    recordingGeneration: v.string(),
    recordingRevision: v.number(),
    result: response,
    sequence: v.number(),
  }).index('target', ['target']),
  matchingChanges: defineTable({
    owner: v.id('matchingOwners'),
    sequence: v.number(),
    key: v.string(),
    operation: v.literal('upsert'),
  }).index('owner_sequence', ['owner', 'sequence']),
  places: defineTable({
    dataset: v.string(),
    key: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    tile: v.string(),
    metadata: v.optional(v.any()),
  })
    .index('dataset_key', ['dataset', 'key'])
    .index('dataset_tile', ['dataset', 'tile']),
});
