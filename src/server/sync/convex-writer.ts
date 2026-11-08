import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';

import type { Actor } from '~/server/auth/actor';

export type ConvexWriter = {
  /** Run one write-bridge operation for the actor's owner scope. */
  write<T = unknown>(
    operation: { kind: string; [field: string]: unknown },
    epoch?: string,
  ): Promise<T>;
};

/**
 * Signed client for `backend/`'s write route. Uses its own key (separate from
 * the read bridge's) and a fresh single-use nonce per request. Returns null
 * when no Convex site is configured, so callers stay inert by default.
 */
export function convexWriteBridge(
  actor: Pick<Actor, 'userId' | 'athleteId'>,
  fetcher: typeof fetch = fetch,
): ConvexWriter | null {
  const origin = process.env.ACTIVITYMAP_CONVEX_SITE;
  if (!origin) return null;
  const url = new URL('/internal/write/v1', origin);
  const version = process.env.ACTIVITYMAP_CONVEX_WRITER_KEY_ID ?? '';
  const secret = process.env.ACTIVITYMAP_CONVEX_WRITER_SIGNING_KEY ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
    !/^[0-9a-f]{64}$/.test(secret)
  )
    throw new Error('Invalid Convex write bridge configuration');

  return {
    async write<T>(
      operation: { kind: string; [field: string]: unknown },
      epoch?: string,
    ) {
      const body = JSON.stringify({
        userId: actor.userId,
        athleteId: String(actor.athleteId),
        epoch,
        nonce: randomBytes(18).toString('base64url'),
        operation,
      });
      const timestamp = String(Date.now());
      const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
        .update(`activitymap-write-v1\n${version}\n${timestamp}\n${body}`)
        .digest('hex');
      const response = await fetcher(url, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        // Recording preparation decodes a batch of files in one call.
        signal: AbortSignal.timeout(120_000),
        headers: {
          'Content-Type': 'application/json',
          'X-ActivityMap-Key-Id': version,
          'X-ActivityMap-Timestamp': timestamp,
          'X-ActivityMap-Signature': signature,
        },
        body,
      });
      if (!response.ok)
        throw new Error(
          `Convex write bridge rejected ${operation.kind} (${response.status})`,
        );
      return (await response.json()) as T;
    },
  };
}
