import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { db as defaultDb } from '~/server/db';
import {
  accounts,
  activities,
  initialActivityImports,
  users,
} from '~/server/db/schema';
import type { Actor } from '~/server/auth/actor';
import { createChangesRepository, type Transaction } from './changes';
import { mergeSummaryActivity } from './summary-reconciliation';
import type { StravaActivity } from '~/server/strava/types';
import {
  INITIAL_IMPORT_PAGE_SIZE,
  INITIAL_IMPORT_TARGET,
} from '~/contracts/v1/initial-import';

export type InitialImportState = typeof initialActivityImports.$inferSelect;
export type InitialImportClaim = InitialImportState & {
  leaseToken: string;
  before: number;
};
export interface InitialImportRepository {
  read(actor: Actor): Promise<InitialImportState | null>;
  claim(actor: Actor, now: Date): Promise<InitialImportClaim | null>;
  commit(
    actor: Actor,
    claim: InitialImportClaim,
    page: StravaActivity[],
    now: Date,
  ): Promise<void>;
  fail(
    actor: Actor,
    claim: InitialImportClaim,
    message: string,
    retryAt: Date | null,
  ): Promise<void>;
}

export function createInitialImportRepository(
  database = defaultDb,
): InitialImportRepository {
  const changes = createChangesRepository(database);
  // Account lock fences both a concurrent revocation and a late page response.
  async function authorize(tx: Transaction, actor: Actor) {
    const [account] = await tx
      .select()
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(
        and(
          eq(accounts.userId, actor.userId),
          eq(accounts.providerId, 'strava'),
        ),
      )
      .for('update');
    if (
      !account ||
      account.account.revokedAt ||
      account.user.athlete_id !== actor.athleteId ||
      account.account.accountId !== String(actor.athleteId)
    ) {
      throw new Error('The connected Strava account changed during import.');
    }
  }
  return {
    async read(actor) {
      const [row] = await database
        .select()
        .from(initialActivityImports)
        .where(
          and(
            eq(initialActivityImports.userId, actor.userId),
            eq(initialActivityImports.athleteId, actor.athleteId),
          ),
        );
      return row ?? null;
    },
    async claim(actor, now) {
      return database.transaction(async (tx) => {
        await authorize(tx, actor);
        await tx
          .insert(initialActivityImports)
          .values({
            userId: actor.userId,
            athleteId: actor.athleteId,
            startedAt: now,
            before: Math.floor(now.getTime() / 1000) + 1,
          })
          .onConflictDoNothing();
        const [row] = await tx
          .update(initialActivityImports)
          .set({
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(now.getTime() + 90_000),
            message: null,
          })
          .where(
            and(
              eq(initialActivityImports.userId, actor.userId),
              eq(initialActivityImports.athleteId, actor.athleteId),
              isNull(initialActivityImports.completedAt),
              or(
                isNull(initialActivityImports.leaseExpiresAt),
                lte(initialActivityImports.leaseExpiresAt, now),
              ),
              or(
                isNull(initialActivityImports.retryAt),
                lte(initialActivityImports.retryAt, now),
              ),
            ),
          )
          .returning();
        return row?.leaseToken && row.before !== null
          ? { ...row, leaseToken: row.leaseToken, before: row.before }
          : null;
      });
    },
    async commit(actor, claim, page, now) {
      if (
        page.length > INITIAL_IMPORT_PAGE_SIZE ||
        new Set(page.map((a) => a.id)).size !== page.length ||
        page.some(
          (a) =>
            a.athlete.id !== actor.athleteId ||
            !Number.isSafeInteger(a.id) ||
            a.id <= 0,
        )
      ) {
        throw new Error('Invalid initial activity page.');
      }
      await database.transaction(async (tx) => {
        await authorize(tx, actor);
        const [current] = await tx
          .select()
          .from(initialActivityImports)
          .where(
            and(
              eq(initialActivityImports.userId, actor.userId),
              eq(initialActivityImports.leaseToken, claim.leaseToken),
            ),
          )
          .for('update');
        if (
          current?.nextPage !== claim.nextPage ||
          current.completedAt ||
          !current.leaseExpiresAt ||
          current.leaseExpiresAt <= now
        )
          throw new Error('Initial import lease expired.');
        if (page.length) {
          // Seed only missing rows. Webhooks and detail enrichment remain authoritative.
          const inserted = await tx
            .insert(activities)
            .values(
              page.map((a) =>
                mergeSummaryActivity(undefined, a, actor.athleteId, now),
              ),
            )
            .onConflictDoNothing()
            .returning({ id: activities.id });
          await changes.record(
            inserted.map((a) => ({
              athleteId: actor.athleteId,
              entityType: 'activity',
              entityId: a.id,
              operation: 'upsert',
            })),
            tx,
          );
        }
        const importedCount = current.importedCount + page.length;
        const historyComplete = page.length < INITIAL_IMPORT_PAGE_SIZE;
        const complete =
          historyComplete || importedCount >= INITIAL_IMPORT_TARGET;
        await tx
          .update(initialActivityImports)
          .set({
            importedCount,
            nextPage: current.nextPage + 1,
            historyComplete,
            completedAt: complete ? now : null,
            leaseToken: null,
            leaseExpiresAt: null,
            retryAt: null,
            message: null,
          })
          .where(eq(initialActivityImports.userId, actor.userId));
        if (historyComplete)
          await tx
            .update(users)
            .set({ oldest_activity_reached: true })
            .where(eq(users.id, actor.userId));
      });
    },
    async fail(actor, claim, message, retryAt) {
      await database
        .update(initialActivityImports)
        .set({ message, retryAt, leaseToken: null, leaseExpiresAt: null })
        .where(
          and(
            eq(initialActivityImports.userId, actor.userId),
            eq(initialActivityImports.leaseToken, claim.leaseToken),
          ),
        );
    },
  };
}
export const initialImportRepository = createInitialImportRepository();
