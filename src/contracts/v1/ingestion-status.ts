import { z } from 'zod';
import { isoDateTime } from './primitives';

/**
 * `GET /api/v1/ingestion-status` (issue #297): the server's account-scoped
 * answer to "what has ActivityMap imported from Strava, what is still
 * pending, and why?". It describes Strava → ActivityMap only; a client's own
 * device/browser sync state is separate and never makes this complete.
 *
 * Each category reports three independent things that must not be collapsed
 * into one state: `progress` (how much is covered), `scheduling` (whether
 * automatic work will continue, and if not, why) and, where a pipeline
 * records one, `lastOutcome` (how the most recent run ended). Counts in a
 * category partition its population unless their description says they
 * overlap. See docs/ingestion-status.md.
 */

/**
 * - `succeeded`: the run committed its work without any failure. More work may
 *   remain; progress is reported separately.
 * - `partial`: some items committed and some failed.
 * - `deferred`: the run stopped before finishing because of a shared limit
 *   (rate limit or time budget); nothing failed.
 * - `failed`: the run could not make progress.
 * - `blocked`: Strava rejected or no longer has usable credentials for the
 *   account; only reconnecting can help.
 */
export const INGESTION_OUTCOMES = [
  'succeeded',
  'partial',
  'deferred',
  'failed',
  'blocked',
] as const;
export type IngestionOutcome = (typeof INGESTION_OUTCOMES)[number];

/** Safe, user-presentable reason codes. Never upstream bodies or messages. */
export const INGESTION_REASONS = [
  'rate_limited',
  'time_budget',
  'credentials_unavailable',
  'unauthorized',
  'upstream_error',
  'invalid_response',
  'detail_failures',
  'photo_refresh_failed',
  'history_fetch_failed',
  'persistence_failed',
  'internal_error',
] as const;
export type IngestionReason = (typeof INGESTION_REASONS)[number];

const count = z.number().int().nonnegative();

export const ingestionProgressSchema = z
  .enum(['not_started', 'in_progress', 'complete', 'unknown'])
  .describe('How much of this category is covered.');
export type IngestionProgress = z.infer<typeof ingestionProgressSchema>;

export const ingestionSchedulingSchema = z
  .enum([
    'idle',
    'scheduled',
    'waiting',
    'blocked',
    'disabled',
    'stalled',
    'not_scheduled',
    'unknown',
  ])
  .describe(
    'Whether automatic work continues: idle (nothing outstanding), scheduled ' +
      '(the job runs normally), waiting (until retryAt), blocked (reconnect ' +
      'Strava), disabled (switched off on the server), stalled (the job has ' +
      'stopped running), not_scheduled (no automatic job covers this work), ' +
      'unknown (the job has never been observed).',
  );
export type IngestionScheduling = z.infer<typeof ingestionSchedulingSchema>;

export const ingestionOutcomeSchema = z.enum(INGESTION_OUTCOMES);
export const ingestionReasonSchema = z.enum(INGESTION_REASONS);

export const ingestionRunOutcomeDTOSchema = z.object({
  outcome: ingestionOutcomeSchema,
  reason: ingestionReasonSchema.nullable(),
  attemptedAt: isoDateTime,
  /** The last run that finished without any failure, if any. */
  lastSucceededAt: isoDateTime.nullable(),
  retryAt: isoDateTime.nullable(),
});
export type IngestionRunOutcomeDTO = z.infer<typeof ingestionRunOutcomeDTOSchema>;

const schedulingFields = {
  scheduling: ingestionSchedulingSchema,
  /** Why scheduling is waiting, blocked or not progressing, when known. */
  schedulingReason: ingestionReasonSchema.nullable(),
  /** Earliest time waiting work becomes eligible again. Not a promise. */
  retryAt: isoDateTime.nullable(),
};

export const historyFreshnessSchema = z.enum([
  'never_completed',
  'current',
  'due',
  'overdue',
]);

export const ingestionHistoryDTOSchema = z.object({
  /** `complete` once one full Strava summary scan has been confirmed. */
  progress: ingestionProgressSchema,
  ...schedulingFields,
  lastOutcome: ingestionRunOutcomeDTOSchema.nullable(),
  /** Activities stored for this account. */
  knownActivityCount: count,
  /** Equal to `knownActivityCount` once discovery is complete; otherwise unknown. */
  totalActivityCount: count.nullable(),
  oldestActivityStart: isoDateTime.nullable(),
  newestActivityStart: isoDateTime.nullable(),
  reconciliation: z.object({
    phase: z.enum(['idle', 'scanning', 'confirming']),
    /** Summary pages already checkpointed by the scan in progress. */
    pagesScanned: count.nullable(),
    scanStartedAt: isoDateTime.nullable(),
    lastCompletedAt: isoDateTime.nullable(),
    nextDueAt: isoDateTime.nullable(),
    freshness: historyFreshnessSchema,
  }),
});

export const ingestionDetailsDTOSchema = z.object({
  progress: ingestionProgressSchema,
  ...schedulingFields,
  lastOutcome: ingestionRunOutcomeDTOSchema.nullable(),
  /** Partition of `knownActivityCount`: detailed + neverFetched + invalidated. */
  detailed: count,
  neverFetched: count,
  invalidated: count,
  /** Overlapping: pending activities backing off after a failed attempt. */
  retryWaiting: count,
});

export const ingestionPhotosDTOSchema = z.object({
  progress: ingestionProgressSchema,
  ...schedulingFields,
  /** Activities Strava reports as having photos. */
  activitiesWithPhotos: count,
  /** Activities in that population with at least one stored photo, regardless of freshness. Absent on older servers. */
  activitiesWithStoredPhotos: count.optional(),
  /** Partition of `activitiesWithPhotos` by photo metadata freshness. */
  current: count,
  refreshRequired: count,
  unknown: count,
  /** Photo metadata records stored; image files are not counted. */
  photoCount: count,
});

export const ingestionStreamsDTOSchema = z.object({
  progress: ingestionProgressSchema,
  ...schedulingFields,
  /**
   * Partition of `knownActivityCount`: withData + withoutData (fetched) and
   * runnable + waiting + blocked + failed (outstanding).
   */
  withData: count,
  withoutData: count,
  runnable: count,
  waiting: count,
  blocked: count,
  failed: count,
  /** Overlapping: outstanding activities whose earlier streams were invalidated. */
  invalidated: count,
  /** Overlapping: `withData` activities with a derived chart summary. */
  chartSummaries: count,
});

export const ingestionStatusDTOSchema = z.object({
  /** When the server observed this status. A snapshot, not a live value. */
  observedAt: isoDateTime,
  history: ingestionHistoryDTOSchema,
  details: ingestionDetailsDTOSchema,
  photos: ingestionPhotosDTOSchema,
  streams: ingestionStreamsDTOSchema,
});
export type IngestionStatusDTO = z.infer<typeof ingestionStatusDTOSchema>;

/** Clients should not poll faster than this; responses are privately cacheable for it. */
export const INGESTION_STATUS_MAX_AGE_SECONDS = 60;
