import {
  DEFAULT_RECONCILIATION_BATCH_SIZE,
  MAX_RECONCILIATION_BATCH_SIZE,
  type SummaryReconciliationRunResult,
} from '~/server/strava/summary-reconciliation';

export interface SummaryReconciliationCronHandlerDependencies {
  externalEffectsEnabled: () => boolean;
  externalEffectsDisabledMessage: string;
  getCronSecret: () => string | undefined;
  reconcile: (options: {
    batchSize: number;
  }) => Promise<SummaryReconciliationRunResult>;
  onError?: (message: string, error?: unknown) => void;
}

async function parseBatchSize(request: Request): Promise<number | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return DEFAULT_RECONCILIATION_BATCH_SIZE;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const value = (body as Record<string, unknown>).batchSize;
  if (value === undefined) return DEFAULT_RECONCILIATION_BATCH_SIZE;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_RECONCILIATION_BATCH_SIZE
  ) {
    return null;
  }
  return value;
}

export function createSummaryReconciliationCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage,
  getCronSecret,
  reconcile,
  onError = () => undefined,
}: SummaryReconciliationCronHandlerDependencies) {
  return async function POST(request: Request): Promise<Response> {
    if (!externalEffectsEnabled()) {
      return Response.json(
        { error: externalEffectsDisabledMessage },
        { status: 503 },
      );
    }
    const cronSecret = getCronSecret();
    if (!cronSecret) {
      onError('CRON_SECRET is not configured');
      return Response.json(
        { error: 'CRON_SECRET is not configured' },
        { status: 500 },
      );
    }
    if (request.headers.get('x-cron-secret') !== cronSecret) {
      onError('Invalid cron secret provided for reconcile-strava-summaries');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const batchSize = await parseBatchSize(request);
    if (batchSize === null) {
      return Response.json(
        {
          error: `batchSize must be an integer between 1 and ${MAX_RECONCILIATION_BATCH_SIZE}`,
        },
        { status: 400 },
      );
    }

    try {
      const result = await reconcile({ batchSize });
      if (result.failed > 0) {
        return Response.json(
          { error: 'One or more summary reconciliations failed', ...result },
          { status: 500 },
        );
      }
      return Response.json(result);
    } catch (error) {
      onError('[Cron] reconcile-strava-summaries failed', error);
      return Response.json(
        { error: 'Failed to reconcile Strava summaries' },
        { status: 500 },
      );
    }
  };
}
