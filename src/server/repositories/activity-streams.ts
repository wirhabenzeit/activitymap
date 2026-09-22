import 'server-only';
import {
  STREAM_MAX_AGE_MS,
  STREAM_FETCH_LEASE_MS,
  STREAM_RETRY_MS,
} from '~/server/strava/stream-policy';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Actor } from '~/server/auth/actor';
import { db } from '~/server/db';
import {
  accounts,
  activities,
  activityStreams,
  users,
  type Account,
} from '~/server/db/schema';
import {
  buildAccountTokenColumnUpdate,
  resolveAccountTokens,
} from '~/server/db/account-token-normalization';
import type { StravaTokens } from '~/server/strava/client';
import {
  ACTIVITY_STREAM_TYPES,
  rawActivityStreamsSchema,
  streamActivityIdSchema,
  type StreamFetchFailure,
} from '~/server/strava/streams';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StoredStreams = typeof activityStreams.$inferSelect;
export type StreamSnapshot = Omit<StoredStreams, 'activityId' | 'revision'> & {
  activityId: string;
  revision: string;
};
export type StreamFetchClaim = {
  actor: Actor;
  activityId: string;
  generation: string;
  attemptId: string;
  sourceVersion: string;
  authorizationVersion: string;
};
export class ActivityStreamsUnavailableError extends Error {
  constructor() {
    super('Activity or eligible Strava account unavailable');
    this.name = 'ActivityStreamsUnavailableError';
  }
}

function snapshot(row: StoredStreams): StreamSnapshot {
  return {
    ...row,
    activityId: String(row.activityId),
    revision: String(row.revision),
  };
}

function authorizationVersion(account: Account): string {
  // Internal guard only. Never persist or expose credentials in stream records.
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: account.id,
        accountId: account.accountId,
        tokens: resolveAccountTokens(account),
        updatedAt: account.updatedAt,
      }),
    )
    .digest('hex');
}

/** Locks the actor's user and connected, non-revoked Strava account. */
async function lockEligibleAccount(tx: Transaction, actor: Actor) {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.id, actor.userId), eq(users.athlete_id, actor.athleteId)),
    )
    // Prevent erasure while remaining compatible with activity writers'
    // user foreign-key checks when their metadata triggers publish changes.
    .for('key share');
  if (!user) return null;
  const [account] = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, user.id),
        eq(accounts.providerId, 'strava'),
        eq(accounts.accountId, String(actor.athleteId)),
      ),
    )
    .orderBy(accounts.id)
    .limit(1)
    .for('update');
  if (!account || account.revokedAt || account.scheduledErasureAt) return null;
  const tokens = resolveAccountTokens(account);
  if (!tokens.accessToken && !tokens.refreshToken) return null;
  return account;
}

/** Lock order matches account erasure: user -> account -> activity -> streams. */
async function lockSource(tx: Transaction, actor: Actor, activityId: string) {
  const account = await lockEligibleAccount(tx, actor);
  if (!account) return null;
  const [activity] = await tx
    .select({
      // Same source projection as the activity invalidation trigger.
      version: sql<string>`md5(activity_stream_source(${activities})::text)`,
    })
    .from(activities)
    .where(
      and(
        eq(activities.id, sql`${activityId}::bigint`),
        eq(activities.athlete, actor.athleteId),
      ),
    )
    .for('update');
  return activity
    ? {
        account,
        sourceVersion: activity.version,
        authorizationVersion: authorizationVersion(account),
      }
    : null;
}

async function lockClaim(tx: Transaction, claim: StreamFetchClaim) {
  const source = await lockSource(tx, claim.actor, claim.activityId);
  if (
    source?.sourceVersion !== claim.sourceVersion ||
    source.authorizationVersion !== claim.authorizationVersion
  )
    return null;
  const [row] = await tx
    .select({
      generation: activityStreams.generation,
      attemptId: activityStreams.attemptId,
    })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, BigInt(claim.activityId)))
    .for('update');
  if (row?.generation !== claim.generation || row.attemptId !== claim.attemptId)
    return null;
  return source;
}

export function createActivityStreamsRepository(database: typeof db = db) {
  return {
    async isCurrent(claim: StreamFetchClaim): Promise<boolean> {
      return database.transaction(async (tx) =>
        Boolean(await lockClaim(tx, claim)),
      );
    },
    async read(
      actor: Actor,
      activityId: string,
    ): Promise<StreamSnapshot | null> {
      streamActivityIdSchema.parse(activityId);
      return database.transaction(async (tx) => {
        if (!(await lockSource(tx, actor, activityId)))
          throw new ActivityStreamsUnavailableError();
        const [row] = await tx
          .select()
          .from(activityStreams)
          .where(eq(activityStreams.activityId, BigInt(activityId)));
        return row ? snapshot(row) : null;
      });
    },

    async begin(actor: Actor, activityId: string, now: Date, force = false) {
      streamActivityIdSchema.parse(activityId);
      return database.transaction(async (tx) => {
        const source = await lockSource(tx, actor, activityId);
        if (!source) throw new ActivityStreamsUnavailableError();
        const [existing] = await tx
          .select()
          .from(activityStreams)
          .where(eq(activityStreams.activityId, BigInt(activityId)))
          .for('update');
        const current =
          existing?.payload != null &&
          !existing.invalidatedAt &&
          existing.fetchedAt &&
          existing.fetchedAt.getTime() + STREAM_MAX_AGE_MS > now.getTime() &&
          existing.sourceVersion === source.sourceVersion;
        // A current payload stays readable while another refresh is in flight
        // or cooling down after a failure; only fetches wait for either.
        if (current && !force) {
          return { kind: 'cached' as const, snapshot: snapshot(existing) };
        }
        if (
          existing?.attemptId &&
          existing.leaseExpiresAt &&
          existing.leaseExpiresAt > now
        ) {
          return { kind: 'pending' as const, snapshot: snapshot(existing) };
        }
        if (existing?.nextRetryAt && existing.nextRetryAt > now) {
          return { kind: 'cooldown' as const, snapshot: snapshot(existing) };
        }
        if (
          current &&
          existing.fetchedAt!.getTime() + STREAM_RETRY_MS > now.getTime()
        ) {
          return { kind: 'cached' as const, snapshot: snapshot(existing) };
        }
        const generation = existing?.generation ?? randomUUID();
        const attemptId = randomUUID();
        await tx
          .insert(activityStreams)
          .values({
            activityId: BigInt(activityId),
            generation,
            attemptId,
            requestedTypes: [...ACTIVITY_STREAM_TYPES],
            lastAttemptAt: now,
            lastAttemptStatus: 'pending',
            leaseExpiresAt: new Date(now.getTime() + STREAM_FETCH_LEASE_MS),
            nextRetryAt: null,
          })
          .onConflictDoUpdate({
            target: activityStreams.activityId,
            set: {
              attemptId,
              lastAttemptAt: now,
              lastAttemptStatus: 'pending',
              leaseExpiresAt: new Date(now.getTime() + STREAM_FETCH_LEASE_MS),
              nextRetryAt: null,
              lastError: null,
              requestedTypes: [...ACTIVITY_STREAM_TYPES],
            },
          });
        const claim: StreamFetchClaim = {
          actor,
          activityId,
          generation,
          attemptId,
          sourceVersion: source.sourceVersion,
          authorizationVersion: source.authorizationVersion,
        };
        return {
          kind: 'fetch' as const,
          claim,
          tokens: resolveAccountTokens(source.account),
        };
      });
    },

    async commit(
      claim: StreamFetchClaim,
      raw: unknown,
      now: Date,
    ): Promise<StreamSnapshot | null> {
      const payload = rawActivityStreamsSchema.parse(raw);
      return database.transaction(async (tx) => {
        if (!(await lockClaim(tx, claim))) return null;
        // Never upsert here: a deleted/recreated activity has lost this claim.
        const [saved] = await tx
          .update(activityStreams)
          .set({
            payload,
            availableTypes: ACTIVITY_STREAM_TYPES.filter(
              (type) => payload[type] !== undefined,
            ),
            sourceVersion: claim.sourceVersion,
            fetchedAt: now,
            revision: sql`${activityStreams.revision} + 1`,
            attemptId: null,
            lastAttemptStatus: 'succeeded',
            invalidatedAt: null,
            leaseExpiresAt: null,
            nextRetryAt: null,
            lastError: null,
          })
          .where(eq(activityStreams.activityId, BigInt(claim.activityId)))
          .returning();
        return saved ? snapshot(saved) : null;
      });
    },

    async fail(
      claim: StreamFetchClaim,
      error: StreamFetchFailure,
      now = new Date(),
    ): Promise<boolean> {
      return database.transaction(async (tx) => {
        if (!(await lockClaim(tx, claim))) return false;
        await tx
          .update(activityStreams)
          .set({
            attemptId: null,
            lastAttemptStatus: 'failed',
            leaseExpiresAt: null,
            nextRetryAt: new Date(now.getTime() + STREAM_RETRY_MS),
            lastError: error,
          })
          .where(eq(activityStreams.activityId, BigInt(claim.activityId)));
        return true;
      });
    },

    /**
     * Refresh callbacks must not restore credentials after revoke/reconnect.
     * Returns the updated claim, or null when the claim is no longer current.
     */
    async replaceCredentials(
      claim: StreamFetchClaim,
      tokens: StravaTokens,
    ): Promise<StreamFetchClaim | null> {
      return database.transaction(async (tx) => {
        // Only replace the exact credentials this attempt refreshed; a
        // concurrent refresh or reconnect already stored newer, valid tokens.
        const eligible = await lockEligibleAccount(tx, claim.actor);
        if (
          !eligible ||
          authorizationVersion(eligible) !== claim.authorizationVersion
        )
          return null;
        // Strava has already rotated the refresh token, so persist it even
        // when the stream attempt itself was superseded during the request.
        const current = await lockClaim(tx, claim);
        const [account] = await tx
          .update(accounts)
          .set(
            buildAccountTokenColumnUpdate({
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAtSeconds: tokens.expires_at,
              expiresAtDate: new Date(tokens.expires_at * 1000),
            }),
          )
          .where(eq(accounts.id, eligible.id))
          .returning();
        return current && account
          ? { ...claim, authorizationVersion: authorizationVersion(account) }
          : null;
      });
    },
  };
}

export type ActivityStreamsRepository = ReturnType<
  typeof createActivityStreamsRepository
>;
