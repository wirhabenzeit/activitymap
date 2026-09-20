/**
 * Runs `worker` over `items` with at most `limit` concurrent calls in
 * flight at once - a minimal stand-in for a dependency like `p-limit`
 * (issue #125: this codebase does not depend on one, and draining the
 * webhook inbox does not warrant adding one). Each of `limit` lanes pulls
 * the next item off `items` as soon as it finishes its current one, so a
 * batch finishes in roughly `items.length / limit` sequential steps rather
 * than `items.length`. A rejected `worker` call propagates (via
 * `Promise.all`) after every lane has settled its current item; it does
 * not stop other lanes mid-flight.
 */
export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const boundedLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function runLane(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined && index >= items.length) return;
      await worker(item as T, index);
    }
  }

  await Promise.all(Array.from({ length: boundedLimit }, () => runLane()));
}
