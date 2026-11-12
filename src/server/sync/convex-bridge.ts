import 'server-only';

import { createHmac } from 'node:crypto';

import { z } from 'zod';

import { timeRequestWork } from '~/server/api/request-timing';
import type { Actor } from '~/server/auth/actor';

import { SyncRebootstrapRequiredError } from './errors';

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

  async function send(operation: { kind: string }, epoch?: string) {
    const body = JSON.stringify({
      userId: actor.userId,
      athleteId: String(actor.athleteId),
      operation,
      epoch,
    });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`activitymap-sync-v1\n${version}\n${timestamp}\n${body}`)
      .digest('hex');
    const result = await timeRequestWork(
      operation.kind === 'changesPage'
        ? 'sync_page'
        : ['head', 'retention', 'changes'].includes(operation.kind)
          ? 'sync_metadata'
          : 'sync_entities',
      () =>
        fetcher(url, {
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
        }),
    );
    if (result.status === 409) {
      const error: unknown = await result.json().catch(() => null);
      if (
        z
          .object({ code: z.literal('sync_rebootstrap_required') })
          .safeParse(error).success
      )
        throw new SyncRebootstrapRequiredError();
    }
    if (!result.ok)
      throw new Error(`Convex sync bridge unavailable (${result.status})`);
    return result;
  }

  async function read(operation: { kind: string }, epoch?: string) {
    const payload: unknown = await (await send(operation, epoch)).json();
    return payload;
  }

  return {
    assignment: async () =>
      assignmentSchema.parse(await read({ kind: 'assignment' })),
    read,
    /** The raw response, for binary payloads such as stored recordings. */
    send,
  };
}
