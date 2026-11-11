export { shadowOwners } from '~/server/convex-mirror/shadow-owners';

/**
 * Run a job for each configured shadow owner: the shadow writes themselves,
 * or the parity check. Owners run one after another within one time budget; a
 * failing owner does not stop the others, and each continues from its own
 * checkpoint next time. The response is 500 when any owner threw or its
 * result counts as a failure, so the scheduler's history shows it.
 */
export function createConvexShadowCronHandler<T>(deps: {
  owners: () => string[] | null | Promise<string[] | null>;
  secret: () => string | undefined;
  run: (userId: string, deadline: number) => Promise<T>;
  /** Whether a completed run still fails the job (for example drift). */
  failed?: (result: T) => boolean;
  /** What the response says about an owner whose run threw. */
  errorMessage?: string;
  /** The per-owner entry in the response; defaults to the result. */
  present?: (result: T) => unknown;
  now?: () => number;
  budgetMs?: number;
  /** Give every owner a share of the budget instead of letting the first
   * one that has much to do use all of it. An owner that finishes early
   * leaves its time to the ones after it. */
  fair?: boolean;
  /** The least an owner gets when the budget is shared. */
  minSliceMs?: number;
  onError?: (error: unknown, userId: string) => void;
  /** Work that belongs to no owner (the place catalogue copy). Runs after
   * the owners with what is left of the budget, on behalf of the first
   * owner; its result is reported under `name` and a throw fails the job. */
  shared?: {
    name: string;
    run: (userId: string, deadline: number) => Promise<unknown>;
    onError?: (error: unknown) => void;
  };
}) {
  const now = deps.now ?? Date.now;
  return async (request: Request) => {
    const owners = await deps.owners();
    if (!owners)
      return Response.json(
        { error: 'Convex shadow writes are not configured' },
        { status: 503 },
      );
    const secret = deps.secret();
    if (!secret)
      return Response.json(
        { error: 'CRON_SECRET is not configured' },
        { status: 500 },
      );
    if (request.headers.get('x-cron-secret') !== secret)
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Steps finish after the deadline, and the route is killed at 60s.
    const deadline = now() + (deps.budgetMs ?? 40_000);
    const results: Record<string, unknown> = {};
    let failed = false;
    for (const [index, userId] of owners.entries()) {
      // With shares, an owner is not started with no time left at all.
      if (now() > deadline || (deps.fair && now() >= deadline)) {
        results[userId] = { skipped: 'time budget exhausted' };
        continue;
      }
      const share = Math.max(
        deps.minSliceMs ?? 5_000,
        (deadline - now()) / (owners.length - index),
      );
      try {
        const result = await deps.run(
          userId,
          deps.fair ? Math.min(deadline, now() + share) : deadline,
        );
        if (deps.failed?.(result)) failed = true;
        results[userId] = deps.present ? deps.present(result) : result;
      } catch (error) {
        failed = true;
        deps.onError?.(error, userId);
        results[userId] = { error: deps.errorMessage ?? 'Shadow write failed' };
      }
    }
    let shared: Record<string, unknown> | undefined;
    if (deps.shared && owners[0] !== undefined && now() <= deadline) {
      try {
        shared = {
          [deps.shared.name]: await deps.shared.run(owners[0], deadline),
        };
      } catch (error) {
        failed = true;
        deps.shared.onError?.(error);
        shared = { [deps.shared.name]: { error: 'Failed' } };
      }
    }
    return Response.json(
      { results, ...shared },
      { status: failed ? 500 : 200, headers: { 'cache-control': 'no-store' } },
    );
  };
}

/** How many runs one scheduled trigger may chain: enough to fill the ten
 * minutes until the next trigger, and no more. */
export const MAX_CHAINED_RUNS = 9;
export const CHAIN_HEADER = 'x-mirror-chain';

/**
 * Whether another run should follow this one at once instead of at the next
 * scheduled trigger: some owner still has a copy to finish and this run got
 * somewhere. A run in which nobody advanced (or everybody failed) is left
 * to the schedule, so a copy that cannot move does not spin.
 */
export function shouldContinue(
  body: { results?: Record<string, unknown> } | null,
  chained: number,
): boolean {
  if (!body?.results || chained >= MAX_CHAINED_RUNS) return false;
  const results = Object.values(body.results).filter(
    (result): result is Record<string, unknown> =>
      typeof result === 'object' && result !== null,
  );
  const unfinished = results.some(
    (result) =>
      result.complete === false || result.skipped === 'time budget exhausted',
  );
  const advanced = results.some(
    (result) => typeof result.activities === 'number' && result.activities > 0,
  );
  return unfinished && advanced;
}
