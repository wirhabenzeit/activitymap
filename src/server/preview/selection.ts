import 'server-only';

import { z } from 'zod';

import { apiFailure } from '~/server/api/transport';
import type { Actor } from '~/server/auth/actor';

const configSchema = z.record(
  z.string(),
  z.object({
    epoch: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
    key: z.string().regex(/^[0-9a-f]{64}$/),
  }),
);
export function previewModeEnabled() {
  return (
    process.env.ACTIVITYMAP_CLIENT_BACKEND === 'convex-preview' &&
    process.env.VERCEL_ENV !== 'production' &&
    (process.env.NODE_ENV !== 'production' ||
      process.env.VERCEL_ENV === 'preview')
  );
}

export function previewSelection(actor: Pick<Actor, 'userId'> | null) {
  if (!actor || !previewModeEnabled()) return null;
  let value: unknown;
  try {
    value = JSON.parse(process.env.ACTIVITYMAP_CONVEX_PREVIEW_OWNERS ?? '{}');
  } catch {
    throw new Error('Invalid Convex preview configuration');
  }
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid Convex preview configuration');
  const owners = parsed.data;
  return Object.hasOwn(owners, actor.userId) ? owners[actor.userId] : null;
}

/** Keep routes without a preview data adapter on the production backend. */
export async function previewDataUnavailable(
  resolveActor: () => Promise<Actor | null>,
  requestId: string,
) {
  return previewModeEnabled() && previewSelection(await resolveActor())
    ? apiFailure(
        requestId,
        503,
        'internal_error',
        'This operation is unavailable in the fixture preview.',
      )
    : null;
}

export function assertPostgresDataActor(actor: Actor) {
  if (previewSelection(actor))
    throw new Error('Operation unavailable in fixture preview');
}
