import type { Actor } from '~/server/auth/actor';
import {
  type ActivityStreamsRepository,
  ActivityStreamsUnavailableError,
} from '~/server/repositories/activity-streams';

type StreamReads = Pick<ActivityStreamsRepository, 'read' | 'readSummaries'>;

/**
 * Stream reads from a copy (Convex, for a production read owner), released
 * only for what the authority allows right now. Postgres decides who may
 * read streams: it knows a revoked or erased provider account and a deleted
 * activity at once, while the copy learns of them through the mirror, or not
 * at all. The check runs after the copy is read, so nothing captured before
 * it is sent.
 *
 * Once Convex writes the account's library it is no copy any more: Postgres
 * does not learn of new activities, and Convex serves only the account's
 * own. Postgres then still decides whether the account may read at all
 * (it holds the provider account), and no longer which activities.
 */
export function authorizedStreams(
  copy: StreamReads,
  authority: Pick<ActivityStreamsRepository, 'readable'>,
): StreamReads {
  const allowed = async (actor: Actor, activityIds: string[]) => {
    if (!actor.convexWrites) return authority.readable(actor, activityIds);
    // Throws when the provider account is not eligible.
    await authority.readable(actor, []);
    return new Set(activityIds);
  };
  return {
    async read(actor: Actor, activityId: string) {
      const row = await copy.read(actor, activityId);
      if (!(await allowed(actor, [activityId])).has(activityId))
        throw new ActivityStreamsUnavailableError();
      return row;
    },
    async readSummaries(actor: Actor, activityIds: string[]) {
      const reads = await copy.readSummaries(actor, activityIds);
      const ids = await allowed(actor, activityIds);
      return reads.filter((read) => ids.has(read.activityId));
    },
  };
}
