import type { Writer } from '~/server/db/schema';

/**
 * Moving an account's library between the two stores
 * (docs/convex-writer-cutover.md, "Handoff" and "Rollback").
 *
 * To Convex:
 * 1. Postgres stops writing for the account (`handoff`). The change waits
 *    for writes already under way, and webhook events are kept in the inbox.
 * 2. The mirror copies what is left, and the parity check compares the two
 *    stores. If the copy does not finish in time or the check finds drift,
 *    the account goes back to Postgres and nothing else has changed.
 * 3. Convex becomes the writer, then Postgres records the same.
 * 4. The events kept in step 1 are sent to Convex.
 *
 * Back to Postgres: Convex stops (`handoff`), Postgres becomes the writer
 * again, Convex records the same, and Postgres reconciliation is made due
 * at once so that it fetches from Strava what changed in the meantime.
 * Nothing is copied back from Convex.
 *
 * Both are safe to run again after an interruption: each step looks at the
 * two writers as they are and continues from there. Every change is a
 * compare-and-set on the writer epoch, so two runs cannot interleave.
 */

export type WriterState = { writer: Writer; epoch: number };

export type HandoffDeps = {
  postgres: {
    /** The account's writer and epoch, or null when there is no account. */
    state(): Promise<WriterState | null>;
    /** Compare-and-set; the new epoch, or null when the epoch has moved. */
    setWriter(writer: Writer, expectedEpoch: number): Promise<number | null>;
    /** Have Postgres reconcile the account with Strava at the next run. */
    reconcileNow(): Promise<void>;
  };
  convex: {
    /** The owner in Convex, or null when it is not provisioned. */
    state(): Promise<
      (WriterState & { backend: string; revoked: boolean }) | null
    >;
    setWriter(writer: Writer, expectedEpoch: number): Promise<number | null>;
  };
  /** One mirror run; `complete` when it reached the head. */
  mirror(deadline: number): Promise<{ complete: boolean }>;
  parity(): Promise<{
    status: 'ok' | 'drift';
    /** What differs, by field: how many activities. */
    differences?: Record<string, { count: number }>;
  }>;
  /** Send inbox events kept for accounts Convex writes for. */
  dispatch(): Promise<unknown>;
  now?: () => number;
  /** How long the copy may take before the handoff gives up. */
  budgetMs?: number;
};

export type HandoffReport = {
  outcome: 'moved' | 'already' | 'aborted';
  /** Who writes the account's library now. */
  writer: Writer;
  steps: string[];
  reason?: string;
};

const DEFAULT_BUDGET_MS = 40_000;

class Aborted extends Error {}

async function states(deps: HandoffDeps) {
  const [postgres, convex] = await Promise.all([
    deps.postgres.state(),
    deps.convex.state(),
  ]);
  if (!postgres) throw new Aborted('The account does not exist');
  if (!convex || convex.revoked)
    throw new Aborted('The account has no library in Convex');
  return { postgres, convex };
}

async function report(
  deps: HandoffDeps,
  steps: string[],
  work: () => Promise<'moved' | 'already'>,
): Promise<HandoffReport> {
  let outcome: HandoffReport['outcome'];
  let reason: string | undefined;
  try {
    outcome = await work();
  } catch (error) {
    if (!(error instanceof Aborted)) throw error;
    outcome = 'aborted';
    reason = error.message;
  }
  const writer = (await deps.postgres.state())?.writer ?? 'postgres';
  return { outcome, writer, steps, ...(reason && { reason }) };
}

/** A compare-and-set that must succeed for the run to go on. */
async function set(
  store: Pick<HandoffDeps['postgres'], 'setWriter'>,
  name: string,
  writer: Writer,
  expectedEpoch: number,
  steps: string[],
) {
  const epoch = await store.setWriter(writer, expectedEpoch);
  if (epoch === null)
    throw new Aborted(`${name} was changed by another handoff`);
  steps.push(`${name}: ${writer}`);
  return epoch;
}

export function handOffToConvex(deps: HandoffDeps): Promise<HandoffReport> {
  const steps: string[] = [];
  const now = deps.now ?? Date.now;
  return report(deps, steps, async () => {
    const { postgres, convex } = await states(deps);
    if (convex.backend !== 'convex')
      throw new Aborted('The account is not served from Convex');
    if (convex.writer === 'handoff')
      throw new Aborted('The account is being moved back to Postgres');
    if (postgres.writer === 'convex' && convex.writer === 'convex') {
      await deps.dispatch();
      return 'already';
    }
    if (postgres.writer === 'convex')
      throw new Aborted('Postgres says Convex writes, but Convex does not');

    let epoch = postgres.epoch;
    if (postgres.writer === 'postgres')
      epoch = await set(deps.postgres, 'Postgres', 'handoff', epoch, steps);

    if (convex.writer === 'postgres') {
      // Until Convex is the writer, giving up means going back to Postgres.
      const back = async (reason: string): Promise<never> => {
        await set(deps.postgres, 'Postgres', 'postgres', epoch, steps);
        throw new Aborted(reason);
      };
      const deadline = now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
      let complete = false;
      while (!complete && now() < deadline)
        ({ complete } = await deps.mirror(deadline));
      if (!complete)
        return back('The copy to Convex did not finish in time; try again');
      steps.push('Copy to Convex: complete');
      const parity = await deps.parity();
      if (parity.status !== 'ok') {
        // Field names and counts only: nothing of the library itself.
        const fields = Object.entries(parity.differences ?? {})
          .map(([field, { count }]) => `${field} (${count})`)
          .join(', ');
        return back(
          `The two stores differ${fields ? ` in ${fields}` : ''}; see the parity report`,
        );
      }
      steps.push('Parity: ok');
      if ((await deps.convex.setWriter('convex', convex.epoch)) === null)
        return back('Convex was changed by another handoff');
      steps.push('Convex: convex');
    }

    await set(deps.postgres, 'Postgres', 'convex', epoch, steps);
    await deps.dispatch();
    steps.push('Kept events: sent');
    return 'moved';
  });
}

export function handBackToPostgres(deps: HandoffDeps): Promise<HandoffReport> {
  const steps: string[] = [];
  return report(deps, steps, async () => {
    const { postgres, convex } = await states(deps);
    if (postgres.writer === 'postgres' && convex.writer === 'postgres')
      return 'already';
    let convexEpoch = convex.epoch;
    if (convex.writer === 'convex')
      convexEpoch = await set(
        deps.convex,
        'Convex',
        'handoff',
        convexEpoch,
        steps,
      );
    if (postgres.writer !== 'postgres')
      await set(deps.postgres, 'Postgres', 'postgres', postgres.epoch, steps);
    if (convex.writer !== 'postgres')
      await set(deps.convex, 'Convex', 'postgres', convexEpoch, steps);
    await deps.postgres.reconcileNow();
    steps.push('Postgres reconciliation: due now');
    return 'moved';
  });
}
