import { z } from 'zod';

const ownersSchema = z.array(z.string().min(1).max(128)).max(50);

/** `ACTIVITYMAP_CONVEX_SHADOW_OWNERS`: a JSON array of application user IDs.
 * Unset means the job is off. */
export function shadowOwners(value: string | undefined): string[] | null {
  if (!value) return null;
  return ownersSchema.parse(JSON.parse(value));
}

/**
 * Shadow-write the configured owners' recent Postgres changes into Convex.
 * Owners run one after another within one time budget; a failing owner does
 * not stop the others, and each continues from its own checkpoint next time.
 */
export function createConvexShadowCronHandler(deps: {
  owners: () => string[] | null;
  secret: () => string | undefined;
  run: (userId: string, deadline: number) => Promise<unknown>;
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
        results[userId] = await deps.run(userId, deadline);
      } catch (error) {
        failed = true;
        deps.onError?.(error, userId);
        results[userId] = { error: 'Shadow write failed' };
      }
    }
    return Response.json(
      { results },
      { status: failed ? 500 : 200, headers: { 'cache-control': 'no-store' } },
    );
  };
}
