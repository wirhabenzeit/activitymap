import 'server-only';
import {
  createPhotoBackfillRepository,
  PhotoBackfillStopped,
  type PhotoBackfillRepository,
  type PhotoClaim,
} from '~/server/repositories/photo-backfill';
import { createStravaRequestBudget } from '~/server/repositories/strava-budget';
import { StravaClient } from '~/server/strava/client';
import {
  classifyIngestionFailure,
  CredentialUnavailableError,
} from '~/server/strava/ingestion-policy';
import type { StravaRequestBudget } from '~/server/strava/request-budget';
import { transformStravaPhoto } from '~/server/strava/transforms';
import type { Photo } from '~/server/db/schema';

type SourceOptions = {
  claim: PhotoClaim;
  now: Date;
  requestBudget: StravaRequestBudget;
  signal: AbortSignal;
  beforeRequest: () => Promise<void>;
  onRefresh: Parameters<typeof StravaClient.withRefreshToken>[1];
};
export type PhotoSourceFactory = (
  options: SourceOptions,
) => Pick<StravaClient, 'getActivityPhotos'>;
const createSource: PhotoSourceFactory = ({ claim, now, ...options }) => {
  const { tokens } = claim;
  if (tokens.accessToken && tokens.expiresAtDate && tokens.expiresAtDate > now)
    return StravaClient.withAccessToken(tokens.accessToken, options);
  if (tokens.refreshToken)
    return StravaClient.withRefreshToken(
      tokens.refreshToken,
      options.onRefresh,
      options,
    );
  throw new CredentialUnavailableError();
};
const backgroundBudget = createStravaRequestBudget(undefined, undefined, {
  fifteenMinutes: 50,
  daily: 200,
});
export type PhotoBackfillResult = {
  selected: number;
  fetched: number;
  failed: number;
  superseded: number;
  requests: number;
  stopReason: string;
};

/** Photo-only catch-up: never downloads activity details or image binaries. */
export async function backfillActivityPhotos({
  repository = createPhotoBackfillRepository(),
  sourceFactory = createSource,
  requestBudget = backgroundBudget,
  clock = Date.now,
  timeMs = 45_000,
}: {
  repository?: PhotoBackfillRepository;
  sourceFactory?: PhotoSourceFactory;
  requestBudget?: StravaRequestBudget;
  clock?: () => number;
  timeMs?: number;
} = {}): Promise<PhotoBackfillResult> {
  const result: PhotoBackfillResult = {
    selected: 0,
    fetched: 0,
    failed: 0,
    superseded: 0,
    requests: 0,
    stopReason: 'complete',
  };
  const token = await repository.start();
  if (!token) return { ...result, stopReason: 'busy' };
  const deadline = clock() + timeMs;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(timeMs),
  ]);
  const checkTime = () => {
    if (signal.aborted || clock() >= deadline)
      throw new PhotoBackfillStopped('deadline');
  };
  const budget: StravaRequestBudget = {
    async reserve(read) {
      checkTime();
      await repository.reserveRequest(token);
      result.requests++;
      return requestBudget.reserve(read);
    },
    observe: (ticket, usage, status) =>
      requestBudget.observe(ticket, usage, status),
  };
  const excludedUsers: string[] = [];
  try {
    while (true) {
      checkTime();
      let claim = await repository.claimNext(token, excludedUsers);
      if (!claim) break;
      result.selected++;
      try {
        const source = sourceFactory({
          claim,
          now: new Date(clock()),
          requestBudget: budget,
          signal,
          beforeRequest: async () => {
            checkTime();
            if (!(await repository.isCurrent(claim!)))
              throw new PhotoBackfillStopped('superseded');
          },
          onRefresh: async (tokens) => {
            const updated = await repository.replaceCredentials(claim!, tokens);
            if (!updated) throw new PhotoBackfillStopped('superseded');
            claim = updated;
          },
        });
        const raw = await source.getActivityPhotos(claim.activityId);
        const photos = raw
          .map((photo) => transformStravaPhoto(photo, claim!.athleteId))
          .filter((photo): photo is Photo => photo !== null);
        checkTime();
        if (await repository.complete(claim, photos)) result.fetched++;
        else {
          result.superseded++;
          await repository.release(claim, null);
        }
      } catch (error) {
        if (error instanceof PhotoBackfillStopped || signal.aborted) {
          await repository.release(claim, null);
          if (
            error instanceof PhotoBackfillStopped &&
            error.reason === 'superseded'
          ) {
            result.superseded++;
            continue;
          }
          throw error;
        }
        const failure = classifyIngestionFailure(error);
        if (failure.scope === 'account')
          await repository.blockAccount(claim, failure.reason);
        await repository.release(
          claim,
          failure.scope === 'activity' ? failure.code : null,
        );
        if (failure.scope === 'run')
          throw new PhotoBackfillStopped('rate_limited');
        result.failed++;
        if (failure.scope === 'account') excludedUsers.push(claim.userId);
      }
    }
  } catch (error) {
    if (signal.aborted) result.stopReason = 'deadline';
    else if (error instanceof PhotoBackfillStopped)
      result.stopReason = error.reason;
    else throw error;
  } finally {
    controller.abort();
    await repository.finish(token);
  }
  return result;
}
