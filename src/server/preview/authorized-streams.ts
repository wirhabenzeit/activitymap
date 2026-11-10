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
 */
export function authorizedStreams(
  copy: StreamReads,
  authority: Pick<ActivityStreamsRepository, 'readable'>,
): StreamReads {
  return {
    async read(actor: Actor, activityId: string) {
      const row = await copy.read(actor, activityId);
      if (!(await authority.readable(actor, [activityId])).has(activityId))
        throw new ActivityStreamsUnavailableError();
      return row;
    },
    async readSummaries(actor: Actor, activityIds: string[]) {
      const reads = await copy.readSummaries(actor, activityIds);
      const allowed = await authority.readable(actor, activityIds);
      return reads.filter((read) => allowed.has(read.activityId));
    },
  };
}
