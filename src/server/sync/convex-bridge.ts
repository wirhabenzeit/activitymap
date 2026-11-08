import 'server-only';

import { createHmac } from 'node:crypto';

import { z } from 'zod';

import type { Actor } from '~/server/auth/actor';

const assignmentSchema = z.discriminatedUnion('backend', [
  z.object({ backend: z.literal('postgres'), epoch: z.string().nullable() }),
  z.object({ backend: z.literal('convex'), epoch: z.string() }),
]);

/** Call from trusted server entry points after authentication. An unavailable
 * configured assignment service fails closed so callers cannot split writers. */
export function convexSyncBridge(
  actor: Pick<Actor, 'userId' | 'athleteId'>,
  fetcher: typeof fetch = fetch,
) {
  const origin = process.env.ACTIVITYMAP_CONVEX_SITE;
  if (!origin) return null;
  const url = new URL('/internal/sync/v1', origin);
  const version = process.env.ACTIVITYMAP_CONVEX_KEY_ID ?? '';
  const secret = process.env.ACTIVITYMAP_CONVEX_SIGNING_KEY ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !/^[0-9a-f]{64}$/.test(secret)
  )
    throw new Error('Invalid Convex bridge configuration');

  async function request(operation: { kind: string }, epoch?: string) {
    const body = JSON.stringify({
      userId: actor.userId,
      athleteId: String(actor.athleteId),
      operation,
      epoch,
    });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', secret)
      .update(`activitymap-sync-v1\n${version}\n${timestamp}\n${body}`)
      .digest('hex');
    const result = await fetcher(url, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        'X-ActivityMap-Key-Id': version,
        'X-ActivityMap-Timestamp': timestamp,
        'X-ActivityMap-Signature': signature,
      },
      body,
    });
    if (!result.ok) throw new Error('Convex sync bridge unavailable');
    const payload: unknown = await result.json();
    return payload;
  }

  return {
    assignment: async () =>
      assignmentSchema.parse(await request({ kind: 'assignment' })),
    read: request,
  };
}
