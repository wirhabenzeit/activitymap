/**
 * Shadow-write one owner right after a write to Postgres, so the change
 * reaches Convex (and live clients) in seconds rather than at the next
 * scheduled mirror run.
 *
 * The returned function never rejects and does nothing for users who are not
 * shadow owners. Within one server process, requests for the same owner
 * coalesce: a request made while a run is in flight starts one more run
 * after it, so a write that the running pass has already read past is
 * still copied.
 *
 * Runs in different processes (another request, or the scheduled job) can
 * overlap. That is safe: writes are fenced by a run revision and each run
 * sends current state, so the worst case is that an older read wins until
 * the next run replays the recent change window (mirror.ts).
 */
export function createShadowMirrorTrigger(deps: {
  owners: () => string[] | null;
  run: (userId: string, deadline: number) => Promise<unknown>;
  now?: () => number;
  budgetMs?: number;
  onError?: (error: unknown, userId: string) => void;
}): (userId: string) => Promise<void> {
  const now = deps.now ?? Date.now;
  const running = new Map<string, { again: boolean; done: Promise<void> }>();
  return (userId) => {
    try {
      if (!deps.owners()?.includes(userId)) return Promise.resolve();
    } catch (error) {
      deps.onError?.(error, userId);
      return Promise.resolve();
    }
    const current = running.get(userId);
    if (current) {
      current.again = true;
      return current.done;
    }
    const entry = { again: false, done: Promise.resolve() };
    entry.done = (async () => {
      try {
        do {
          entry.again = false;
          await deps.run(userId, now() + (deps.budgetMs ?? 20_000));
        } while (entry.again);
      } catch (error) {
        deps.onError?.(error, userId);
      } finally {
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Map
        running.delete(userId);
      }
    })();
    running.set(userId, entry);
    return entry.done;
  };
}
