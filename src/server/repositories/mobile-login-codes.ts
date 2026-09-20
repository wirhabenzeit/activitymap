import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db as defaultDb } from '~/server/db';
import { mobileLoginCodes, type MobileLoginCode } from '~/server/db/schema';

type DrizzleDb = typeof defaultDb;

export type NewMobileLoginCode = {
  codeHash: string;
  state: string;
  pkceChallenge: string;
  redirectUri: string;
  userId: string;
  sessionBearerToken: string;
  expiresAt: Date;
};

/**
 * Repository boundary for the `mobile_login_codes` table (issue #121). Kept
 * separate from `~/server/auth/mobile.ts`'s exchange logic for the same
 * reason `~/server/repositories/activities.ts` is separate from
 * `~/server/application/activities.ts`: it lets the replay/expiry/state
 * tests in `~/server/auth/mobile.test.ts` run against an in-memory fake
 * instead of a real Postgres connection, which this sandbox does not have.
 */
export interface MobileLoginCodesRepository {
  create(record: NewMobileLoginCode): Promise<MobileLoginCode>;
  /**
   * Atomically marks the row matching `codeHash` as consumed and returns
   * it - or returns `null` if no unconsumed row with that hash exists.
   * This is a single conditional `UPDATE ... WHERE consumed_at IS NULL
   * RETURNING *`, so two concurrent callers racing the same code cannot
   * both receive a non-null result: the database's row lock serializes the
   * update, and only the first one finds `consumed_at IS NULL` still true.
   * The caller checks `expiresAt` on the returned row itself, so an
   * expired code is also consumed here (preventing any later reuse) rather
   * than surviving as replayable.
   */
  consumeByCodeHash(codeHash: string, now: Date): Promise<MobileLoginCode | null>;
  /**
   * Non-atomic lookup used only to distinguish "no such code" from
   * "already consumed" when reporting a replay error after
   * `consumeByCodeHash` returns `null`. Never used to authorize anything.
   */
  findByCodeHash(codeHash: string): Promise<MobileLoginCode | null>;
}

export function createMobileLoginCodesRepository(
  database: DrizzleDb = defaultDb,
): MobileLoginCodesRepository {
  return {
    async create(record) {
      const [saved] = await database
        .insert(mobileLoginCodes)
        .values(record)
        .returning();
      if (!saved) {
        throw new Error('Failed to create mobile login code');
      }
      return saved;
    },

    async consumeByCodeHash(codeHash, now) {
      // The row is claimed (consumedAt set) and the bearer token is wiped
      // from storage in the same transaction, but as two statements: the
      // claim's `RETURNING *` has to capture the token before it is
      // cleared, since the caller still needs to hand it back once. Only
      // the first statement's `WHERE consumedAt IS NULL` is what makes
      // this safe under concurrent replay - the second statement runs
      // once per successful claim.
      return database.transaction(async (tx) => {
        const [consumed] = await tx
          .update(mobileLoginCodes)
          .set({ consumedAt: now })
          .where(
            and(
              eq(mobileLoginCodes.codeHash, codeHash),
              isNull(mobileLoginCodes.consumedAt),
            ),
          )
          .returning();
        if (!consumed) return null;

        await tx
          .update(mobileLoginCodes)
          .set({ sessionBearerToken: null })
          .where(eq(mobileLoginCodes.id, consumed.id));

        return consumed;
      });
    },

    async findByCodeHash(codeHash) {
      const [found] = await database
        .select()
        .from(mobileLoginCodes)
        .where(eq(mobileLoginCodes.codeHash, codeHash));
      return found ?? null;
    },
  };
}

/** Default, database-backed repository used by application services. */
export const mobileLoginCodesRepository = createMobileLoginCodesRepository();
