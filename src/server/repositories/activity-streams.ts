import 'server-only';

import { resolveAccountTokens } from '~/server/auth/account-tokens';
import type { Actor } from '~/server/auth/actor';
import { findStravaAccountInternal } from '~/server/auth/users';
import type { StoredStreams } from '~/server/records';

export type StreamSnapshot = Omit<StoredStreams, 'activityId' | 'revision'> & {
  activityId: string;
  revision: string;
};
/** Everything but the raw samples: enough for metadata and the summary. */
export type StreamSummarySnapshot = Omit<StreamSnapshot, 'payload'>;
export type StreamSummaryRead = {
  activityId: string;
  /** Null when no recording is stored for the activity. */
  row: StreamSummarySnapshot | null;
};

export class ActivityStreamsUnavailableError extends Error {
  constructor() {
    super('Activity or eligible Strava account unavailable');
    this.name = 'ActivityStreamsUnavailableError';
  }
}

/** Reads of an account's stored recordings. */
export type ActivityStreamsRepository = {
  read(actor: Actor, activityId: string): Promise<StreamSnapshot | null>;
  readSummaries(
    actor: Actor,
    activityIds: string[],
  ): Promise<StreamSummaryRead[]>;
};

/**
 * Recordings are provider data: they are served only while the account is
 * connected. Throws when access was withdrawn, the account is scheduled for
 * erasure, or it holds no credentials.
 */
async function requireConnectedAccount(actor: Actor) {
  const account = await findStravaAccountInternal({ userId: actor.userId });
  if (
    account?.accountId !== String(actor.athleteId) ||
    account.revokedAt ||
    account.scheduledErasureAt
  )
    throw new ActivityStreamsUnavailableError();
  const tokens = resolveAccountTokens(account);
  if (!tokens.accessToken && !tokens.refreshToken)
    throw new ActivityStreamsUnavailableError();
}

/** `library`'s recordings, for an account that is still connected. */
export function connectedStreams(
  library: ActivityStreamsRepository,
): ActivityStreamsRepository {
  return {
    async read(actor, activityId) {
      await requireConnectedAccount(actor);
      return library.read(actor, activityId);
    },
    async readSummaries(actor, activityIds) {
      await requireConnectedAccount(actor);
      return library.readSummaries(actor, activityIds);
    },
  };
}
