import { z } from 'zod';

import {
  PLACE_MATCHING_BATCH_SIZE,
  type PlaceMatchingResult,
} from '~/server/application/place-matching';

const limits = z.strictObject({
  activityLimit: z
    .number()
    .int()
    .min(1)
    .max(2_000)
    .default(PLACE_MATCHING_BATCH_SIZE),
});
export function createPlaceMatchingCronHandler(deps: {
  enabled: () => boolean;
  secret: () => string | undefined;
  run: (options: { activityLimit: number }) => Promise<PlaceMatchingResult>;
  onError?: (error: unknown) => void;
}) {
  return async (request: Request) => {
    if (!deps.enabled())
      return Response.json(
        { error: 'Background matching requires production external effects' },
        { status: 503 },
      );
    const secret = deps.secret();
    if (!secret)
      return Response.json(
        { error: 'CRON_SECRET is not configured' },
        { status: 500 },
      );
    if (request.headers.get('x-cron-secret') !== secret)
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    let body: unknown;
    try {
      const text = await request.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = limits.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: 'Invalid matching limits' },
        { status: 400 },
      );
    try {
      return Response.json(await deps.run(parsed.data), {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      deps.onError?.(error);
      return Response.json({ error: 'Place matching failed' }, { status: 500 });
    }
  };
}
