import { z } from 'zod';
import type { StreamBackfillResult } from '~/server/application/stream-backfill';
import {
  STREAM_BACKFILL_DEFAULT_ACTIVITIES,
  STREAM_BACKFILL_DEFAULT_REQUESTS,
  STREAM_BACKFILL_MAX_ACTIVITIES,
  STREAM_BACKFILL_MAX_REQUESTS,
} from '~/server/strava/stream-backfill-policy';

const parameters = z
  .object({
    activityLimit: z
      .number()
      .int()
      .min(1)
      .max(STREAM_BACKFILL_MAX_ACTIVITIES)
      .default(STREAM_BACKFILL_DEFAULT_ACTIVITIES),
    requestLimit: z
      .number()
      .int()
      .min(1)
      .max(STREAM_BACKFILL_MAX_REQUESTS)
      .default(STREAM_BACKFILL_DEFAULT_REQUESTS),
  })
  .strict();

export function createStreamBackfillCronHandler(dependencies: {
  externalEffectsEnabled: () => boolean;
  isProduction: () => boolean;
  isEnabled: () => boolean;
  getCronSecret: () => string | undefined;
  backfill: (
    options: z.infer<typeof parameters>,
  ) => Promise<StreamBackfillResult>;
  onResult?: (result: StreamBackfillResult) => void;
  onError?: (error: unknown) => void;
}) {
  return async function POST(request: Request) {
    if (!dependencies.externalEffectsEnabled() || !dependencies.isProduction())
      return Response.json(
        { error: 'Stream backfill requires production external effects' },
        { status: 503 },
      );
    const secret = dependencies.getCronSecret();
    if (!secret)
      return Response.json(
        { error: 'CRON_SECRET is not configured' },
        { status: 500 },
      );
    if (request.headers.get('x-cron-secret') !== secret)
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!dependencies.isEnabled()) return Response.json({ disabled: true });
    const text = await request.text();
    let body: unknown;
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = parameters.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: 'Invalid backfill limits' },
        { status: 400 },
      );
    try {
      const result = await dependencies.backfill(parsed.data);
      dependencies.onResult?.(result);
      return Response.json(result, {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      dependencies.onError?.(error);
      return Response.json(
        { error: 'Stream backfill failed' },
        { status: 500 },
      );
    }
  };
}
