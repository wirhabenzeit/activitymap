import 'server-only';

import { ZodError } from 'zod';
import type { Actor } from '~/server/auth/actor';
import {
  createActivityStreamsRepository,
  type ActivityStreamsRepository,
} from '~/server/repositories/activity-streams';
import {
  StravaApiError,
  StravaClient,
  type StravaRateLimitUsage,
} from '~/server/strava/client';
import {
  rawActivityStreamsSchema,
  streamActivityIdSchema,
  type StreamFetchFailure,
} from '~/server/strava/streams';

export function classifyStreamFetchFailure(error: unknown): StreamFetchFailure {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return { code: 'invalid_response', retryable: false };
  if (error instanceof StravaApiError) {
    if (error.status === 429) return { code: 'rate_limited', retryable: true };
    if (error.status === 401 || error.status === 403)
      return { code: 'unauthorized', retryable: false };
    if (error.status === 404) return { code: 'not_found', retryable: false };
    return { code: 'upstream_error', retryable: error.status >= 500 };
  }
  return { code: 'upstream_error', retryable: true };
}

class SupersededStreamFetchError extends Error {}

type StreamSource = Pick<StravaClient, 'getActivityStreams'>;
export type StreamSourceFactory = (options: {
  tokens: Extract<
    Awaited<ReturnType<ActivityStreamsRepository['begin']>>,
    { kind: 'fetch' }
  >['tokens'];
  now: Date;
  onRefresh: Parameters<typeof StravaClient.withRefreshToken>[1];
  onRateLimit?: (usage: StravaRateLimitUsage) => void;
}) => StreamSource;

export const createStreamSource: StreamSourceFactory = ({
  tokens,
  now,
  onRefresh,
  onRateLimit,
}) => {
  if (
    tokens.accessToken &&
    tokens.expiresAtDate &&
    tokens.expiresAtDate > now
  ) {
    return StravaClient.withAccessToken(tokens.accessToken, { onRateLimit });
  }
  if (tokens.refreshToken)
    return StravaClient.withRefreshToken(tokens.refreshToken, onRefresh, {
      onRateLimit,
    });
  throw new StravaApiError('No usable Strava credentials', 401);
};

/** Internal ingestion only; transport, invalidation and scheduling follow in #183/#184. */
export async function fetchActivityStreams(
  actor: Actor,
  activityId: string,
  options: {
    force?: boolean;
    repository?: ActivityStreamsRepository;
    createSource?: StreamSourceFactory;
    now?: () => Date;
    onRateLimit?: (usage: StravaRateLimitUsage) => void;
  } = {},
) {
  streamActivityIdSchema.parse(activityId);
  const repository = options.repository ?? createActivityStreamsRepository();
  const now = options.now ?? (() => new Date());
  const attempt = await repository.begin(
    actor,
    activityId,
    now(),
    options.force,
  );
  if (attempt.kind === 'cached')
    return { status: 'cached' as const, snapshot: attempt.snapshot };
  let claim = attempt.claim;
  let payload;
  try {
    const source = (options.createSource ?? createStreamSource)({
      tokens: attempt.tokens,
      now: now(),
      onRateLimit: options.onRateLimit,
      onRefresh: async (tokens) => {
        const current = await repository.replaceCredentials(claim, tokens);
        if (!current) throw new SupersededStreamFetchError();
        claim = current;
      },
    });
    payload = rawActivityStreamsSchema.parse(
      await source.getActivityStreams(activityId),
    );
  } catch (error) {
    if (error instanceof SupersededStreamFetchError)
      return { status: 'superseded' as const };
    const recorded = await repository.fail(
      claim,
      classifyStreamFetchFailure(error),
    );
    if (!recorded) return { status: 'superseded' as const };
    throw error;
  }
  const saved = await repository.commit(claim, payload, now());
  return saved
    ? { status: 'fetched' as const, snapshot: saved }
    : { status: 'superseded' as const };
}
