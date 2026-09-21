export interface CleanupRateLimitsCronHandlerDependencies {
  externalEffectsEnabled: () => boolean;
  externalEffectsDisabledMessage: string;
  getCronSecret: () => string | undefined;
  now?: () => Date;
  /** Buckets are purged this far past their window's start - comfortably longer than any configured rate-limit window (see `~/server/api/rate-limit-boundary.ts`), so a bucket is never deleted while it could still be read by an in-flight request. */
  retentionMs?: number;
  deleteWindowsBefore: (cutoff: Date) => Promise<number>;
  onError?: (message: string, error?: unknown) => void;
}

export const DEFAULT_RATE_LIMIT_BUCKET_RETENTION_MS = 60 * 60 * 1000; // 1 hour

export function createCleanupRateLimitsCronHandler({
  externalEffectsEnabled,
  externalEffectsDisabledMessage,
  getCronSecret,
  now = () => new Date(),
  retentionMs = DEFAULT_RATE_LIMIT_BUCKET_RETENTION_MS,
  deleteWindowsBefore,
  onError = () => undefined,
}: CleanupRateLimitsCronHandlerDependencies) {
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
      onError('Invalid cron secret provided for cleanup-rate-limits');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const cutoff = new Date(now().getTime() - retentionMs);
      const deleted = await deleteWindowsBefore(cutoff);
      return Response.json({ deleted, cutoff: cutoff.toISOString() });
    } catch (error) {
      onError('[Cron] cleanup-rate-limits failed', error);
      return Response.json(
        { error: 'Failed to clean up rate-limit buckets' },
        { status: 500 },
      );
    }
  };
}
