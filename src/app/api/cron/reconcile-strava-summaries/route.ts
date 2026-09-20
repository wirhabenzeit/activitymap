import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import { reconcileStravaSummaries } from '~/server/strava/summary-reconciliation';
import { createSummaryReconciliationCronHandler } from './handler';

/** Production-only, resumable seven-day Strava summary reconciliation. */
export const POST = createSummaryReconciliationCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage: EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  getCronSecret: () => process.env.CRON_SECRET,
  reconcile: reconcileStravaSummaries,
  onError: (message, error) => logger.error(message, error),
});
