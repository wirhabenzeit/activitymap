import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, lte, min, ne, or, sql } from 'drizzle-orm';
import { db } from '~/server/db';
import {
  accounts,
  activities,
  activityDetailAttempts,
  photoFetchAttempts,
  stravaImportRuns,
  users,
} from '~/server/db/schema';
import type { Actor } from '~/server/auth/actor';
import {
  resolveAccountTokens,
  buildAccountTokenColumnUpdate,
} from '~/server/db/account-token-normalization';
import { lockActiveStravaAccount } from './account-lifecycle';
import {
  ACTIVITY_IMPORT_COOLDOWN_MS,
  ACTIVITY_IMPORT_LEASE_MS,
  type ActivityImportProgress,
} from '~/server/strava/activity-import-policy';
import type { StravaImportDTO } from '~/contracts/v1/strava-import';
import type { StravaTokens } from '~/server/strava/client';
import { stravaPermissionsFromScope } from '~/lib/strava-permissions';

type Run = typeof stravaImportRuns.$inferSelect;
export type ImportClaim = {
  actor: Actor;
  accountId: string;
  runId: string;
  cursor: Run['historyCursor'];
};

export function importRunDTO(
  run: Run | null | undefined,
  now: Date,
  available: boolean,
): StravaImportDTO {
  const interrupted = run?.status === 'running' && run.leaseExpiresAt <= now;
  return {
    available,
    runId: run?.runId ?? null,
    status: interrupted ? 'interrupted' : (run?.status ?? 'idle'),
    reason: interrupted ? 'interrupted' : (run?.reason ?? null),
    startedAt: run?.startedAt.toISOString() ?? null,
    finishedAt: run?.finishedAt?.toISOString() ?? null,
    retryAt: run && run.retryAt > now ? run.retryAt.toISOString() : null,
    summaries: run?.summaries ?? 0,
    details: run?.details ?? 0,
    photos: run?.photos ?? 0,
  };
}

export function createStravaImportRepository(
  database: typeof db = db,
  clock = () => new Date(),
) {
  const activeAccount = async (actor: Actor) =>
    (
      await database
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, actor.userId),
            eq(accounts.providerId, 'strava'),
            eq(accounts.accountId, String(actor.athleteId)),
            isNull(accounts.revokedAt),
          ),
        )
        .limit(1)
    )[0];
  return {
    async read(actor: Actor, enabled: boolean) {
      const account = await activeAccount(actor);
      const [run] = account
        ? await database
            .select()
            .from(stravaImportRuns)
            .where(
              and(
                eq(stravaImportRuns.userId, actor.userId),
                eq(stravaImportRuns.accountId, account.id),
              ),
            )
        : [];
      return importRunDTO(
        run,
        clock(),
        enabled &&
          Boolean(
            account &&
            resolveAccountTokens(account).accessToken &&
            stravaPermissionsFromScope(account.scope)?.activities !== 'none',
          ),
      );
    },
    async start(actor: Actor) {
      return database.transaction(async (tx) => {
        // Same user-before-account lock order as account deletion and persistence.
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, actor.userId),
              eq(users.athlete_id, actor.athleteId),
            ),
          )
          .for('update');
        if (!user) return null;
        const [account] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, actor.userId),
              eq(accounts.providerId, 'strava'),
              eq(accounts.accountId, String(actor.athleteId)),
              isNull(accounts.revokedAt),
            ),
          )
          .for('share');
        if (
          !account ||
          !resolveAccountTokens(account).accessToken ||
          stravaPermissionsFromScope(account.scope)?.activities === 'none'
        )
          return null;
        const [previous] = await tx
          .select()
          .from(stravaImportRuns)
          .where(eq(stravaImportRuns.userId, actor.userId))
          .for('update');
        const now = clock();
        if (
          previous?.accountId === account.id &&
          ((previous.status === 'running' && previous.leaseExpiresAt > now) ||
            previous.retryAt > now)
        )
          return { claim: null, status: importRunDTO(previous, now, true) };
        const oldest = await tx
          .select({ start: min(activities.start_date) })
          .from(activities)
          .where(eq(activities.athlete, actor.athleteId));
        const cursor =
          previous?.accountId === account.id ? previous.historyCursor : null;
        const values = {
          accountId: account.id,
          runId: randomUUID(),
          status: 'running' as const,
          reason: null,
          startedAt: now,
          finishedAt: null,
          leaseExpiresAt: new Date(now.getTime() + ACTIVITY_IMPORT_LEASE_MS),
          retryAt: new Date(now.getTime() + ACTIVITY_IMPORT_COOLDOWN_MS),
          summaries: 0,
          details: 0,
          photos: 0,
          requests: 0,
          historyCursor:
            cursor ??
            (oldest[0]?.start
              ? {
                  before:
                    Math.floor(new Date(oldest[0].start).getTime() / 1000) + 1,
                  page: 1,
                  done: false,
                }
              : null),
        };
        const [run] = await tx
          .insert(stravaImportRuns)
          .values({ userId: actor.userId, ...values })
          .onConflictDoUpdate({
            target: stravaImportRuns.userId,
            set: values,
          })
          .returning();
        return {
          claim: {
            actor,
            accountId: account.id,
            runId: values.runId,
            cursor: values.historyCursor,
          } satisfies ImportClaim,
          status: importRunDTO(run, now, true),
        };
      });
    },
    async isCurrent(claim: ImportClaim) {
      const account = await activeAccount(claim.actor);
      const [run] = await database
        .select({ id: stravaImportRuns.runId })
        .from(stravaImportRuns)
        .where(
          and(
            eq(stravaImportRuns.userId, claim.actor.userId),
            eq(stravaImportRuns.runId, claim.runId),
            eq(stravaImportRuns.status, 'running'),
            gt(stravaImportRuns.leaseExpiresAt, clock()),
          ),
        );
      return account?.id === claim.accountId && Boolean(run);
    },
    async save(
      claim: ImportClaim,
      progress: ActivityImportProgress,
      finish?: {
        status: Exclude<Run['status'], 'running'>;
        reason: StravaImportDTO['reason'];
        retryAt?: Date;
      },
    ) {
      return database.transaction(async (tx) => {
        if (
          !(await lockActiveStravaAccount(tx, {
            userId: claim.actor.userId,
            id: claim.accountId,
          }))
        )
          return;
        await tx
          .update(stravaImportRuns)
          .set({
            summaries: progress.summaries,
            details: progress.details,
            photos: progress.photos,
            requests: progress.requests,
            historyCursor: progress.cursor,
            ...(finish
              ? {
                  status: finish.status,
                  reason: finish.reason,
                  finishedAt: clock(),
                  ...(finish.retryAt ? { retryAt: finish.retryAt } : {}),
                }
              : {}),
          })
          .where(
            and(
              eq(stravaImportRuns.userId, claim.actor.userId),
              eq(stravaImportRuns.runId, claim.runId),
              eq(stravaImportRuns.status, 'running'),
              gt(stravaImportRuns.leaseExpiresAt, clock()),
            ),
          );
      });
    },
    async replaceCredentials(
      claim: ImportClaim,
      previousToken: string,
      tokens: StravaTokens,
    ) {
      return database.transaction(async (tx) => {
        if (
          !(await lockActiveStravaAccount(tx, {
            userId: claim.actor.userId,
            id: claim.accountId,
          }))
        )
          return false;
        const [account] = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.id, claim.accountId))
          .for('update');
        if (
          !account ||
          resolveAccountTokens(account).accessToken !== previousToken
        )
          return false;
        const [run] = await tx
          .select()
          .from(stravaImportRuns)
          .where(
            and(
              eq(stravaImportRuns.userId, claim.actor.userId),
              eq(stravaImportRuns.runId, claim.runId),
              eq(stravaImportRuns.status, 'running'),
              gt(stravaImportRuns.leaseExpiresAt, clock()),
            ),
          );
        if (!run) return false;
        await tx
          .update(accounts)
          .set(
            buildAccountTokenColumnUpdate({
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAtSeconds: tokens.expires_at,
              expiresAtDate: new Date(tokens.expires_at * 1000),
            }),
          )
          .where(eq(accounts.id, claim.accountId));
        return true;
      });
    },
    async candidates(athleteId: number, limit: number) {
      const now = clock();
      const rows = await database
        .select({ id: activities.id })
        .from(activities)
        .leftJoin(
          activityDetailAttempts,
          eq(activityDetailAttempts.activityId, activities.id),
        )
        .leftJoin(
          photoFetchAttempts,
          eq(photoFetchAttempts.activityId, activities.id),
        )
        .where(
          and(
            eq(activities.athlete, athleteId),
            or(
              and(
                ne(activities.geometryState, 'detailed'),
                or(
                  isNull(activityDetailAttempts.nextAttemptAt),
                  lte(activityDetailAttempts.nextAttemptAt, now),
                ),
              ),
              and(
                or(
                  isNull(activities.photosState),
                  ne(activities.photosState, 'current'),
                ),
                sql`greatest(coalesce(${activities.total_photo_count}, 0), coalesce(${activities.photo_count}, 0)) > 0`,
                or(
                  isNull(photoFetchAttempts.nextAttemptAt),
                  lte(photoFetchAttempts.nextAttemptAt, now),
                ),
              ),
            ),
          ),
        )
        .orderBy(desc(activities.start_date))
        .limit(limit);
      return rows.map((row) => row.id);
    },
  };
}
export const stravaImportRepository = createStravaImportRepository();
export type StravaImportRepository = ReturnType<
  typeof createStravaImportRepository
>;
