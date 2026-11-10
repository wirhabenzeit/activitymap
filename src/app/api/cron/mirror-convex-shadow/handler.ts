export { shadowOwners } from '~/server/convex-mirror/shadow-owners';

/**
 * Run a job for each configured shadow owner: the shadow writes themselves,
 * or the parity check. Owners run one after another within one time budget; a
 * failing owner does not stop the others, and each continues from its own
 * checkpoint next time. The response is 500 when any owner threw or its
 * result counts as a failure, so the scheduler's history shows it.
 */
export function createConvexShadowCronHandler<T>(deps: {
  owners: () => string[] | null;
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
  onError?: (error: unknown, userId: string) => void;
}) {
  const now = deps.now ?? Date.now;
  return async (request: Request) => {
    const owners = deps.owners();
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
    for (const userId of owners) {
      if (now() > deadline) {
        results[userId] = { skipped: 'time budget exhausted' };
        continue;
      }
      try {
        const result = await deps.run(userId, deadline);
        if (deps.failed?.(result)) failed = true;
        results[userId] = deps.present ? deps.present(result) : result;
      } catch (error) {
        failed = true;
        deps.onError?.(error, userId);
        results[userId] = { error: deps.errorMessage ?? 'Shadow write failed' };
      }
    }
    return Response.json(
      { results },
      { status: failed ? 500 : 200, headers: { 'cache-control': 'no-store' } },
    );
  };
}
