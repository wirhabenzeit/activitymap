import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '~/server/logging/logger';
import {
  EXTERNAL_EFFECTS_DISABLED_MESSAGE,
  externalEffectsEnabled,
} from '~/server/config/external-effects';
import {
  DEFAULT_DRAIN_BATCH_SIZE,
  DEFAULT_DRAIN_CONCURRENCY,
  drainWebhookInbox,
  getWebhookInboxMetrics,
  reconcileStuckWebhookEvents,
} from '~/server/strava/webhook-drain';

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
 * This repository has no `vercel.json` - `sync-activities` is instead
 * scheduled via a GitHub Actions workflow
 * (`.github/workflows/fetch.yml`) that POSTs to it on a cron trigger, so
 * this route is registered the same way, in
 * `.github/workflows/drain-webhook-inbox.yml`.
 */
export async function POST(request: NextRequest) {
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
    const reconciled = await reconcileStuckWebhookEvents();
    const drainResult = await drainWebhookInbox({ batchSize, concurrency });
    const metrics = await getWebhookInboxMetrics();

    logger.info('[Cron] drain-webhook-inbox complete', {
      reconciled,
      ...drainResult,
      metrics,
    });

    return NextResponse.json({ reconciled, ...drainResult, metrics });
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
