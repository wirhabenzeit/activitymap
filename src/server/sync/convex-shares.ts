import 'server-only';

import { z } from 'zod';

import { sharedActivityDTOSchema } from '~/contracts/share/activity';
import type { Actor } from '~/server/auth/actor';

import { convexWriteBridge } from './convex-writer';

const fieldsSchema = z.object({ showRouteEnds: z.boolean() });
const linkSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  revokedAt: z.number().nullable(),
  fields: fieldsSchema,
  activityIds: z.array(z.string()),
});
export type ConvexShareLink = z.infer<typeof linkSchema>;

const viewSchema = z
  .object({
    athleteId: z.string(),
    createdAt: z.number(),
    expiresAt: z.number(),
    fields: fieldsSchema,
    activities: z.array(sharedActivityDTOSchema),
  })
  .nullable();

/**
 * Share links of an account Convex writes for (backend/convex/shares.ts),
 * through the signed write bridge with the owner's current epoch.
 */
export function convexShareLinks(
  owner: Pick<Actor, 'userId' | 'athleteId'>,
  fetcher: typeof fetch = fetch,
) {
  const writer = convexWriteBridge(owner, fetcher);
  if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  let epoch: Promise<string> | undefined;
  const current = () =>
    (epoch ??= writer
      .write<{ epoch: string } | null>({ kind: 'state' })
      .then((state) => {
        if (!state) throw new Error('The owner is not provisioned in Convex');
        return state.epoch;
      }));
  return {
    /** Null when one of the activities is not in the owner's library. */
    async create(input: {
      tokenHash: string;
      expiresAt: number;
      fields: { showRouteEnds: boolean };
      activityIds: string[];
    }) {
      return linkSchema
        .nullable()
        .parse(
          await writer.write(
            { kind: 'createShare', ...input },
            await current(),
          ),
        );
    },
    async list() {
      return z
        .array(linkSchema)
        .parse(await writer.write({ kind: 'listShares' }, await current()));
    },
    async revoke(id: string) {
      return writer.write<boolean>(
        { kind: 'revokeShare', id },
        await current(),
      );
    },
  };
}
export type ConvexShareLinks = ReturnType<typeof convexShareLinks>;

/**
 * What a share token discloses when the link lives in Convex, or null. The
 * token is the credential, so the request carries no owner; null as well
 * when no Convex site is configured.
 */
export async function convexShareView(
  tokenHash: string,
  fetcher: typeof fetch = fetch,
) {
  // The bridge signs for a caller; this operation ignores who it is.
  const writer = convexWriteBridge(
    { userId: 'share-view', athleteId: 0 },
    fetcher,
  );
  if (!writer) return null;
  return viewSchema.parse(await writer.write({ kind: 'shareView', tokenHash }));
}
