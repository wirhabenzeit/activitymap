import 'server-only';

import { z } from 'zod';

import { apiFailure } from '~/server/api/transport';
import type { Actor } from '~/server/auth/actor';

const epoch = z.string().regex(/^[A-Za-z0-9_-]{16,80}$/);
const configSchema = z.record(
  z.string(),
  z.union([
    // Isolated lab deployment (#495), authenticated with a per-owner key.
    z.object({ epoch, key: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    // Application backend (`backend/`) through the signed sync bridge. The
    // epoch must match the owner's current Convex assignment.
    // `live`: the web client reads through live Convex queries instead of
    // the REST sync (docs/convex-reactive-reads.md).
    z
      .object({
        epoch,
        transport: z.literal('app'),
        live: z.boolean().optional(),
      })
      .strict(),
  ]),
);
export type PreviewOwnerConfig = z.infer<typeof configSchema>[string];
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
