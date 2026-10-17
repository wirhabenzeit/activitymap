import 'server-only';

import type { Actor } from '~/server/auth/actor';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { resolveAccountTokens } from '~/server/db/account-token-normalization';
import { evaluateRateLimit, userKeyFor } from '~/server/http/rate-limit';
import { findActiveStravaAccount } from '~/server/repositories/account-lifecycle';
import { activitiesRepository } from '~/server/repositories/activities';
import { ingestionRepository } from '~/server/repositories/ingestion';
import { rateLimitRepository } from '~/server/repositories/rate-limit';
import { createStravaRequestBudget } from '~/server/repositories/strava-budget';
import {
  StravaClient,
  StravaApiError,
  type StravaTokens,
} from '~/server/strava/client';
import {
  StravaBudgetExceededError,
  StravaBudgetBusyError,
  type StravaRequestBudget,
} from '~/server/strava/request-budget';
import { fetchStravaActivities } from '~/server/strava/service';
import type {
  ActivityImportCursor,
  ActivityImportProgress,
} from '~/server/strava/activity-import-policy';
import { updateIncompleteActivities } from '~/server/strava/sync';

export const SIGNUP_WARMUP_TIME_MS = 35_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 3;
const MAX_DETAILS = 5;
const MAX_REQUESTS = 20;

// Yield before ordinary interactive requests and the scheduled catch-up jobs.
const backgroundBudget = createStravaRequestBudget(undefined, undefined, {
  fifteenMinutes: 50,
  daily: 200,
  maxInFlight: 4,
});

type StopReason =
  | 'complete'
  | 'busy'
  | 'account_unavailable'
  | 'request_limit'
  | 'deadline'
  | 'rate_limit'
  | 'detail_failed';
// Existing ingestion code treats quota stops as run-level deferrals, so a
// warmup deadline/request cap must never add a per-activity failure backoff.
class WarmupStopped extends StravaBudgetExceededError {
  constructor(readonly reason: StopReason) {
    super(1);
    this.message = `Signup warmup stopped: ${reason}`;
  }
}

export type SignupWarmupDeps = {
  enabled?: boolean;
  timeMs?: number;
  clock?: () => number;
  resolveAccount?: typeof findActiveStravaAccount;
  rateLimits?: Pick<typeof rateLimitRepository, 'incrementAndGet'>;
  activitiesRepo?: typeof activitiesRepository;
  ingestion?: Pick<
    typeof ingestionRepository,
    'findDetailCandidates' | 'recordDetailFailures' | 'clearDetailAttempts'
  >;
  fetchActivities?: typeof fetchStravaActivities;
  requestBudget?: StravaRequestBudget;
};

/** Best-effort acceleration; the durable scheduled workers own eventual catch-up. */
async function fetchActivityBatchForActor(
  actor: Actor,
  initialCount: number,
  deps: SignupWarmupDeps & { batch?: ManualActivityBatch } = {},
) {
  let cursor = deps.batch?.cursor ?? null;
  let photoCount = 0;
  const result = {
    summaries: 0,
    details: 0,
    requests: 0,
    stopReason: 'complete' as StopReason,
  };
  if (!(deps.enabled ?? stravaAccessEnabled()) || initialCount === 0)
    return result;
  const clock = deps.clock ?? Date.now;
  const timeMs = Math.min(
    deps.timeMs ?? SIGNUP_WARMUP_TIME_MS,
    SIGNUP_WARMUP_TIME_MS,
  );
  if (timeMs <= 0) return { ...result, stopReason: 'deadline' as const };
  const deadline = clock() + timeMs;
  const signal = AbortSignal.timeout(timeMs);
  let stoppedReason: StopReason | null = null;
  const stop = (reason: StopReason): never => {
    stoppedReason = reason;
    throw new WarmupStopped(reason);
  };
  const checkTime = () => {
    if (signal.aborted || clock() >= deadline) stop('deadline');
  };
  const rateLimits = deps.rateLimits ?? rateLimitRepository;
  const now = new Date(clock());
  // Database counters deduplicate concurrent browser/mobile imports and cap
  // dispatch across instances. They do not reset after a worker crashes.
  if (
    !deps.batch &&
    (!(
      await evaluateRateLimit(
        rateLimits,
        `signup-warmup:${userKeyFor(actor.userId)}`,
        { limit: 1, windowMs: 3_600_000 },
        now,
      )
    ).allowed ||
      !(
        await evaluateRateLimit(
          rateLimits,
          'signup-warmup:global',
          { limit: 1, windowMs: 60_000 },
          now,
        )
      ).allowed)
  )
    return { ...result, stopReason: 'busy' as const };

  const resolveAccount = deps.resolveAccount ?? findActiveStravaAccount;
  const account = await resolveAccount(actor.userId);
  const tokens = account ? resolveAccountTokens(account) : null;
  if (
    account?.userId !== actor.userId ||
    account.revokedAt ||
    account.accountId !== String(actor.athleteId) ||
    !tokens?.accessToken ||
    !tokens?.expiresAtDate ||
    (tokens.expiresAtDate.getTime() <= clock() && !deps.batch)
  )
    return { ...result, stopReason: 'account_unavailable' as const };
  let accessToken = tokens.accessToken;
  const activitiesRepo = deps.activitiesRepo ?? activitiesRepository;
  const ingestion = deps.ingestion ?? ingestionRepository;
  const fetchActivities = deps.fetchActivities ?? fetchStravaActivities;
  const sharedBudget = deps.requestBudget ?? backgroundBudget;
  const budget: StravaRequestBudget = {
    async reserve(read) {
      checkTime();
      if (result.requests >= MAX_REQUESTS) stop('request_limit');
      // Charge before awaiting so parallel photo sizes cannot exceed the cap.
      result.requests++;
      try {
        return await sharedBudget.reserve(read);
      } catch (error) {
        if (error instanceof StravaBudgetBusyError) stoppedReason = 'busy';
        else if (error instanceof StravaBudgetExceededError) {
          stoppedReason = 'rate_limit';
          deps.batch?.onRateLimited(error.retryAfterSeconds);
        }
        throw error;
      }
    },
    observe: (ticket, usage, status) =>
      sharedBudget.observe(ticket, usage, status),
  };
  const clientOptions = {
    requestBudget: budget,
    signal,
    beforeRequest: async () => {
      checkTime();
      if (deps.batch && !(await deps.batch.isCurrent())) stop('busy');
      const current = await resolveAccount(actor.userId);
      if (
        current?.id !== account.id ||
        current.revokedAt ||
        current.userId !== actor.userId ||
        current.accountId !== String(actor.athleteId) ||
        resolveAccountTokens(current).accessToken !== accessToken
      )
        stop('account_unavailable');
    },
  };
  const client =
    deps.batch && tokens.refreshToken
      ? StravaClient.withTokens(
          accessToken,
          tokens.refreshToken,
          async (refreshed) => {
            if (!(await deps.batch!.replaceCredentials(accessToken, refreshed)))
              stop('account_unavailable');
            accessToken = refreshed.access_token;
          },
          clientOptions,
        )
      : StravaClient.withAccessToken(accessToken, clientOptions);
  const fetchBounded: typeof fetchStravaActivities = (input) => {
    checkTime();
    return fetchActivities(
      { ...input, ...(input.activityIds ? { requireExisting: true } : {}) },
      { createClient: () => client },
    ).then((fetched) => {
      photoCount += fetched.photos.length;
      return fetched;
    });
  };

  const report = async () => {
    await deps.batch?.onProgress({ ...result, photos: photoCount, cursor });
  };
  try {
    checkTime();
    if (deps.batch) {
      if (tokens.expiresAtDate.getTime() <= clock()) {
        if (!tokens.refreshToken) stop('account_unavailable');
        await client.refreshAccessToken();
      }
      const latest = await fetchBounded({
        accessToken,
        athleteId: actor.athleteId,
        page: 1,
        per_page: PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      result.summaries += latest.activities.length;
      await report();
    }
    const recent = await activitiesRepo.findManyByAthlete(actor.athleteId, {
      limit: PAGE_SIZE,
    });
    if (recent.length === 0) return result;
    const pending = new Set(
      await ingestion.findDetailCandidates(actor.athleteId, PAGE_SIZE),
    );
    // Give the newest five activities useful routes and photos before spending
    // the remaining budget on older history. Fetch one at a time to stop early.
    const candidates = deps.batch
      ? [...pending].slice(0, MAX_DETAILS)
      : recent
          .slice(0, MAX_DETAILS)
          .map((a) => a.id)
          .filter((id) => pending.has(id));
    for (const activityId of candidates) {
      checkTime();
      const enriched = await updateIncompleteActivities(
        actor.athleteId,
        accessToken,
        1,
        {
          activitiesRepo,
          ingestion: {
            ...ingestion,
            findDetailCandidates: async () => [activityId],
          },
          fetchActivities: fetchBounded,
        },
      );
      result.details += enriched.updated;
      await report();
      checkTime();
      if (enriched.outcome.outcome !== 'succeeded') {
        result.stopReason =
          stoppedReason ??
          (enriched.outcome.outcome === 'blocked'
            ? 'account_unavailable'
            : enriched.outcome.reason === 'rate_limited'
              ? 'rate_limit'
              : 'detail_failed');
        if (
          !deps.batch ||
          stoppedReason ||
          enriched.outcome.outcome === 'blocked' ||
          enriched.outcome.outcome === 'deferred'
        )
          return result;
      }
    }
    // A short first page already covers this athlete's history. Otherwise fix
    // the older-history boundary so new activities cannot shift later pages.
    // Include the boundary second to avoid losing activities with equal dates.
    if (initialCount >= PAGE_SIZE && !cursor?.done) {
      cursor ??= {
        before:
          Math.floor(
            Math.min(...recent.map((a) => a.start_date.getTime())) / 1000,
          ) + 1,
        page: 1,
        done: false,
      };
      await report();
      for (let fetchedPages = 0; fetchedPages < MAX_PAGES; fetchedPages++) {
        checkTime();
        const fetched = await fetchBounded({
          accessToken,
          athleteId: actor.athleteId,
          before: cursor.before,
          page: cursor.page,
          per_page: PAGE_SIZE,
          limit: PAGE_SIZE,
        });
        result.summaries += fetched.activities.length;
        cursor = {
          ...cursor,
          page: cursor.page + 1,
          done: fetched.activities.length < PAGE_SIZE,
        };
        await report();
        if (cursor.done) break;
      }
    }
  } catch (error) {
    if (signal.aborted || clock() >= deadline) result.stopReason = 'deadline';
    else if (error instanceof WarmupStopped) result.stopReason = error.reason;
    else if (
      error instanceof Error &&
      'status' in error &&
      error.status === 429
    )
      result.stopReason = 'rate_limit';
    else if (error instanceof StravaApiError && error.status === 401)
      result.stopReason = 'account_unavailable';
    else throw error;
  }
  await report();
  return result;
}

type ManualActivityBatch = {
  cursor: ActivityImportCursor | null;
  isCurrent: () => Promise<boolean>;
  replaceCredentials: (
    previousToken: string,
    tokens: StravaTokens,
  ) => Promise<boolean>;
  onRateLimited: (seconds: number) => void;
  onProgress: (progress: ActivityImportProgress) => Promise<void>;
};

export function warmSignupActivitiesForActor(
  actor: Actor,
  initialCount: number,
  deps: SignupWarmupDeps = {},
) {
  return fetchActivityBatchForActor(actor, initialCount, deps);
}

export function fetchManualActivityBatchForActor(
  actor: Actor,
  batch: ManualActivityBatch,
  deps: SignupWarmupDeps = {},
) {
  return fetchActivityBatchForActor(actor, PAGE_SIZE, { ...deps, batch });
}
