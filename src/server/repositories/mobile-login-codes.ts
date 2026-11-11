import 'server-only';

import { convexMobileLoginCodesRepository } from '~/server/auth/convex-mobile-login-codes';
import type { MobileLoginCode } from '~/server/db/schema';

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
  consumeByCodeHash(
    codeHash: string,
    now: Date,
  ): Promise<MobileLoginCode | null>;
  /**
   * Non-atomic lookup used only to distinguish "no such code" from
   * "already consumed" when reporting a replay error after
   * `consumeByCodeHash` returns `null`. Never used to authorize anything.
   */
  findByCodeHash(codeHash: string): Promise<MobileLoginCode | null>;
}

/** The codes, kept in the sign-in store in Convex. */
export const mobileLoginCodesRepository = convexMobileLoginCodesRepository();
