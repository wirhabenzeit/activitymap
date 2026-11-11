import { type NextRequest, NextResponse } from 'next/server';

import { withJobLog } from '~/server/application/job-log';
import { authStoreIsConvex } from '~/server/auth/store';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import { logger } from '~/server/logging/logger';
import {
  convexDispatchConfigured,
  dispatchWebhookInboxToConvex,
} from '~/server/strava/webhook-dispatch';
import {
  DEFAULT_DRAIN_BATCH_SIZE,
  DEFAULT_DRAIN_CONCURRENCY,
  drainWebhookInbox,
  getWebhookInboxMetrics,
  reconcileStuckWebhookEvents,
} from '~/server/strava/webhook-drain';

const drainInbox = withJobLog(
  'drain-webhook-inbox',
  async (options: { batchSize: number; concurrency: number }) => {
    const reconciled = await reconcileStuckWebhookEvents();
    const drainResult = await drainWebhookInbox(options);
    // Events of owners Convex writes for, which the drain leaves alone.
    const convex = convexDispatchConfigured()
      ? await dispatchWebhookInboxToConvex()
      : null;
    const metrics = await getWebhookInboxMetrics();
    return { reconciled, ...drainResult, convex, metrics };
  },
  {
    summarize: ({ metrics, convex, ...counts }) => ({
      ...counts,
      convexSent: convex?.sent ?? 0,
      convexDeferred: convex?.deferred ?? 0,
      deadLetterTotal: metrics.countsByStatus.dead_letter ?? 0,
      failedTotal: metrics.countsByStatus.failed ?? 0,
      pendingTotal: metrics.countsByStatus.pending ?? 0,
    }),
  },
);

/**
 * Scheduled drain of the Strava webhook inbox (issue #125).
 *
 * Each run:
 * 1. Resets any row stuck in `processing` past a stale-lock timeout (a
 *    crashed worker) back to retryable - the reconciliation safety net.
 * 2. Claims and processes a bounded, concurrency-limited batch of due
 *    `pending`/`failed` rows, applying retry/backoff/dead-lettering to
 *    whatever does not succeed. Deletion (`aspect_type: "delete"`) and
 *    athlete deauthorization (`object_type: "athlete"`) events are
 *    prioritized ahead of routine create/update events - see
 *    docs/strava-data-policy.md §3.
 * 3. Logs backlog/dead-letter/sync-lag metrics as a structured line (this
 *    codebase has no metrics backend; see `getWebhookInboxMetrics`'s doc
 *    comment).
 *
 * Authentication mirrors `/api/cron/sync-activities`: an `x-cron-secret`
 * header matching `CRON_SECRET`, and `externalEffectsEnabled()` fails
 * closed outside Production.
 *
 * The Cloudflare Worker calls this route once per hour.
 */
export async function POST(request: NextRequest) {
  // With the app's records in Convex there is no inbox: an event is
  // recorded in Convex before Strava is answered.
  if (authStoreIsConvex())
    return NextResponse.json({ skipped: 'Webhook events go to Convex' });
  if (!externalEffectsEnabled()) {
    return NextResponse.json(
      { error: EXTERNAL_EFFECTS_DISABLED_MESSAGE },
      { status: 503 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET is not set in environment variables');
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  const providedSecret = request.headers.get('x-cron-secret');
  if (providedSecret !== cronSecret) {
    logger.error('Invalid cron secret provided for drain-webhook-inbox');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let batchSize = DEFAULT_DRAIN_BATCH_SIZE;
  let concurrency = DEFAULT_DRAIN_CONCURRENCY;
  try {
    const parsedBody: unknown = await request.json();
    if (parsedBody !== null && typeof parsedBody === 'object') {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.batchSize === 'number') batchSize = body.batchSize;
      if (typeof body.concurrency === 'number') concurrency = body.concurrency;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    // No body (or invalid JSON) - use defaults.
  }

  try {
    const result = await drainInbox({ batchSize, concurrency });
    logger.info('[Cron] drain-webhook-inbox complete', result);
    return NextResponse.json(result);
  } catch (error) {
    logger.error('[Cron] drain-webhook-inbox failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to drain webhook inbox',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
