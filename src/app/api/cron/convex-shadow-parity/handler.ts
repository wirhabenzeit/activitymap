import type { ParityReport } from '~/server/convex-mirror/parity';

import { createConvexShadowCronHandler } from '../mirror-convex-shadow/handler';

/** The response keeps counts and field names; examples (activity values) go
 * only to the logs. */
export function paritySummary(report: ParityReport) {
  return {
    ...report,
    differences: Object.fromEntries(
      Object.entries(report.differences).map(([field, { count }]) => [
        field,
        count,
      ]),
    ),
  };
}

/**
 * Compare a sample of each shadow owner's Postgres data with Convex. Off and
 * protected like the shadow writes; answers 500 on drift or a failed check.
 */
export function createConvexParityCronHandler(deps: {
  owners: () => string[] | null | Promise<string[] | null>;
  secret: () => string | undefined;
  check: (userId: string) => Promise<ParityReport>;
  onReport?: (report: ParityReport, userId: string) => void;
  onError?: (error: unknown, userId: string) => void;
  now?: () => number;
  budgetMs?: number;
}) {
  return createConvexShadowCronHandler({
    owners: deps.owners,
    secret: deps.secret,
    now: deps.now,
    budgetMs: deps.budgetMs,
    run: async (userId) => {
      const report = await deps.check(userId);
      deps.onReport?.(report, userId);
      return report;
    },
    failed: (report) => report.status === 'drift',
    present: paritySummary,
    errorMessage: 'Parity check failed',
    onError: deps.onError,
  });
}
