import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '~/server/db';
import {
  accounts,
  activities,
  users,
  photos,
  photoDeletions,
  photoFetchAttempts as attempts,
  photoBackfillRuns as runs,
  photoBackfillAccounts as blocks,
  type Account,
  type Photo,
} from '~/server/db/schema';
import {
  resolveAccountTokens,
  buildAccountTokenColumnUpdate,
} from '~/server/db/account-token-normalization';
import {
  createChangesRepository,
  type Transaction,
  type NewSyncChange,
} from './changes';
import { detailRetryAt } from '~/server/strava/ingestion-policy';
import type { StravaTokens } from '~/server/strava/client';

export const PHOTO_ACTIVITY_LIMIT = 5;
export const PHOTO_REQUEST_LIMIT = 12; // Two sizes per activity, plus OAuth headroom.
const LEASE_MS = 90_000;
const KEY = 'photos';
// Match the existing stream worker's non-secret grant fingerprint. Token
// refresh and reconnect update these columns; old blocks then stop applying.
export const photoCredentialFingerprint = sql<string>`concat_ws('|', ${accounts.accessTokenExpiresAt}, ${accounts.expiresAt}, ${accounts.expires_at}, ${accounts.updatedAt})`;
export class PhotoBackfillStopped extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
export type PhotoClaim = {
  activityId: number;
  athleteId: number;
  userId: string;
  accountId: string;
  authorizationVersion: string;
  sourceVersion: string;
  token: string;
  attemptCount: number;
  tokens: ReturnType<typeof resolveAccountTokens>;
};
const version = (account: Account) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: account.id,
        tokens: resolveAccountTokens(account),
        updatedAt: account.updatedAt,
      }),
    )
    .digest('hex');
// A detail/webhook/summary write while the photo request is in flight wins.
const sourceVersion = sql<string>`md5(row(${activities.last_updated}, ${activities.photosState}, ${activities.photo_count}, ${activities.total_photo_count})::text)`;
export const photoRefreshPending = sql`${activities.photosState} is distinct from 'current' and (
  greatest(coalesce(${activities.total_photo_count},0),coalesce(${activities.photo_count},0)) > 0
  or exists (select 1 from ${photos} where ${photos.activity_id}=${activities.id} and ${photos.athlete_id}=${activities.athlete})
  or ${activities.photosState} = 'refresh_required'
)`;
const connected = sql`${accounts.id} = (
  select a.id from account a where a."userId" = ${users.id}
    and a."providerId" = 'strava' and a."accountId" = ${activities.athlete}::text
  order by a.id limit 1
)
  and ${accounts.revokedAt} is null and ${accounts.scheduledErasureAt} is null
  and (coalesce(${accounts.accessToken},${accounts.access_token},'') <> '' or coalesce(${accounts.refreshToken},${accounts.refresh_token},'') <> '')`;

export function createPhotoBackfillRepository(
  database: typeof db = db,
  clock = () => new Date(),
) {
  const changes = createChangesRepository(database);
  async function lockRun(tx: Transaction, token: string) {
    const [run] = await tx
      .select()
      .from(runs)
      .where(eq(runs.key, KEY))
      .for('update');
    if (
      run?.leaseToken !== token ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= clock()
    )
      throw new PhotoBackfillStopped('lease_lost');
    return run;
  }
  async function lockClaim(tx: Transaction, claim: PhotoClaim) {
    // Same lock order as account erasure: user -> account -> activity -> attempt.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, claim.userId), eq(users.athlete_id, claim.athleteId)),
      )
      .for('key share');
    if (!user) return null;
    const [account] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, claim.accountId))
      .for('update');
    if (
      account?.userId !== claim.userId ||
      account.providerId !== 'strava' ||
      account.accountId !== String(claim.athleteId) ||
      account.revokedAt ||
      account.scheduledErasureAt ||
      version(account) !== claim.authorizationVersion
    )
      return null;
    const [activity] = await tx
      .select({ version: sourceVersion })
      .from(activities)
      .where(
        and(
          eq(activities.id, claim.activityId),
          eq(activities.athlete, claim.athleteId),
        ),
      )
      .for('update');
    if (activity?.version !== claim.sourceVersion) return null;
    const [attempt] = await tx
      .select()
      .from(attempts)
      .where(eq(attempts.activityId, claim.activityId))
      .for('update');
    if (
      attempt?.leaseToken !== claim.token ||
      !attempt.leaseExpiresAt ||
      attempt.leaseExpiresAt <= clock()
    )
      return null;
    return account;
  }
  return {
    async start(): Promise<string | null> {
      return database.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(300, 1)`);
        const [previous] = await tx
          .select()
          .from(runs)
          .where(eq(runs.key, KEY))
          .for('update');
        const now = clock();
        if (previous?.leaseExpiresAt && previous.leaseExpiresAt > now)
          return null;
        const windowStart = new Date(
          Math.floor(now.getTime() / 3_600_000) * 3_600_000,
        );
        const sameHour =
          previous?.windowStart.getTime() === windowStart.getTime();
        const values = {
          key: KEY,
          windowStart,
          selected: sameHour ? previous.selected : 0,
          requests: sameHour ? previous.requests : 0,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        };
        await tx
          .insert(runs)
          .values(values)
          .onConflictDoUpdate({ target: runs.key, set: values });
        return values.leaseToken;
      });
    },
    async reserveRequest(token: string) {
      await database.transaction(async (tx) => {
        const run = await lockRun(tx, token);
        if (run.requests >= PHOTO_REQUEST_LIMIT)
          throw new PhotoBackfillStopped('request_limit');
        await tx
          .update(runs)
          .set({ requests: run.requests + 1 })
          .where(eq(runs.key, KEY));
      });
    },
    async claimNext(
      token: string,
      excludedUsers: string[] = [],
    ): Promise<PhotoClaim | null> {
      return database.transaction(async (tx) => {
        const run = await lockRun(tx, token);
        if (run.selected >= PHOTO_ACTIVITY_LIMIT)
          throw new PhotoBackfillStopped('activity_limit');
        if (run.requests >= PHOTO_REQUEST_LIMIT)
          throw new PhotoBackfillStopped('request_limit');
        const now = clock();
        const [candidate] = await tx
          .select({
            activityId: activities.id,
            athleteId: activities.athlete,
            userId: users.id,
            account: accounts,
            sourceVersion,
            attemptCount: attempts.attemptCount,
          })
          .from(activities)
          .innerJoin(users, eq(users.athlete_id, activities.athlete))
          .innerJoin(accounts, eq(accounts.userId, users.id))
          .leftJoin(attempts, eq(attempts.activityId, activities.id))
          .leftJoin(blocks, eq(blocks.accountId, accounts.id))
          .where(
            and(
              connected,
              sql`${blocks.blockedCredentials} is distinct from ${photoCredentialFingerprint}`,
              photoRefreshPending,
              sql`(${attempts.nextAttemptAt} is null or ${attempts.nextAttemptAt} <= ${now.toISOString()})`,
              sql`(${attempts.leaseExpiresAt} is null or ${attempts.leaseExpiresAt} <= ${now.toISOString()})`,
              excludedUsers.length
                ? sql`${users.id} not in (${sql.join(
                    excludedUsers.map((id) => sql`${id}`),
                    sql`,`,
                  )})`
                : undefined,
            ),
          )
          // Missing photos first; a failed recent activity backs off, allowing older work through.
          .orderBy(
            sql`exists(select 1 from ${photos} where ${photos.activity_id}=${activities.id} and ${photos.athlete_id}=${activities.athlete})`,
            asc(activities.id),
          )
          .limit(1);
        if (!candidate) return null;
        const [activity] = await tx
          .select({ version: sourceVersion })
          .from(activities)
          .where(eq(activities.id, candidate.activityId))
          .for('update');
        if (activity?.version !== candidate.sourceVersion) return null;
        const claim = {
          activityId: candidate.activityId,
          athleteId: candidate.athleteId,
          userId: candidate.userId,
          accountId: candidate.account.id,
          authorizationVersion: version(candidate.account),
          sourceVersion: candidate.sourceVersion,
          token: randomUUID(),
          attemptCount: (candidate.attemptCount ?? 0) + 1,
          tokens: resolveAccountTokens(candidate.account),
        };
        const values = {
          activityId: claim.activityId,
          attemptCount: claim.attemptCount,
          nextAttemptAt: now,
          lastErrorCode: null,
          leaseToken: claim.token,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        };
        await tx
          .insert(attempts)
          .values(values)
          .onConflictDoUpdate({ target: attempts.activityId, set: values });
        await tx
          .update(runs)
          .set({ selected: run.selected + 1 })
          .where(eq(runs.key, KEY));
        return claim;
      });
    },
    async isCurrent(claim: PhotoClaim) {
      return database.transaction(async (tx) =>
        Boolean(await lockClaim(tx, claim)),
      );
    },
    async blockAccount(
      claim: PhotoClaim,
      reason: 'unauthorized' | 'credentials_unavailable',
    ) {
      await database.transaction(async (tx) => {
        // A late failure from an old grant must not block a fresh reconnect.
        if (!(await lockClaim(tx, claim))) return;
        const [current] = await tx
          .select({ fingerprint: photoCredentialFingerprint })
          .from(accounts)
          .where(eq(accounts.id, claim.accountId));
        if (!current) return;
        const values = {
          accountId: claim.accountId,
          blockedCredentials: current.fingerprint,
          reason,
        };
        await tx
          .insert(blocks)
          .values(values)
          .onConflictDoUpdate({ target: blocks.accountId, set: values });
      });
    },
    async replaceCredentials(
      claim: PhotoClaim,
      tokens: StravaTokens,
    ): Promise<PhotoClaim | null> {
      return database.transaction(async (tx) => {
        if (!(await lockClaim(tx, claim))) return null;
        const [account] = await tx
          .update(accounts)
          .set({
            ...buildAccountTokenColumnUpdate({
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAtSeconds: tokens.expires_at,
              expiresAtDate: new Date(tokens.expires_at * 1000),
            }),
            updatedAt: clock(),
          })
          .where(eq(accounts.id, claim.accountId))
          .returning();
        if (!account) return null;
        return {
          ...claim,
          authorizationVersion: version(account),
          tokens: resolveAccountTokens(account),
        };
      });
    },
    async complete(claim: PhotoClaim, incoming: Photo[]): Promise<boolean> {
      if (
        incoming.some(
          (photo) =>
            photo.activity_id !== claim.activityId ||
            photo.athlete_id !== claim.athleteId,
        )
      )
        throw new Error('Photo ownership mismatch');
      return database.transaction(async (tx) => {
        if (!(await lockClaim(tx, claim))) return false;
        const existing = await tx
          .select({ id: photos.unique_id })
          .from(photos)
          .where(
            and(
              eq(photos.activity_id, claim.activityId),
              eq(photos.athlete_id, claim.athleteId),
            ),
          );
        const ids = new Set(incoming.map((photo) => photo.unique_id));
        const removed = existing.filter((photo) => !ids.has(photo.id));
        await tx
          .delete(photos)
          .where(
            and(
              eq(photos.activity_id, claim.activityId),
              eq(photos.athlete_id, claim.athleteId),
            ),
          );
        if (incoming.length) await tx.insert(photos).values(incoming);
        for (const photo of removed) {
          const values = {
            athlete_id: claim.athleteId,
            photo_id: photo.id,
            activity_id: claim.activityId,
            deleted_at: clock(),
          };
          await tx
            .insert(photoDeletions)
            .values(values)
            .onConflictDoUpdate({
              target: [photoDeletions.athlete_id, photoDeletions.photo_id],
              set: values,
            });
        }
        await tx
          .update(activities)
          .set({ photosState: 'current', last_updated: clock() })
          .where(eq(activities.id, claim.activityId));
        const entries: NewSyncChange[] = [
          {
            athleteId: claim.athleteId,
            entityType: 'activity',
            entityId: claim.activityId,
            operation: 'upsert',
          },
          ...incoming.map((photo) => ({
            athleteId: claim.athleteId,
            entityType: 'photo' as const,
            entityId: photo.unique_id,
            operation: 'upsert' as const,
          })),
          ...removed.map((photo) => ({
            athleteId: claim.athleteId,
            entityType: 'photo' as const,
            entityId: photo.id,
            operation: 'delete' as const,
          })),
        ];
        await changes.record(entries, tx);
        await tx
          .delete(attempts)
          .where(eq(attempts.activityId, claim.activityId));
        return true;
      });
    },
    async release(claim: PhotoClaim, errorCode: string | null) {
      // A stale response may release only its own lease, never a newer attempt.
      await database
        .update(attempts)
        .set({
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          attemptCount: errorCode
            ? claim.attemptCount
            : Math.max(0, claim.attemptCount - 1),
          nextAttemptAt: errorCode
            ? detailRetryAt(clock(), claim.attemptCount)
            : clock(),
        })
        .where(
          and(
            eq(attempts.activityId, claim.activityId),
            eq(attempts.leaseToken, claim.token),
          ),
        );
    },
    async finish(token: string) {
      await database
        .update(runs)
        .set({ leaseToken: null, leaseExpiresAt: null })
        .where(and(eq(runs.key, KEY), eq(runs.leaseToken, token)));
    },
  };
}
export type PhotoBackfillRepository = ReturnType<
  typeof createPhotoBackfillRepository
>;
