import {
  INGESTION_REASONS,
  type IngestionProgress,
  type IngestionReason,
  type IngestionRunOutcomeDTO,
  type IngestionScheduling,
  type IngestionStatusDTO,
} from '~/contracts/v1/ingestion-status';
import type { BackgroundJobRun, IngestionOutcomeRow } from '~/server/db/schema';
import type { IngestionSnapshot } from '~/server/repositories/ingestion-status';
import {
  INGESTION_JOB_MAX_RUN_MS,
  INGESTION_JOBS,
  type IngestionJob,
} from '~/server/strava/ingestion-policy';
import {
  STRAVA_FRESHNESS_LIMIT_MS,
  SUMMARY_RECONCILIATION_INTERVAL_MS,
} from '~/server/strava/summary-reconciliation';

/** A missed run or two is normal (deploys, GitHub delays); more is a stall. */
const STALL_GRACE_MS = 15 * 60_000;

export type JobState = 'active' | 'disabled' | 'stalled' | 'unknown';

/**
 * What a job's heartbeat says about its scheduler. Neither the GitHub
 * schedule nor its repository variables are observable from the server, so a
 * job that has never reported is `unknown` and one that stopped reporting is
 * `stalled`; neither is proof of the other gate's setting.
 */
export function jobState(
  job: IngestionJob,
  run: BackgroundJobRun | undefined,
  now: Date,
  serverEnabled = true,
): JobState {
  if (!serverEnabled) return 'disabled';
  if (!run) return 'unknown';
  if (run.lastStatus === 'disabled') return 'disabled';
  const sinceStart = now.getTime() - run.lastStartedAt.getTime();
  if (run.lastStatus === 'running' && sinceStart > INGESTION_JOB_MAX_RUN_MS)
    return 'stalled';
  return sinceStart > 2 * INGESTION_JOBS[job].intervalMs + STALL_GRACE_MS
    ? 'stalled'
    : 'active';
}

type Scheduling = {
  scheduling: IngestionScheduling;
  schedulingReason: IngestionReason | null;
  retryAt: string | null;
};

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const schedule = (
  scheduling: IngestionScheduling,
  schedulingReason: IngestionReason | null = null,
  retryAt: Date | null = null,
): Scheduling => ({ scheduling, schedulingReason, retryAt: iso(retryAt) });

/** A job that is not running normally explains outstanding work first. */
function fromJob(state: JobState): Scheduling | null {
  return state === 'active' ? null : schedule(state);
}

/** Stored reasons outside today's vocabulary are reported as unknown. */
const knownReason = (reason: string | null): IngestionReason | null =>
  (INGESTION_REASONS as readonly string[]).includes(reason ?? '')
    ? (reason as IngestionReason)
    : null;

function runOutcome(
  row: IngestionOutcomeRow | undefined,
): IngestionRunOutcomeDTO | null {
  if (!row) return null;
  return {
    outcome: row.outcome,
    reason: knownReason(row.reason),
    attemptedAt: row.lastAttemptAt.toISOString(),
    lastSucceededAt: iso(row.lastSucceededAt),
    retryAt: iso(row.retryAt),
  };
}

/**
 * Credentials block a pipeline when the account is disconnected, or when its
 * last run was rejected and nothing about the grant has changed since.
 */
function credentialBlock(
  snapshot: IngestionSnapshot,
  row: IngestionOutcomeRow | undefined,
): Scheduling | null {
  if (!snapshot.account.connected)
    return schedule('blocked', 'credentials_unavailable');
  if (
    row?.outcome === 'blocked' &&
    (!snapshot.account.updatedAt ||
      row.lastAttemptAt >= snapshot.account.updatedAt)
  )
    return schedule('blocked', knownReason(row.reason));
  return null;
}

/**
 * Derive the v1 status from an account snapshot. Pure: everything time- or
 * configuration-dependent comes in through `snapshot` and `options`.
 */
export function deriveIngestionStatus(
  snapshot: IngestionSnapshot,
  options: { streamBackfillEnabled: boolean },
): IngestionStatusDTO {
  const now = snapshot.observedAt;
  const { activities, photos, streams, history } = snapshot;
  const job = (name: IngestionJob, enabled = true) =>
    jobState(name, snapshot.jobs[name], now, enabled);

  // --- History: discovery is complete only after a confirmed full scan ---
  const lastCompleted = history.lastSummaryReconciledAt;
  const historyComplete = lastCompleted !== null;
  const age = lastCompleted ? now.getTime() - lastCompleted.getTime() : null;
  const freshness =
    age === null
      ? 'never_completed'
      : age >= STRAVA_FRESHNESS_LIMIT_MS
        ? 'overdue'
        : age >= SUMMARY_RECONCILIATION_INTERVAL_MS
          ? 'due'
          : 'current';
  const historyOutcome = snapshot.outcomes.history;
  const historyWork = history.scan !== null || freshness !== 'current';
  const historyProgress: IngestionProgress = historyComplete
    ? 'complete'
    : history.scan
      ? 'in_progress'
      : 'not_started';

  // --- Details ---
  const pending = activities.neverDetailed + activities.invalidated;
  const detailsOutcome = snapshot.outcomes.details;
  const detailsProgress: IngestionProgress =
    pending > 0
      ? activities.detailed > 0 || detailsOutcome
        ? 'in_progress'
        : 'not_started'
      : activities.total > 0 || historyComplete
        ? 'complete'
        : 'not_started';

  // --- Photos: no automatic job refreshes stale photo metadata today ---
  const stalePhotos = photos.refreshRequired + photos.unknown;

  // --- Streams ---
  const streamBlocked =
    !snapshot.account.connected || snapshot.account.streamCredentialsBlocked;
  const blockedStreams = streamBlocked ? streams.runnable + streams.waiting : 0;
  const runnableStreams = streamBlocked ? 0 : streams.runnable;
  const waitingStreams = streamBlocked ? 0 : streams.waiting;
  const fetchedStreams = streams.withData + streams.withoutData;
  const outstandingStreams = runnableStreams + waitingStreams + blockedStreams;

  return {
    observedAt: now.toISOString(),
    history: {
      progress: historyProgress,
      ...(historyWork
        ? (credentialBlock(snapshot, historyOutcome) ??
          fromJob(job('reconcile-strava-summaries')) ??
          schedule('scheduled'))
        : schedule('idle')),
      lastOutcome: runOutcome(historyOutcome),
      knownActivityCount: activities.total,
      totalActivityCount: historyComplete ? activities.total : null,
      oldestActivityStart: iso(activities.oldestStartDate),
      newestActivityStart: iso(activities.newestStartDate),
      reconciliation: {
        phase: history.scan?.phase ?? 'idle',
        pagesScanned: history.scan
          ? history.scan.phase === 'confirming'
            ? null
            : history.scan.nextPage - 1
          : null,
        scanStartedAt: iso(history.scan?.scanStartedAt),
        lastCompletedAt: iso(lastCompleted),
        nextDueAt: lastCompleted
          ? new Date(
              lastCompleted.getTime() + SUMMARY_RECONCILIATION_INTERVAL_MS,
            ).toISOString()
          : null,
        freshness,
      },
    },
    details: {
      progress: detailsProgress,
      ...(pending === 0
        ? schedule('idle')
        : (credentialBlock(snapshot, detailsOutcome) ??
          (activities.detailRetryWaiting === pending
            ? schedule(
                'waiting',
                'detail_failures',
                activities.detailNextRetryAt,
              )
            : null) ??
          fromJob(job('sync-activities')) ??
          schedule('scheduled'))),
      lastOutcome: runOutcome(detailsOutcome),
      detailed: activities.detailed,
      neverFetched: activities.neverDetailed,
      invalidated: activities.invalidated,
      retryWaiting: activities.detailRetryWaiting,
    },
    photos: {
      progress:
        stalePhotos === 0
          ? 'complete'
          : photos.current > 0
            ? 'in_progress'
            : 'not_started',
      ...(stalePhotos === 0 ? schedule('idle') : schedule('not_scheduled')),
      activitiesWithPhotos: photos.activitiesWithPhotos,
      activitiesWithStoredPhotos: photos.activitiesWithStoredPhotos,
      current: photos.current,
      refreshRequired: photos.refreshRequired,
      unknown: photos.unknown,
      photoCount: photos.photoCount,
    },
    streams: {
      // Terminal failures are finished work, but never "not runnable yet".
      progress:
        outstandingStreams === 0
          ? activities.total > 0 || historyComplete
            ? 'complete'
            : 'not_started'
          : fetchedStreams + streams.failed > 0
            ? 'in_progress'
            : 'not_started',
      ...(outstandingStreams === 0
        ? schedule('idle')
        : streamBlocked
          ? schedule(
              'blocked',
              snapshot.account.connected ? 'unauthorized' : 'credentials_unavailable',
            )
          : (fromJob(
              job('backfill-activity-streams', options.streamBackfillEnabled),
            ) ??
            (runnableStreams === 0
              ? schedule('waiting', null, streams.nextRetryAt)
              : schedule('scheduled')))),
      withData: streams.withData,
      withoutData: streams.withoutData,
      runnable: runnableStreams,
      waiting: waitingStreams,
      blocked: blockedStreams,
      failed: streams.failed,
      invalidated: streams.invalidated,
      chartSummaries: streams.chartSummaries,
    },
  };
}
