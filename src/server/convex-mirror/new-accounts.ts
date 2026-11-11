import type { Writer } from '~/server/db/schema';

/**
 * A new account starts on Convex. Its very first request for activities
 * (the client's "fetch from Strava" after sign-up) is where that is
 * decided: an account that has nothing in Postgres and no library in
 * Convex is given one, handed to Convex at once (there is nothing to copy),
 * and its reconciliation sweep fills the library from the provider's list.
 * Accounts that already have activities in Postgres are left to the
 * operator's move (accounts.ts).
 *
 * Returns how many activities the account has after the sweep's first
 * pages, or null when the request belongs to the Postgres path.
 */
export type FirstFetchDeps = {
  /** Whether new accounts start on Convex in this deployment. */
  enabled: boolean;
  account(): Promise<{
    writer: Writer;
    convexEpoch: string | null;
    hasActivities: boolean;
  } | null>;
  /** Give the account a library in Convex. */
  prepare(): Promise<unknown>;
  /** Hand the account to Convex; who writes afterwards. */
  move(): Promise<{ writer: Writer; reason?: string }>;
  /** Start the account's sweep unless one is under way. */
  startSweep(): Promise<unknown>;
  sweep(): Promise<{ phase: string; page: number } | null>;
  /** Activities in the account's library in Convex. */
  count(): Promise<number>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  onFallback?: (reason: string) => void;
};

/** The first list pages hold up to this many activities. */
const FIRST_FETCH = 200;
const WAIT_MS = 15_000;
const POLL_MS = 500;

export class LibraryMoving extends Error {
  constructor() {
    super('The library is being moved. Try again in a few minutes.');
    this.name = 'LibraryMoving';
  }
}

export async function firstFetchThroughConvex(
  deps: FirstFetchDeps,
): Promise<number | null> {
  const account = await deps.account();
  if (!account) return null;
  if (account.writer === 'handoff') throw new LibraryMoving();
  if (account.writer === 'postgres') {
    if (!deps.enabled || account.convexEpoch || account.hasActivities)
      return null;
    await deps.prepare();
    const moved = await deps.move();
    if (moved.writer !== 'convex') {
      // Still with Postgres: the usual first fetch serves the request.
      deps.onFallback?.(moved.reason ?? 'The account was not moved');
      return null;
    }
  }
  await deps.startSweep();
  // Until the sweep has read two pages, or has finished reading.
  const now = deps.now ?? Date.now;
  const wait =
    deps.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const deadline = now() + WAIT_MS;
  for (;;) {
    const sweep = await deps.sweep();
    if (sweep && (sweep.phase !== 'scanning' || sweep.page > 2)) break;
    if (now() >= deadline) break;
    await wait(POLL_MS);
  }
  return Math.min(FIRST_FETCH, await deps.count());
}
