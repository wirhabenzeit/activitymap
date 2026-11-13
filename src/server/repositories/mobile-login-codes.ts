import 'server-only';

import { convexMobileLoginCodesRepository } from '~/server/auth/convex-mobile-login-codes';
import type { MobileLoginCode } from '~/server/records';

export type NewMobileLoginCode = {
  codeHash: string;
  state: string;
  pkceChallenge: string;
  redirectUri: string;
  userId: string;
  sessionBearerToken: string;
  expiresAt: Date;
};

/** Atomic login-code repository boundary. Convex implements it in
 * `~/server/auth/convex-mobile-login-codes.ts`; authentication unit tests
 * use an in-memory implementation of the same consume-once contract.
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
