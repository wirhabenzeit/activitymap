import { activityPlacesResponseSchema } from '~/contracts/activity-places';

/** Share a small network budget across map and detail observers. Queued work
 * releases immediately on deselection/account changes, before issuing a fetch. */
export function createPlaceRequestQueue(limit = 2) {
  let active = 0;
  const waiting: { key?: string; start: () => void }[] = [];
  const run = async <T>(
    signal: AbortSignal,
    work: () => Promise<T>,
    key?: string,
  ): Promise<T> => {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const item = {
        key,
        start: () => {
          signal.removeEventListener('abort', abort);
          active++;
          resolve();
        },
      };
      const abort = () => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Aborted', 'AbortError'),
        );
      };
      if (active < limit) item.start();
      else {
        waiting.push(item);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      active--;
      waiting.shift()?.start();
    }
  };
  run.prioritize = (key: string) => {
    const index = waiting.findIndex((item) => item.key === key);
    if (index > 0) waiting.unshift(waiting.splice(index, 1)[0]!);
  };
  return run;
}
const queued = createPlaceRequestQueue();
export function prioritizeActivityPlaces(userId: string, activityId: string) {
  queued.prioritize(`${userId}:${activityId}`);
}
export function fetchActivityPlaces(options: {
  userId: string;
  activityId: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}) {
  return queued(
    options.signal,
    async () => {
      const response = await (options.fetchImpl ?? fetch)(
        `/api/activities/${options.activityId}/places`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: options.signal,
        },
      );
      if (!response.ok)
        throw new Error('Places could not be loaded. Try again.');
      const result = activityPlacesResponseSchema.parse(await response.json());
      if (
        result.userId !== options.userId ||
        result.activityId !== options.activityId
      )
        throw new Error('The account or activity changed.');
      return result;
    },
    `${options.userId}:${options.activityId}`,
  );
}
