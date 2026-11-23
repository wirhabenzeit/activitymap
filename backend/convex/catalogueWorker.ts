'use node';

import {
  catalogueIdentity,
  matchingVersion,
} from '../../src/server/places/matching-version';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

/**
 * Move every library to the latest place catalogue (`places.latest`): the
 * live catalogue once it has been published, before that the newest
 * complete rowset. Publishing the live catalogue needs no adoption; run
 * `convex run catalogueWorker:adopt` once after its first publication, and
 * after a deployment that changes the matching recipe.
 *
 * The matching version is computed here, from the recipe in the deployed
 * code, so it is the one the ingestion worker looks for when it matches.
 */
export const adopt = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ snapshotId: string; revision: string; libraries: number }> => {
    const latest: { snapshotId: string; revision: string } | null =
      await ctx.runQuery(internal.places.latest, {});
    if (!latest) throw new Error('No complete place catalogue');
    const { snapshotId, revision } = latest;
    const version = matchingVersion(latest);
    const libraries: number = await ctx.runMutation(internal.catalogue.adopt, {
      catalogue: catalogueIdentity(version),
      matchingVersion: version,
      snapshotId,
      revision,
    });
    // `libraries`: how many of the first page of owners were moved.
    return { snapshotId, revision, libraries };
  },
});
