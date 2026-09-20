import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { reconcileStravaSummaries } from '~/server/strava/summary-reconciliation';
import { createSummaryReconciliationCronHandler } from './handler';

// The reconciler intentionally checkpoints work across invocations. A single
// Strava page plus its transactional change-feed writes can exceed Vercel's
// legacy 10-second default, so allow the Hobby-plan maximum while retaining
// the bounded page/account limits in the worker itself.
export const maxDuration = 60;

/** Production-only, resumable seven-day Strava summary reconciliation. */
export const POST = createSummaryReconciliationCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage: EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  getCronSecret: () => process.env.CRON_SECRET,
  reconcile: reconcileStravaSummaries,
  onError: (message, error) => logger.error(message, error),
});
