import 'server-only';

import { convexStravaAppAttemptsRepository } from '~/server/auth/convex-strava-app-attempts';

/**
 * A sign-in started in the installed Strava app (issue #305). The app returns
 * from Strava with an authorization code but without any browser cookie, so
 * this record, not a cookie, is what ties the return to the attempt that began
 * it. Only a hash of the `state` is kept.
 */
export type StravaAppAttempt = {
  id: string;
  stateHash: string;
  pkceChallenge: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type NewStravaAppAttempt = Pick<
  StravaAppAttempt,
  'stateHash' | 'pkceChallenge' | 'expiresAt'
>;

export interface StravaAppAttemptsRepository {
  create(record: NewStravaAppAttempt): Promise<StravaAppAttempt>;
  /**
   * Atomically marks the attempt matching `stateHash` as consumed and returns
   * it as it was, or `null` when none exists or it was already consumed. One
   * of two concurrent callers wins. The caller checks `expiresAt` itself, so
   * an expired attempt is consumed here too and never reusable.
   */
  consumeByStateHash(
    stateHash: string,
    now: Date,
  ): Promise<StravaAppAttempt | null>;
  /** Only to tell "unknown" from "already used" in an error. */
  findByStateHash(stateHash: string): Promise<StravaAppAttempt | null>;
}

export const stravaAppAttemptsRepository = convexStravaAppAttemptsRepository();
