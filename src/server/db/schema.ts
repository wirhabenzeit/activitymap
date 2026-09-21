import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  bigint,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { sportTypes } from '~/server/strava/types';
import type { SportType } from '~/server/strava/types';
import type { WebhookRequest } from '~/types/strava';
import type { ShareLinkFieldOptions } from '~/lib/sharing/fields';

export const sportTypeEnum = pgEnum('sport_type', sportTypes);

export const geometryStateEnum = pgEnum('geometry_state', [
  'summary',
  'detailed',
  'refresh_required',
]);

export const photosStateEnum = pgEnum('photos_state', [
  'current',
  'refresh_required',
]);

export const summaryReconciliationPhaseEnum = pgEnum(
  'summary_reconciliation_phase',
  ['scanning', 'confirming'],
);

export const users = pgTable('user', {
  id: text('id').notNull().primaryKey(),
  name: text('name'),
  email: text('email'),
  emailVerified: boolean('emailVerified').default(false), // Changed to boolean for Better Auth
  image: text('image'),
  athlete_id: bigint('athlete_id', { mode: 'number' }).unique(),
  oldest_activity_reached: boolean('oldest_activity_reached')
    .notNull()
    .default(false),
  // Advanced only after a complete, bounded Strava summary scan and its
  // missing-activity confirmation pass have both committed. A partial or
  // failed scan must never make the dataset appear current (issue #123).
  lastSummaryReconciledAt: timestamp('last_summary_reconciled_at', {
    mode: 'date',
  }),
  // Better Auth additions
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});

export const accounts = pgTable(
  'account',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), // Better Auth requires id
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type'), // Legacy NextAuth column; Better Auth never writes this
    provider: text('provider'), // Legacy NextAuth column; Better Auth never writes this
    providerId: text('providerId').notNull(), // Better Auth uses providerId
    providerAccountId: text('providerAccountId'), // Legacy NextAuth column; Better Auth never writes this
    accountId: text('accountId').notNull(), // Better Auth uses accountId
    refresh_token: text('refresh_token'),
    refreshToken: text('refreshToken'), // Better Auth format
    access_token: text('access_token'),
    accessToken: text('accessToken'), // Better Auth format
    expires_at: integer('expires_at'),
    expiresAt: timestamp('expiresAt', { mode: 'date' }), // Better Auth <1.7 format
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { mode: 'date' }), // Better Auth 1.7+ format
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {
      mode: 'date',
    }), // Better Auth 1.7+ format
    password: text('password'), // Better Auth credential accounts; unused for OAuth
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    idToken: text('idToken'), // Better Auth format
    session_state: text('session_state'),
    // Better Auth additions
    createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
    // Athlete deauthorization / erasure (issue #125; see
    // docs/strava-data-policy.md §3). `revokedAt` is set the moment a
    // Strava `object_type: "athlete"` webhook is processed for this
    // account - at the same time the stored tokens are cleared, so a
    // non-null `revokedAt` and a live access token never coexist.
    // `scheduledErasureAt` records the 30-day full-erasure deadline the API
    // policy requires. The production-only erasure cron consumes this value
    // and deletes the athlete's Strava-derived data once it is due; until
    // then the account remains excluded from ordinary token refresh/sync.
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    scheduledErasureAt: timestamp('scheduled_erasure_at', { mode: 'date' }),
  },
  (table) => [
    index('userId_idx').on(table.userId),
    index('provider_idx').on(table.provider, table.providerAccountId),
  ],
);

export const sessions = pgTable('session', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), // Better Auth uses id
  sessionToken: text('sessionToken').unique(), // Keep for backward compat
  token: text('token').notNull().unique(), // Better Auth uses token
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }), // Keep for backward compat
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(), // Better Auth uses expiresAt
  // Better Auth additions
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});


// The legacy `webhook` table (superseded by `stravaWebhooks`/
// `stravaWebhookEvents` from issue #124's durable webhook inbox) was dropped
// in issue #126 phase 3 - see that migration and PR for the "nothing reads
// it" verification (grepped for the `webhooks` export across `src/`; the
// only other hits were the unrelated `checkWebhookStatus`/
// `createWebhookSubscription` Strava-subscription actions, which use
// `stravaWebhooks`, not this table).

export const activities = pgTable(
  'activities',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    public_id: bigint('public_id', { mode: 'number' }).notNull().unique(),
    athlete: bigint('athlete', { mode: 'number' })
      .notNull()
      .references(() => users.athlete_id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    distance: doublePrecision('distance'),
    moving_time: integer('moving_time'),
    elapsed_time: integer('elapsed_time'),
    total_elevation_gain: doublePrecision('total_elevation_gain'),
    sport_type: text('sport_type', { enum: sportTypes }).notNull(),
    start_date: timestamp('start_date', { mode: 'date' }).notNull(),
    start_date_local: timestamp('start_date_local', { mode: 'date' }).notNull(),
    timezone: varchar('timezone').notNull(),
    start_latlng: doublePrecision('start_latlng').array(),
    end_latlng: doublePrecision('end_latlng').array(),
    achievement_count: integer('achievement_count'),
    kudos_count: integer('kudos_count'),
    comment_count: integer('comment_count'),
    athlete_count: integer('athlete_count'),
    photo_count: integer('photo_count'),
    total_photo_count: integer('total_photo_count'),
    map_id: varchar('map_id'),
    map_polyline: text('map_polyline'),
    map_summary_polyline: text('map_summary_polyline'),
    map_bbox: doublePrecision('map_bbox').array(),
    trainer: boolean('trainer'),
    commute: boolean('commute'),
    manual: boolean('manual'),
    private: boolean('private'),
    flagged: boolean('flagged'),
    workout_type: integer('workout_type'),
    upload_id: bigint('upload_id', { mode: 'number' }),
    average_speed: doublePrecision('average_speed'),
    max_speed: doublePrecision('max_speed'),
    calories: doublePrecision('calories'),
    has_heartrate: boolean('has_heartrate'),
    average_heartrate: doublePrecision('average_heartrate'),
    max_heartrate: doublePrecision('max_heartrate'),
    heartrate_opt_out: boolean('heartrate_opt_out'),
    display_hide_heartrate_option: boolean('display_hide_heartrate_option'),
    elev_high: doublePrecision('elev_high'),
    elev_low: doublePrecision('elev_low'),
    pr_count: integer('pr_count'),
    has_kudoed: boolean('has_kudoed'),
    hide_from_home: boolean('hide_from_home'),
    gear_id: varchar('gear_id'),
    device_watts: boolean('device_watts'),
    average_watts: doublePrecision('average_watts'),
    max_watts: integer('max_watts'),
    weighted_average_watts: integer('weighted_average_watts'),
    kilojoules: doublePrecision('kilojoules'),
    last_updated: timestamp('last_updated', { mode: 'date' }).defaultNow(),
    // Component freshness contract for the v1 sync API. Production coverage
    // was completed and audited before #126 retired the DTO fallback. The
    // A migration backfills legacy rows before enforcing this invariant.
    geometryState: geometryStateEnum('geometry_state').notNull(),
    photosState: photosStateEnum('photos_state'),
    lastSummarySeenAt: timestamp('last_summary_seen_at', { mode: 'date' }),
    lastDetailedFetchedAt: timestamp('last_detailed_fetched_at', {
      mode: 'date',
    }),
    is_complete: boolean('is_complete').notNull().default(false),
  },
  (table) => [
    index('activities_athlete_idx').on(table.athlete),
    index('activities_start_date_idx').on(table.start_date),
    index('activities_public_id_idx').on(table.public_id),
  ],
);

export const photos = pgTable(
  'photos',
  {
    unique_id: varchar('unique_id').primaryKey(),
    activity_id: bigint('activity_id', { mode: 'number' })
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    athlete_id: bigint('athlete_id', { mode: 'number' }).notNull(),
    activity_name: text('activity_name'),
    caption: text('caption'),
    type: integer('type').notNull(),
    source: integer('source'),
    urls: jsonb('urls').$type<Record<string, string>>(),
    sizes: jsonb('sizes').$type<Record<string, [number, number]>>(),
    default_photo: boolean('default_photo'),
    location: doublePrecision('location').array(),
    uploaded_at: timestamp('uploaded_at', { mode: 'date' }),
    created_at: timestamp('created_at', { mode: 'date' }),
    post_id: integer('post_id'),
    status: varchar('status'),
    resource_state: integer('resource_state'),
  },
  (table) => [
    index('photos_activity_idx').on(table.activity_id),
    index('photos_athlete_idx').on(table.athlete_id),
  ],
);

export const activitySync = pgTable(
  'activity_sync',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    last_sync: timestamp('last_sync', { mode: 'date' }).defaultNow(),
    sync_in_progress: boolean('sync_in_progress').notNull().default(false),
    last_error: text('last_error'),
  },
  (table) => [index('activity_sync_user_id_idx').on(table.user_id)],
);

// Durable, resumable state for the periodic Strava summary reconciliation
// required by issue #123. `scanBefore` is fixed when a scan starts so newer
// activities cannot shift page boundaries; `nextPage` and
// `candidateAfterId` make both the scan and the missing-activity confirmation
// pass resumable. A short lease prevents overlapping cron invocations from
// processing the same athlete concurrently, while still recovering after a
// crashed worker.
export const stravaSummaryReconciliations = pgTable(
  'strava_summary_reconciliation',
  {
    athleteId: bigint('athlete_id', { mode: 'number' })
      .primaryKey()
      .references(() => users.athlete_id, { onDelete: 'cascade' }),
    scanStartedAt: timestamp('scan_started_at', { mode: 'date' }).notNull(),
    scanBefore: bigint('scan_before', { mode: 'number' }).notNull(),
    nextPage: integer('next_page').notNull().default(1),
    phase: summaryReconciliationPhaseEnum('phase')
      .notNull()
      .default('scanning'),
    candidateAfterId: bigint('candidate_after_id', { mode: 'number' }),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('strava_summary_reconciliation_lease_idx').on(
      table.leaseExpiresAt,
      table.updatedAt,
    ),
  ],
);

export const activityDeletions = pgTable(
  'activity_deletions',
  {
    athlete_id: bigint('athlete_id', { mode: 'number' }).notNull(),
    activity_id: bigint('activity_id', { mode: 'number' }).notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.athlete_id, table.activity_id],
    }),
    index('activity_deletions_athlete_deleted_idx').on(
      table.athlete_id,
      table.deleted_at,
    ),
  ],
);

export const photoDeletions = pgTable(
  'photo_deletions',
  {
    athlete_id: bigint('athlete_id', { mode: 'number' }).notNull(),
    photo_id: varchar('photo_id').notNull(),
    activity_id: bigint('activity_id', { mode: 'number' }),
    deleted_at: timestamp('deleted_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.athlete_id, table.photo_id],
    }),
    index('photo_deletions_athlete_deleted_idx').on(
      table.athlete_id,
      table.deleted_at,
    ),
  ],
);

// export const activitiesRelations = relations(activities, ({ many }) => ({
//   photos: many(photos),
// }));

// export const photosRelations = relations(photos, ({ one }) => ({
//   activity: one(activities, {
//     fields: [photos.activity_id],
//     references: [activities.id],
//   }),
// }));

// export const activitySyncRelations = relations(activitySync, ({ one }) => ({
//   user: one(users, {
//     fields: [activitySync.user_id],
//     references: [users.id],
//   }),
// }));

// export const usersRelations = relations(users, ({ many }) => ({
//   accounts: many(accounts),
//   activities: many(activities, {
//     relationName: 'user_activities',
//   }),
//   activitySyncs: many(activitySync),
// }));

export type User = typeof users.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type ActivitySync = typeof activitySync.$inferSelect;
export type StravaSummaryReconciliation =
  typeof stravaSummaryReconciliations.$inferSelect;
export type ActivityDeletion = typeof activityDeletions.$inferSelect;
export type PhotoDeletion = typeof photoDeletions.$inferSelect;

// Canonical record of our Strava webhook subscription. The columns below
// (`resourceState`, `applicationId`, `verified`, `active`, and the unique
// index on `subscriptionId`) mirror what the legacy `webhook` table (Strava's
// own subscription metadata, see above) also tracks. This is an additive,
// expand-only step toward consolidating the two (see issue #124): the
// legacy `webhook` table is intentionally left in place and unused code
// paths are removed separately, once nothing depends on it (see
// docs/swiftui-backend-preparation-plan.md's expand/backfill/switch/contract
// rollout rule — dropping it is a later, separate "contract" change).
export const stravaWebhooks = pgTable(
  'strava_webhooks',
  {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: bigint('subscription_id', { mode: 'number' }),
    verifyToken: text('verify_token').notNull(),
    callbackUrl: text('callback_url').notNull().unique(),
    resourceState: integer('resource_state'),
    applicationId: integer('application_id'),
    verified: boolean('verified').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('strava_webhooks_subscription_id_idx').on(table.subscriptionId),
  ],
);

export type StravaWebhookSubscription = typeof stravaWebhooks.$inferSelect;

export const webhookEventStatusEnum = pgEnum('webhook_event_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'dead_letter',
]);

// Durable inbox for inbound Strava webhook deliveries (see issue #124). A
// unique key on (subscriptionId, objectType, objectId, aspectType,
// eventTime) makes duplicate Strava deliveries create exactly one row.
// This table is purely additive in this migration; the application code
// that reads/writes it lands in a follow-up change once this migration has
// shipped.
export const stravaWebhookEvents = pgTable(
  'strava_webhook_events',
  {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: bigint('subscription_id', { mode: 'number' }).notNull(),
    // `objectType`/`aspectType` are Strava's own small closed vocabularies
    // (`WebhookRequest`'s `object_type`/`aspect_type` unions), but are kept
    // as `text` rather than a `pgEnum` on purpose: the payload is already
    // validated against that union at the route boundary before a row is
    // ever inserted (see `webhook-schema.ts`), and Strava adding a new
    // value in the future would otherwise require a schema migration
    // before webhooks could be accepted at all.
    objectType: text('object_type').notNull(),
    objectId: bigint('object_id', { mode: 'number' }).notNull(),
    aspectType: text('aspect_type').notNull(),
    ownerId: bigint('owner_id', { mode: 'number' }).notNull(),
    eventTime: timestamp('event_time', { mode: 'date' }).notNull(),
    payload: jsonb('payload').$type<WebhookRequest>().notNull(),
    status: webhookEventStatusEnum('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { mode: 'date' })
      .defaultNow()
      .notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('strava_webhook_events_delivery_idx').on(
      table.subscriptionId,
      table.objectType,
      table.objectId,
      table.aspectType,
      table.eventTime,
    ),
    index('strava_webhook_events_status_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export type StravaWebhookEventRow = typeof stravaWebhookEvents.$inferSelect;

// One-time codes for the mobile OAuth exchange (issue #121, see
// docs/swiftui-backend-preparation-plan.md, "Authentication design"). A
// row is created after the Strava OAuth round trip completes for a browser
// session started by `/api/v1/auth/mobile/start`, and is consumed exactly
// once by `POST /api/v1/auth/mobile/exchange`.
//
// `codeHash` (never the plaintext code) is what a lookup matches against,
// the same "store a hash, not the secret" rule already used for Strava
// webhook verification. `sessionBearerToken` holds the already-signed
// Better Auth bearer session token that `/mobile/callback` obtained via
// `getSessionCookie()` from the just-completed OAuth sign-in - this table
// is what carries that value from the callback redirect (issue #121 does
// not put it in the redirect URL or expose it before the code is
// exchanged) through to the exchange response. It is cleared the moment
// the row is consumed or found expired, so it never outlives the code's
// own short TTL.
export const mobileLoginCodes = pgTable(
  'mobile_login_codes',
  {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    codeHash: text('code_hash').notNull(),
    state: text('state').notNull(),
    pkceChallenge: text('pkce_challenge').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionBearerToken: text('session_bearer_token'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { mode: 'date' }),
  },
  (table) => [
    uniqueIndex('mobile_login_codes_code_hash_idx').on(table.codeHash),
    index('mobile_login_codes_expires_at_idx').on(table.expiresAt),
  ],
);

export type MobileLoginCode = typeof mobileLoginCodes.$inferSelect;

// Small closed vocabularies for the change feed below, following the same
// `pgEnum` convention as `sport_type`/`webhook_event_status` rather than
// `text` (unlike `strava_webhook_events.objectType`/`aspectType`, these are
// this application's own vocabulary, not an external API's, so there is no
// risk of a third party adding a new value out from under a migration).
export const syncEntityTypeEnum = pgEnum('sync_entity_type', [
  'activity',
  'photo',
]);
export const syncOperationEnum = pgEnum('sync_operation', ['upsert', 'delete']);

// Append-only, monotonically-sequenced change feed for the native sync
// protocol (issue #122; see docs/swiftui-backend-preparation-plan.md's
// "Synchronization protocol" section). `sequence` - never `changedAt` alone -
// is the source of truth for ordering: two mutations committed within the
// same clock tick (or across a clock adjustment) can share a `changed_at`
// value, so a "changes after cursor X" query that compared timestamps could
// silently skip or duplicate a row at a page boundary. `generatedAlwaysAsIdentity()`
// guarantees `sequence` is strictly increasing and gap-tolerant (a rolled-back
// insert simply burns a value, which is fine for ordering purposes).
//
// Every insert into this table must happen in the same database transaction
// as the `activities`/`photos` mutation it records - see the call sites
// wired up in `src/server/repositories/activities.ts` (`upsertOne`,
// `deleteManyForAthlete`), `src/server/strava/webhook.ts`
// (`processWebhookEvent`), and `src/server/strava/sync.ts` (the
// not-found/tombstone branch) - so that a mutation can never commit without
// its change entry, and a failed change-entry insert always rolls the
// mutation back with it.
//
// Scoped by `athlete_id` (bigint), not `user_id` (text) as the plan doc's
// illustrative schema shows: `activities.athlete` and `photos.athlete_id`
// are already the athlete-scoping column everywhere in this schema (and
// `Actor.athleteId` is what every mutation call site already has on hand),
// so keying the change feed the same way avoids an extra `users` join on
// every single mutation. `users.athlete_id` is unique, so this is a 1:1
// substitution for `user_id`.
export const syncChanges = pgTable(
  'sync_change',
  {
    sequence: bigint('sequence', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    athleteId: bigint('athlete_id', { mode: 'number' })
      .notNull()
      .references(() => users.athlete_id, { onDelete: 'cascade' }),
    entityType: syncEntityTypeEnum('entity_type').notNull(),
    // `text`, not a typed id column: this one column has to hold both
    // `activities.id` (bigint-as-number) and `photos.unique_id` (varchar)
    // entity ids depending on `entityType`, and the plan doc's schema
    // specifies `entity_id text` for exactly this reason. It intentionally
    // carries no foreign key - a deletion's change row must stay queryable
    // (see the "deletions remain observable" test) after the row it refers
    // to no longer exists.
    entityId: text('entity_id').notNull(),
    operation: syncOperationEnum('operation').notNull(),
    changedAt: timestamp('changed_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    // Primary access pattern for the future #123 delta endpoint: "changes
    // for this athlete after sequence N", strictly ordered by `sequence`.
    index('sync_change_athlete_sequence_idx').on(
      table.athleteId,
      table.sequence,
    ),
    // Supports the retention policy's age-based compaction/eligibility
    // query (see `src/server/repositories/changes.ts`).
    index('sync_change_changed_at_idx').on(table.changedAt),
  ],
);

export type SyncChange = typeof syncChanges.$inferSelect;
export type SyncEntityType = (typeof syncEntityTypeEnum.enumValues)[number];
export type SyncOperation = (typeof syncOperationEnum.enumValues)[number];

// Athlete-created, scoped, expiring private share links (issue #132; see
// docs/strava-data-policy.md §5). Replaces the retired `/map?user=...` and
// `/map?activities=<public_id,...>` flows, which had no expiry, no
// revocation, and used `public_id` - a deterministic, guessable hash - as
// their only "access control".
//
// `tokenHash` is the *only* representation of the capability token this
// table ever stores - the raw, high-entropy token
// (`~/server/sharing/tokens.ts`) is returned to the creating athlete exactly
// once, at creation, and is never persisted anywhere. `expiresAt` is
// `NOT NULL`: every share has a mandatory, bounded-maximum expiry enforced
// by `~/server/sharing/validators.ts`, never an unbounded or optional one.
// `revokedAt` records immediate, athlete-initiated revocation, independent
// of `expiresAt`.
//
// `athleteId` follows the same `users.athlete_id`-scoped, `onDelete:
// 'cascade'` convention as `activities.athlete`/`syncChanges.athleteId`
// above, so the 30-day deauthorization erasure transaction
// (`~/server/repositories/erasure.ts`) deletes every share row for an
// erased athlete automatically, with no separate delete statement needed -
// see `~/server/db/schema.share-links.test.ts`, which asserts this cascade
// wiring directly against the Drizzle table config. Immediate invalidation
// on deauthorization (before the 30-day erasure runs) is a separate,
// read-time check in `~/server/application/share-links.ts`
// (`isAthleteRevoked`), since `accounts.revokedAt` is set the moment Strava
// reports the deauthorization, well before erasure is due.
export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    athleteId: bigint('athlete_id', { mode: 'number' })
      .notNull()
      .references(() => users.athlete_id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    // Explicit, athlete-chosen field-disclosure groups
    // (`ShareLinkFieldOptions`) - every group defaults to `false` (excluded)
    // both here and in the creation input schema. See
    // `~/lib/sharing/fields.ts`.
    fields: jsonb('fields').$type<ShareLinkFieldOptions>().notNull(),
  },
  (table) => [
    uniqueIndex('share_links_token_hash_idx').on(table.tokenHash),
    index('share_links_athlete_idx').on(table.athleteId, table.createdAt),
  ],
);

export type ShareLink = typeof shareLinks.$inferSelect;

// The explicit activity subset a share link covers - a join table, never an
// "everything" wildcard, so issue #132's "every share covers an explicit
// activity subset" acceptance criterion is a schema-level guarantee, not
// just an application-layer convention. `activityId` has a real foreign key
// (`onDelete: 'cascade'`) to `activities.id`: when
// `~/server/repositories/activities.ts`'s `deleteManyForAthlete` hard-deletes
// an activity, the row here disappears in the same transaction, which is
// what makes "invalidate affected links when an activity is deleted" happen
// automatically rather than needing a manual cleanup step. "Loses
// visibility" (an activity later marked `private`) does *not* delete
// anything here - it has no tombstone - so that case is instead a read-time
// filter in `~/server/application/share-links.ts`'s `getShareView`.
export const shareLinkActivities = pgTable(
  'share_link_activities',
  {
    shareId: text('share_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    activityId: bigint('activity_id', { mode: 'number' })
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.shareId, table.activityId] }),
    index('share_link_activities_activity_idx').on(table.activityId),
  ],
);

export type ShareLinkActivity = typeof shareLinkActivities.$inferSelect;

// Fixed-window rate-limit counters for the `/api/v1/*` boundary (issue
// #127). This stack has no Redis in its dependency tree, so a small
// Postgres-backed table - consistent with this codebase's repository
// pattern - is the self-hosted primitive rather than a new managed
// service. `key` already encodes which limit it belongs to (e.g.
// `session:<hash>`, `user:<hash>`, or `ip:<hash>`, see
// `~/server/http/rate-limit.ts`),
// and `windowStart` is the fixed-window boundary a request's timestamp
// falls into, so `(key, windowStart)` is exactly the counter a request
// needs to atomically increment-and-read. Rows age out on their own; the
// `/api/cron/cleanup-rate-limits` job (see that route) periodically deletes
// windows old enough that no in-flight request could still reference them.
export const apiRateLimitBuckets = pgTable(
  'api_rate_limit_bucket',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { mode: 'date' }).notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index('api_rate_limit_bucket_window_start_idx').on(table.windowStart),
  ],
);

export type ApiRateLimitBucket = typeof apiRateLimitBuckets.$inferSelect;

export { sportTypes, type SportType };
