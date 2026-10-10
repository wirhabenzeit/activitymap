import {
  INITIAL_IMPORT_PAGE_SIZE,
  INITIAL_IMPORT_TARGET,
  type InitialImportDTO,
} from '~/contracts/v1/initial-import';
import type { Actor } from '~/server/auth/actor';
import { getAccountInternal } from '~/server/db/internal';
import {
  initialImportRepository,
  type InitialImportRepository,
  type InitialImportState,
} from '~/server/repositories/initial-import';
import { stravaAccessEnabled } from '~/server/config/external-effects';
import { StravaApiError, StravaClient } from '~/server/strava/client';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import { logger } from '~/server/logging/logger';

export function presentInitialImport(
  state: InitialImportState | null,
  now: Date,
): InitialImportDTO {
  const coolingDown = state?.retryAt && state.retryAt > now;
  const retryAt = coolingDown
    ? state.retryAt!.toISOString()
    : state?.leaseExpiresAt && state.leaseExpiresAt > now
      ? new Date(
          Math.min(state.leaseExpiresAt.getTime(), now.getTime() + 5000),
        ).toISOString()
      : null;
  return {
    phase: state?.completedAt
      ? state.startedAt && state.historyComplete && state.importedCount === 0
        ? 'empty'
        : 'ready'
      : coolingDown
        ? 'paused'
        : state?.message
          ? 'failed'
          : state?.startedAt
            ? 'importing'
            : 'not_started',
    importedCount: state?.importedCount ?? 0,
    target: INITIAL_IMPORT_TARGET,
    historyComplete: state?.historyComplete ?? false,
    retryAt,
    message: state?.message ?? null,
  };
}

type Dependencies = {
  repository?: InitialImportRepository;
  now?: () => Date;
  enabled?: () => boolean;
  resolveAccount?: typeof getAccountInternal;
  createSource?: (token: string) => Pick<StravaClient, 'getActivities'>;
};

/** Each call imports at most 50 summaries (one upstream request), never full details. */
export async function advanceInitialImport(
  actor: Actor,
  deps: Dependencies = {},
): Promise<InitialImportDTO> {
  const repository = deps.repository ?? initialImportRepository;
  const now = deps.now ?? (() => new Date());
  const existing = await repository.read(actor);
  if (existing?.completedAt || (existing?.retryAt && existing.retryAt > now()))
    return presentInitialImport(existing, now());
  if (!(deps.enabled ?? stravaAccessEnabled)())
    throw new Error('Strava access is unavailable in this environment.');
  const claim = await repository.claim(actor, now());
  if (!claim) return presentInitialImport(await repository.read(actor), now());
  try {
    const account = await (deps.resolveAccount ?? getAccountInternal)({
      userId: actor.userId,
    });
    if (
      !account?.access_token ||
      account.revokedAt ||
      account.accountId !== String(actor.athleteId)
    ) {
      await repository.fail(
        actor,
        claim,
        'Reconnect with Strava to import your activities.',
        null,
      );
    } else {
      const source = (
        deps.createSource ?? ((token) => StravaClient.withAccessToken(token))
      )(account.access_token);
      const page = await source.getActivities({
        before: claim.before,
        page: claim.nextPage,
        per_page: INITIAL_IMPORT_PAGE_SIZE,
      });
      await repository.commit(actor, claim, page, now());
    }
  } catch (error) {
    logger.warn('Initial activity import paused', {
      userId: actor.userId,
      page: claim.nextPage,
      error,
    });
    const blocked =
      error instanceof StravaApiError &&
      (error.status === 401 || error.status === 403);
    const rateLimited =
      error instanceof StravaBudgetExceededError ||
      (error instanceof StravaApiError && error.status === 429);
    const delay =
      error instanceof StravaBudgetExceededError
        ? Math.max(60, error.retryAfterSeconds)
        : rateLimited
          ? 900
          : 60;
    await repository.fail(
      actor,
      claim,
      blocked
        ? 'Reconnect with Strava to import your activities.'
        : rateLimited
          ? 'Strava is busy. Your imported activities are available; try again later.'
          : 'Could not import the next activities. Your progress is saved. Try again.',
      blocked ? null : new Date(now().getTime() + delay * 1000),
    );
  }
  return presentInitialImport(await repository.read(actor), now());
}
