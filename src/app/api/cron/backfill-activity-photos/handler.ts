import type { PhotoBackfillResult } from '~/server/application/photo-backfill';

export function createPhotoBackfillCronHandler(deps: {
  externalEffectsEnabled: () => boolean;
  isProduction: () => boolean;
  isEnabled: () => boolean;
  getCronSecret: () => string | undefined;
  backfill: () => Promise<PhotoBackfillResult>;
  onDisabled: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  return async function POST(request: Request) {
    if (!deps.externalEffectsEnabled() || !deps.isProduction())
      return Response.json(
        { error: 'Photo backfill requires production external effects' },
        { status: 503 },
      );
    const secret = deps.getCronSecret();
    if (!secret)
      return Response.json(
        { error: 'CRON_SECRET is not configured' },
        { status: 500 },
      );
    if (request.headers.get('x-cron-secret') !== secret)
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!deps.isEnabled()) {
      await deps.onDisabled();
      return Response.json({ disabled: true });
    }
    // Limits are fixed server-side, including a durable cap across repeated runs.
    try {
      return Response.json(await deps.backfill(), {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      deps.onError(error);
      return Response.json({ error: 'Photo backfill failed' }, { status: 500 });
    }
  };
}
