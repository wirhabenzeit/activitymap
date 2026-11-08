'use node';

import { createHash } from 'node:crypto';

import { v } from 'convex/values';

import { canonicalJson } from '../../../../../src/server/places/catalogue-artifact';
import { MATCHING_RECIPE_HASH } from '../../../../../src/server/places/matching-version';
import { validatePublishedCatalogue } from '../../../../../src/server/places/published-catalogue-core';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';

export const verify = internalAction({
  args: {
    artifact: v.string(),
    revision: v.string(),
    rowsHash: v.string(),
    count: v.number(),
  },
  handler: async (
    ctx,
    { artifact, revision, rowsHash, count },
  ): Promise<Id<'matchingCatalogues'>> => {
    const catalogue = validatePublishedCatalogue(JSON.parse(artifact));
    const snapshotId = catalogue.manifest.catalogue_snapshot_id;
    if (catalogue.manifest.counts.total !== count)
      throw new Error('Catalogue manifest count differs');
    const hash = createHash('sha256');
    let cursor: string | null = null;
    let priorKey = '';
    let total = 0;
    while (true) {
      const page: {
        page: Doc<'places'>[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.matchingCatalogue.verificationPage, {
        snapshotId,
        paginationOpts: { cursor, numItems: 512 },
      });
      for (const {
        dataset,
        key,
        latitude,
        longitude,
        tile,
        metadata,
      } of page.page) {
        if (
          key <= priorKey ||
          key !== metadata?.id ||
          latitude !== metadata.location.latitude ||
          longitude !== metadata.location.longitude ||
          tile !==
            `${Math.floor((longitude + 180) * 4)},${Math.floor((latitude + 90) * 4)}`
        )
          throw new Error('Invalid catalogue index row');
        priorKey = key;
        total++;
        hash.update(
          canonicalJson({ dataset, key, latitude, longitude, tile, metadata }) +
            '\n',
        );
      }
      if (total > count) throw new Error('Catalogue exceeds manifest count');
      if (page.isDone) break;
      if (cursor === page.continueCursor || page.page.length === 0)
        throw new Error('Incomplete catalogue verification');
      cursor = page.continueCursor;
    }
    if (total !== count || hash.digest('hex') !== rowsHash)
      throw new Error('Catalogue digest differs');
    return ctx.runMutation(internal.matchingCatalogue.publish, {
      snapshotId,
      revision,
      recipe: MATCHING_RECIPE_HASH,
      count,
      rowsHash,
      artifact,
    });
  },
});
