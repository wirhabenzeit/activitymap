import 'server-only';

import { z } from 'zod';

import { type ActivityDTO, activityDTOSchema } from '~/contracts/v1/activity';
import { type PhotoDTO, photoDTOSchema } from '~/contracts/v1/photo';
import type { Actor } from '~/server/auth/actor';

import { convexWriteBridge } from './convex-writer';

const appliedSchema = z
  .object({
    activity: activityDTOSchema.nullable(),
    photos: z.array(photoDTOSchema),
  })
  .nullable();

/**
 * Activity commands for an owner Convex writes for
 * (backend/convex/ingestion.ts, `known` and `apply`), through the signed
 * write bridge with the owner's current epoch. Convex refuses both unless it
 * is the owner's writer.
 */
export function convexActivityCommands(
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
    /** Whether the activity is in the owner's library. */
    async known(id: string): Promise<boolean> {
      return writer.write<boolean>(
        { kind: 'activityKnown', id },
        await current(),
      );
    },
    /**
     * Write what the provider just said about an activity in the library:
     * its state with, when they were read, its photos, or its deletion
     * (`dto: null`). Returns what clients now see, or null when the
     * activity is not in the library.
     */
    async apply(input: {
      id: string;
      dto: Omit<ActivityDTO, 'streams' | 'placeMatches'> | null;
      photos?: PhotoDTO[];
    }) {
      return appliedSchema.parse(
        await writer.write(
          { kind: 'applyActivity', ...input },
          await current(),
        ),
      );
    },
  };
}
export type ConvexActivityCommands = ReturnType<typeof convexActivityCommands>;
