import {
  DEFAULT_ERASURE_BATCH_SIZE,
  MAX_ERASURE_BATCH_SIZE,
  type ErasureRunResult,
} from '~/server/strava/erasure';

export interface ErasureCronHandlerDependencies {
  externalEffectsEnabled: () => boolean;
  externalEffectsDisabledMessage: string;
  getCronSecret: () => string | undefined;
  eraseDue: (options: { batchSize: number }) => Promise<ErasureRunResult>;
  onError?: (message: string, error?: unknown) => void;
}

async function parseBatchSize(request: Request): Promise<number | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return DEFAULT_ERASURE_BATCH_SIZE;
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const value = (body as Record<string, unknown>).batchSize;
  if (value === undefined) return DEFAULT_ERASURE_BATCH_SIZE;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_ERASURE_BATCH_SIZE
  ) {
    return null;
  }
  return value;
}

export function createErasureCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage,
  getCronSecret,
  eraseDue,
  onError = () => undefined,
}: ErasureCronHandlerDependencies) {
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
      onError('Invalid cron secret provided for erase-revoked-athletes');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const batchSize = await parseBatchSize(request);
    if (batchSize === null) {
      return Response.json(
        {
          error: `batchSize must be an integer between 1 and ${MAX_ERASURE_BATCH_SIZE}`,
        },
        { status: 400 },
      );
    }

    try {
      const result = await eraseDue({ batchSize });
      if (result.failed > 0) {
        return Response.json(
          { error: 'One or more due erasures failed', ...result },
          { status: 500 },
        );
      }
      return Response.json(result);
    } catch (error) {
      onError('[Cron] erase-revoked-athletes failed', error);
      return Response.json(
        { error: 'Failed to erase due revoked athletes' },
        { status: 500 },
      );
    }
  };
}
