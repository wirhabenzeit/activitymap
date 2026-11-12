import { logger } from '~/server/logging/logger';

type Operation = 'rateLimits' | 'changesPage';
type Warning = { operation: Operation; status: 400; suppressed: number };

/** Bounded to two operation names, with at most one warning per minute per
 * operation and server process. Never accept user data or bridge bodies. */
export function createBridgeFallbackWarning(
  warn: (message: string, details: Warning) => void = logger.warn,
  now: () => number = () => performance.now(),
) {
  const warnings = new Map<Operation, { at: number; suppressed: number }>();
  return (operation: Operation) => {
    const at = now();
    const previous = warnings.get(operation);
    if (previous && at - previous.at < 60_000) {
      previous.suppressed++;
      return;
    }
    warnings.set(operation, { at, suppressed: 0 });
    warn('[Convex] using compatibility fallback', {
      operation,
      status: 400,
      suppressed: previous?.suppressed ?? 0,
    });
  };
}

export const warnBridgeFallback = createBridgeFallbackWarning();
