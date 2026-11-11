'use node';

import {
  catalogueIdentity,
  matchingVersion,
} from '../../src/server/places/matching-version';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

/**
 * Make the newest complete place catalogue the one libraries are matched
 * against. Run after a catalogue is published (`pnpm places:publish` does),
 * and after a deployment that changes the matching recipe:
 * `convex run catalogueWorker:adopt`.
 *
 * The matching version is computed here, from the recipe in the deployed
 * code, so it is the one the ingestion worker looks for when it matches.
 */
export const adopt = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ snapshotId: string; revision: string; libraries: number }> => {
    const rowset: { snapshotId: string; revision: string } | null =
      await ctx.runQuery(internal.places.latest, {});
    if (!rowset) throw new Error('No complete place catalogue');
    const version = matchingVersion(rowset);
    const libraries: number = await ctx.runMutation(internal.catalogue.adopt, {
      catalogue: catalogueIdentity(version),
      matchingVersion: version,
    });
    const { snapshotId, revision } = rowset;
    // `libraries`: how many of the first page of owners were moved.
    return { snapshotId, revision, libraries };
  },
});
