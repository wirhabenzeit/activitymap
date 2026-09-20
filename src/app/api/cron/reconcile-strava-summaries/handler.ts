import {
  DEFAULT_RECONCILIATION_BATCH_SIZE,
  DEFAULT_PAGES_PER_ATHLETE,
  MAX_RECONCILIATION_BATCH_SIZE,
  MAX_PAGES_PER_ATHLETE,
  type SummaryReconciliationRunResult,
} from '~/server/strava/summary-reconciliation';

export interface SummaryReconciliationCronHandlerDependencies {
  externalEffectsEnabled: () => boolean;
  externalEffectsDisabledMessage: string;
  getCronSecret: () => string | undefined;
  reconcile: (options: {
    batchSize: number;
    pagesPerAthlete: number;
  }) => Promise<SummaryReconciliationRunResult>;
  onError?: (message: string, error?: unknown) => void;
}

type ReconciliationParameters = {
  batchSize: number;
  pagesPerAthlete: number;
};

async function parseParameters(
  request: Request,
): Promise<ReconciliationParameters | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      batchSize: DEFAULT_RECONCILIATION_BATCH_SIZE,
      pagesPerAthlete: DEFAULT_PAGES_PER_ATHLETE,
    };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const batchSize =
    (body as Record<string, unknown>).batchSize ??
    DEFAULT_RECONCILIATION_BATCH_SIZE;
  const pagesPerAthlete =
    (body as Record<string, unknown>).pagesPerAthlete ??
    DEFAULT_PAGES_PER_ATHLETE;
  if (
    typeof batchSize !== 'number' ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_RECONCILIATION_BATCH_SIZE ||
    typeof pagesPerAthlete !== 'number' ||
    !Number.isInteger(pagesPerAthlete) ||
    pagesPerAthlete < 1 ||
    pagesPerAthlete > MAX_PAGES_PER_ATHLETE
  ) {
    return null;
  }
  return { batchSize, pagesPerAthlete };
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
    const parameters = await parseParameters(request);
    if (parameters === null) {
      return Response.json(
        {
          error:
            `batchSize must be an integer between 1 and ${MAX_RECONCILIATION_BATCH_SIZE}; ` +
            `pagesPerAthlete must be an integer between 1 and ${MAX_PAGES_PER_ATHLETE}`,
        },
        { status: 400 },
      );
    }

    try {
      const result = await reconcile(parameters);
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
