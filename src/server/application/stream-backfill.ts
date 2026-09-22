import 'server-only';
import {
  classifyStreamFetchFailure,
  fetchActivityStreams,
  type StreamSourceFactory,
} from './activity-streams';
import {
  ActivityStreamsUnavailableError,
  type ActivityStreamsRepository,
} from '~/server/repositories/activity-streams';
import {
  createStreamBackfillRepository,
  type StreamBackfillRepository,
} from '~/server/repositories/stream-backfill';
import { createStravaRequestBudget } from '~/server/repositories/strava-budget';
import {
  StravaBudgetExceededError,
  type StravaRequestBudget,
} from '~/server/strava/request-budget';
import {
  STREAM_BACKFILL_DEFAULT_ACTIVITIES,
  STREAM_BACKFILL_DEFAULT_REQUESTS,
  STREAM_BACKFILL_TIME_MS,
  StreamBackfillStopped,
  validateBackfillLimits,
  type BackfillStopReason,
} from '~/server/strava/stream-backfill-policy';

export type StreamBackfillResult = {
  selected: number;
  fetched: number;
  unavailable: number;
  retried: number;
  failed: number;
  requests: number;
  remainingBacklog: number;
  stopReason: BackfillStopReason;
  elapsedMs: number;
};

// Extra headroom belongs to foreground/webhook/reconciliation callers, which
// use the same durable counters but the ordinary 25/100 reserve.
const backgroundBudget = createStravaRequestBudget(undefined, undefined, {
  fifteenMinutes: 50,
  daily: 200,
});

export async function backfillActivityStreams({
  activityLimit = STREAM_BACKFILL_DEFAULT_ACTIVITIES,
  requestLimit = STREAM_BACKFILL_DEFAULT_REQUESTS,
  timeMs = STREAM_BACKFILL_TIME_MS,
  repository = createStreamBackfillRepository(),
  streamRepository,
  requestBudget = backgroundBudget,
  createSource,
  clock = Date.now,
}: {
  activityLimit?: number;
  requestLimit?: number;
  timeMs?: number;
  repository?: StreamBackfillRepository;
  streamRepository?: ActivityStreamsRepository;
  requestBudget?: StravaRequestBudget;
  createSource?: StreamSourceFactory;
  clock?: () => number;
} = {}): Promise<StreamBackfillResult> {
  validateBackfillLimits(activityLimit, requestLimit, timeMs);
  const startedAt = clock();
  const deadline = startedAt + timeMs;
  const signal = AbortSignal.timeout(timeMs);
  const result: StreamBackfillResult = {
    selected: 0,
    fetched: 0,
    unavailable: 0,
    retried: 0,
    failed: 0,
    requests: 0,
    remainingBacklog: 0,
    stopReason: 'complete',
    elapsedMs: 0,
  };
  const checkTime = () => {
    if (clock() >= deadline || signal.aborted)
      throw new StreamBackfillStopped('deadline');
  };
  const run = await repository.start(activityLimit, requestLimit);
  if (typeof run === 'string') {
    result.stopReason = run;
  } else {
    const assertActive = async () => {
      checkTime();
      await repository.assertActive(run);
      checkTime();
    };
    const budget: StravaRequestBudget = {
      async reserve(read) {
        await assertActive();
        // Reserve durably before every outbound operation (including OAuth).
        // A crash or rejected shared reservation consumes the slot conservatively.
        await repository.reserveRequest(run);
        result.requests++;
        return requestBudget.reserve(read);
      },
      observe: (ticket, usage, status) =>
        requestBudget.observe(ticket, usage, status),
    };
    try {
      while (true) {
        await assertActive();
        const candidate = await repository.claimNext(run);
        if (!candidate) break;
        result.selected++;
        if (candidate.attemptCount > 1) result.retried++;
        try {
          const fetched = await fetchActivityStreams(
            candidate.actor,
            candidate.activityId,
            {
              repository: streamRepository,
              createSource,
              requestBudget: budget,
              now: () => new Date(clock()),
              signal,
              assertActive,
              onClaim: (claim) =>
                repository.attachGeneration(run, candidate, claim.generation),
            },
          );
          if (fetched.status === 'fetched') {
            result.fetched++;
            if (fetched.snapshot.availableTypes.length === 0)
              result.unavailable++;
          } else if (fetched.status === 'superseded') result.unavailable++;
          await repository.finishAttempt(run, candidate, null);
        } catch (error) {
          if (error instanceof ActivityStreamsUnavailableError) {
            result.unavailable++;
            await repository.finishAttempt(run, candidate, null);
            continue;
          }
          // Self-imposed stops release the activity without an error or
          // backoff; it stays eligible for the next run.
          if (error instanceof StreamBackfillStopped) {
            await repository.finishAttempt(run, candidate, null);
            throw error;
          }
          if (signal.aborted || clock() >= deadline) {
            await repository.finishAttempt(run, candidate, null);
            throw new StreamBackfillStopped('deadline');
          }
          const failure = classifyStreamFetchFailure(error);
          // Durable safe classification only; never persist upstream bodies/tokens.
          await repository.finishAttempt(run, candidate, failure);
          if (failure.code === 'unauthorized') {
            // Credentials, not this activity, are the problem: skip the
            // account until they change instead of failing each activity.
            await repository.blockAccount(run, candidate);
            result.failed++;
            continue;
          }
          if (
            error instanceof StravaBudgetExceededError ||
            failure.code === 'rate_limited'
          )
            throw new StreamBackfillStopped('rate_limit');
          result.failed++;
        }
      }
    } catch (error) {
      if (!(error instanceof StreamBackfillStopped)) throw error;
      result.stopReason = error.reason;
    } finally {
      await repository.finish(run, result.stopReason);
    }
  }
  result.remainingBacklog = await repository.remainingBacklog();
  result.elapsedMs = Math.max(0, clock() - startedAt);
  return result;
}
