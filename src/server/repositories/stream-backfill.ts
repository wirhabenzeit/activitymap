import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~/server/db';
import {
  accounts,
  activities,
  activityStreams,
  users,
  streamBackfillRuns as runs,
  streamBackfillAccounts as fairness,
  streamBackfillAttempts as attempts,
} from '~/server/db/schema';
import type { Actor } from '~/server/auth/actor';
import type { StreamFetchFailure } from '~/server/strava/streams';
import {
  STREAM_BACKFILL_HOUR_MS,
  STREAM_BACKFILL_LEASE_MS,
  StreamBackfillStopped,
  streamBackfillRetryAt,
  type BackfillStopReason,
} from '~/server/strava/stream-backfill-policy';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BackfillRun = { token: string };
export type BackfillCandidate = {
  actor: Actor;
  activityId: string;
  attemptCount: number;
};
const KEY = 'historical-streams';
const sameGeneration = sql`${attempts.generation} is not distinct from ${activityStreams.generation}`;

// Historical backfill is one successful fetch per generation, including {}.
// Age alone does not requeue completed history and starve unfetched activities.
const needsFetch = sql`(${activityStreams.fetchedAt} is null or ${activityStreams.invalidatedAt} is not null)`;
const connected = sql`${accounts.id} = (
  select a.id from account a where a."userId" = ${users.id}
    and a."providerId" = 'strava' and a."accountId" = ${users.athlete_id}::text
  order by a.id limit 1
) and ${accounts.revokedAt} is null and ${accounts.scheduledErasureAt} is null
and (coalesce(${accounts.accessToken}, ${accounts.access_token}, '') <> ''
  or coalesce(${accounts.refreshToken}, ${accounts.refresh_token}, '') <> '')`;
const unfinished = sql`(${attempts.terminal} is not true or not (${sameGeneration}))`;

export function createStreamBackfillRepository(
  database: typeof db = db,
  clock = () => new Date(),
) {
  async function lockRun(tx: Transaction, run: BackfillRun) {
    const [row] = await tx
      .select()
      .from(runs)
      .where(eq(runs.key, KEY))
      .for('update');
    const now = clock();
    if (
      row?.leaseToken !== run.token ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= now
    )
      throw new StreamBackfillStopped('lease_lost');
    return { row, now };
  }

  return {
    async start(
      activityLimit: number,
      requestLimit: number,
    ): Promise<BackfillRun | BackfillStopReason> {
      return database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(184, 1)`);
        const [previous] = await tx
          .select()
          .from(runs)
          .where(eq(runs.key, KEY))
          .for('update');
        const now = clock();
        if (
          previous?.leaseToken &&
          previous.leaseExpiresAt &&
          previous.leaseExpiresAt > now
        )
          return 'busy';
        const windowStart = new Date(
          Math.floor(now.getTime() / STREAM_BACKFILL_HOUR_MS) *
            STREAM_BACKFILL_HOUR_MS,
        );
        const sameHour =
          previous?.windowStart.getTime() === windowStart.getTime();
        if (sameHour && previous.paused) return 'rate_limit';
        // Replays may lower the hourly caps, but cannot replenish or raise them.
        const values = {
          windowStart,
          activityLimit: sameHour
            ? Math.min(previous.activityLimit, activityLimit)
            : activityLimit,
          requestLimit: sameHour
            ? Math.min(previous.requestLimit, requestLimit)
            : requestLimit,
          selected: sameHour ? previous.selected : 0,
          requests: sameHour ? previous.requests : 0,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + STREAM_BACKFILL_LEASE_MS),
          paused: false,
        };
        await tx
          .insert(runs)
          .values({ key: KEY, ...values })
          .onConflictDoUpdate({ target: runs.key, set: values });
        return { token: values.leaseToken };
      });
    },

    async assertActive(run: BackfillRun) {
      await database.transaction(async (tx) => {
        await lockRun(tx, run);
      });
    },

    async reserveRequest(run: BackfillRun) {
      await database.transaction(async (tx) => {
        const { row } = await lockRun(tx, run);
        if (row.requests >= row.requestLimit)
          throw new StreamBackfillStopped('request_limit');
        await tx
          .update(runs)
          .set({ requests: row.requests + 1 })
          .where(eq(runs.key, KEY));
      });
    },

    async claimNext(run: BackfillRun): Promise<BackfillCandidate | null> {
      return database.transaction(async (tx) => {
        const { row, now } = await lockRun(tx, run);
        if (row.selected >= row.activityLimit)
          throw new StreamBackfillStopped('activity_limit');
        if (row.requests >= row.requestLimit)
          throw new StreamBackfillStopped('request_limit');
        const [candidate] = await tx
          .select({
            activityId: sql<string>`${activities.id}::text`,
            userId: users.id,
            athleteId: users.athlete_id,
            generation: activityStreams.generation,
            previousGeneration: attempts.generation,
            attemptCount: attempts.attemptCount,
            selectOldest: fairness.selectOldest,
          })
          .from(activities)
          .innerJoin(users, eq(users.athlete_id, activities.athlete))
          .innerJoin(accounts, eq(accounts.userId, users.id))
          .leftJoin(
            activityStreams,
            eq(activityStreams.activityId, activities.id),
          )
          .leftJoin(attempts, eq(attempts.activityId, activities.id))
          .leftJoin(fairness, eq(fairness.userId, users.id))
          .where(
            and(
              connected,
              needsFetch,
              unfinished,
              sql`(${activityStreams.leaseExpiresAt} is null or ${activityStreams.leaseExpiresAt} <= ${now.toISOString()})`,
              sql`(${activityStreams.nextRetryAt} is null or ${activityStreams.nextRetryAt} <= ${now.toISOString()})`,
              sql`(${attempts.leaseExpiresAt} is null or ${attempts.leaseExpiresAt} <= ${now.toISOString()})`,
              sql`(not (${sameGeneration}) or ${attempts.nextAttemptAt} is null or ${attempts.nextAttemptAt} <= ${now.toISOString()})`,
            ),
          )
          .orderBy(
            sql`${fairness.lastSelectedAt} asc nulls first`,
            users.id,
            sql`case when coalesce(${fairness.selectOldest}, false) then ${activities.start_date} end asc`,
            sql`case when not coalesce(${fairness.selectOldest}, false) then ${activities.start_date} end desc`,
            sql`case when coalesce(${fairness.selectOldest}, false) then ${activities.id} end asc`,
            sql`${activities.id} desc`,
          )
          .limit(1);
        if (candidate?.athleteId == null) return null;
        // Same parent-lock order as ingestion/erasure. A deletion since selection
        // skips the row; neither a checkpoint nor a late result recreates it.
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, candidate.userId))
          .for('key share');
        if (!user) return null;
        const [activity] = await tx
          .select({ id: activities.id })
          .from(activities)
          .where(
            and(
              eq(activities.id, sql`${candidate.activityId}::bigint`),
              eq(activities.athlete, candidate.athleteId),
            ),
          )
          .for('key share');
        if (!activity) return null;
        const attemptCount =
          candidate.generation === candidate.previousGeneration
            ? (candidate.attemptCount ?? 0) + 1
            : 1;
        const values = {
          generation: candidate.generation,
          attemptCount,
          lastAttemptAt: now,
          nextAttemptAt: null,
          terminal: false,
          lastError: null,
          leaseToken: run.token,
          leaseExpiresAt: new Date(now.getTime() + STREAM_BACKFILL_LEASE_MS),
        };
        await tx
          .insert(attempts)
          .values({ activityId: BigInt(candidate.activityId), ...values })
          .onConflictDoUpdate({ target: attempts.activityId, set: values });
        const accountValues = {
          lastSelectedAt: sql`greatest(${now.toISOString()}::timestamp, (select max(last_selected_at) from stream_backfill_account) + interval '1 millisecond')`,
          selectOldest: !candidate.selectOldest,
        };
        await tx
          .insert(fairness)
          .values({ userId: candidate.userId, ...accountValues })
          .onConflictDoUpdate({ target: fairness.userId, set: accountValues });
        await tx
          .update(runs)
          .set({ selected: row.selected + 1 })
          .where(eq(runs.key, KEY));
        return {
          actor: {
            userId: candidate.userId,
            athleteId: candidate.athleteId,
            authentication: 'bearer',
          },
          activityId: candidate.activityId,
          attemptCount,
        };
      });
    },

    async attachGeneration(
      run: BackfillRun,
      candidate: BackfillCandidate,
      generation: string,
    ) {
      await database.transaction(async (tx) => {
        await lockRun(tx, run);
        const rows = await tx
          .update(attempts)
          .set({ generation })
          .where(
            and(
              eq(attempts.activityId, BigInt(candidate.activityId)),
              eq(attempts.leaseToken, run.token),
            ),
          )
          .returning({ id: attempts.activityId });
        if (!rows.length) throw new StreamBackfillStopped('lease_lost');
      });
    },

    async finishAttempt(
      run: BackfillRun,
      candidate: BackfillCandidate,
      error: StreamFetchFailure | null,
    ) {
      await database.transaction(async (tx) => {
        const { now } = await lockRun(tx, run);
        await tx
          .update(attempts)
          .set({
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: error,
            terminal: Boolean(error && !error.retryable),
            nextAttemptAt: error
              ? streamBackfillRetryAt(now, candidate.attemptCount)
              : null,
          })
          .where(
            and(
              eq(attempts.activityId, BigInt(candidate.activityId)),
              eq(attempts.leaseToken, run.token),
            ),
          );
      });
    },

    async finish(run: BackfillRun, stopReason: BackfillStopReason) {
      // An expired worker cannot release a replacement worker's lease.
      await database
        .update(runs)
        .set({
          leaseToken: null,
          leaseExpiresAt: null,
          paused: stopReason === 'rate_limit',
        })
        .where(and(eq(runs.key, KEY), eq(runs.leaseToken, run.token)));
    },

    async remainingBacklog(): Promise<number> {
      const [row] = await database
        .select({ count: sql<number>`count(*)::integer` })
        .from(activities)
        .innerJoin(users, eq(users.athlete_id, activities.athlete))
        .innerJoin(accounts, eq(accounts.userId, users.id))
        .leftJoin(
          activityStreams,
          eq(activityStreams.activityId, activities.id),
        )
        .leftJoin(attempts, eq(attempts.activityId, activities.id))
        .where(and(connected, needsFetch, unfinished));
      return row?.count ?? 0;
    },
  };
}
export type StreamBackfillRepository = ReturnType<
  typeof createStreamBackfillRepository
>;
