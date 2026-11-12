import { AsyncLocalStorage } from 'node:async_hooks';

type Measurement = { calls: number; durationMs: number };
export type RequestTimings = Map<string, Measurement>;
const scope = new AsyncLocalStorage<RequestTimings>();

export const withRequestTimings = <T>(
  timings: RequestTimings,
  work: () => Promise<T>,
) => scope.run(timings, work);

/** Request-local diagnostics only: no credentials, IDs, bodies or cross-request cache. */
export async function timeRequestWork<T>(
  phase: string,
  work: () => Promise<T>,
): Promise<T> {
  const timings = scope.getStore();
  if (!timings) return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    const previous = timings.get(phase) ?? { calls: 0, durationMs: 0 };
    timings.set(phase, {
      calls: previous.calls + 1,
      durationMs: previous.durationMs + performance.now() - start,
    });
  }
}

export const timingSummary = (timings: RequestTimings) =>
  Object.fromEntries(
    [...timings].map(([phase, value]) => [
      phase,
      { calls: value.calls, durationMs: Math.round(value.durationMs) },
    ]),
  );
