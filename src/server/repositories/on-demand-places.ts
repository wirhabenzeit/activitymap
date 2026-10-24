import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  type ActivityPlacesResponse,
  activityPlacesResponseSchema,
} from '~/contracts/activity-places';
import type { PlaceDebugSettings } from '~/contracts/place-debug';
import { debugActivityPlaces } from '~/server/application/debug-activity-places';
import {
  ActivityPlacesInputChangedError,
  ActivityPlacesUnavailableError,
  matchActivityPlaces,
} from '~/server/application/match-activity-places';
import type { Actor } from '~/server/auth/actor';
import { isAdminAthlete } from '~/server/config/admin';
import { db } from '~/server/db';
import {
  activities,
  activityStreams,
  placeCatalogues,
} from '~/server/db/schema';
import { V1_PLACE_REGION } from '~/server/places/catalogue-regions';
import { validatePublishedCatalogue } from '~/server/places/published-catalogue';

import {
  currentPlaceStreams,
  eligiblePlaceActivity,
  placeStreamsTooLarge,
} from './place-matching-input';
import { createPlaceDiscoveryRepository } from './places';

const eligible = eligiblePlaceActivity;
const current = currentPlaceStreams;
const tooLarge = placeStreamsTooLarge;

type InputRow = {
  too_large: boolean;
  generation: string | null;
  revision: string;
  source_version: string | null;
  payload: unknown;
};
type FenceRow = {
  generation: string | null;
  revision: string;
  source_version: string | null;
  current: boolean;
};

/** Uses only stored GPS. One read-only snapshot binds input, coverage and places. */
export function createOnDemandPlacesRepository(database: typeof db = db) {
  async function evaluate<T>(
    actor: Actor,
    activityId: string,
    run: (options: Parameters<typeof matchActivityPlaces>[0]) => Promise<T>,
  ): Promise<T> {
    const result = await database.transaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT set_config('statement_timeout', '10000', true)`,
        );
        const input = (
          await tx.execute<InputRow>(sql`
          SELECT s.generation::text, COALESCE(s.revision::text, '0') AS revision,
            s.source_version, ${tooLarge} AS too_large, CASE WHEN ${current} AND NOT (${tooLarge}) THEN jsonb_build_object('latlng', s.payload->'latlng', 'time', s.payload->'time', 'distance', s.payload->'distance', 'altitude', s.payload->'altitude') ELSE NULL END AS payload
          FROM ${activities} a LEFT JOIN ${activityStreams} s ON s.activity_id = a.id
          WHERE ${eligible(actor, activityId)}
        `)
        ).rows[0];
        if (!input) throw new ActivityPlacesUnavailableError();
        let catalogue = null;
        if (input.payload !== null) {
          const [row] = await tx
            .select({
              snapshotId: placeCatalogues.snapshotId,
              regionId: placeCatalogues.regionId,
              manifest: placeCatalogues.manifest,
              coverage: placeCatalogues.coverage,
            })
            .from(placeCatalogues)
            .where(
              and(
                eq(placeCatalogues.active, true),
                inArray(placeCatalogues.regionId, [
                  V1_PLACE_REGION,
                  'switzerland',
                ]),
              ),
            )
            .orderBy(
              sql`CASE WHEN ${placeCatalogues.regionId} = ${V1_PLACE_REGION} THEN 0 ELSE 1 END`,
            )
            .limit(1);
          if (row) {
            catalogue = validatePublishedCatalogue(row);
            if (
              catalogue.manifest.catalogue_snapshot_id !== row.snapshotId ||
              (catalogue.manifest.region_id &&
                catalogue.manifest.region_id !== row.regionId)
            )
              throw new Error('Published catalogue identity disagrees');
          }
        }
        const discovery = createPlaceDiscoveryRepository({
          execute: async <T extends Record<string, unknown>>(
            query: Parameters<typeof tx.execute>[0],
          ) => (await tx.execute<T>(query)).rows as T[],
        });
        const response = await run({
          userId: actor.userId,
          activityId,
          input,
          catalogue,
          discover: discovery.discover,
        });
        return { input, response };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    // Recheck outside the snapshot: revocation, deletion or stream replacement
    // during matching must fence the private response, as with stream reads.
    const latest = (
      await database.execute<FenceRow>(sql`
        SELECT s.generation::text, COALESCE(s.revision::text, '0') AS revision,
          s.source_version, COALESCE(${current}, false) AS current
        FROM ${activities} a LEFT JOIN ${activityStreams} s ON s.activity_id = a.id
        WHERE ${eligible(actor, activityId)}
      `)
    ).rows[0];
    if (!latest) throw new ActivityPlacesUnavailableError();
    if (
      latest.generation !== result.input.generation ||
      latest.revision !== result.input.revision ||
      latest.source_version !== result.input.source_version ||
      (result.input.payload !== null && !latest.current)
    )
      throw new ActivityPlacesInputChangedError();
    return result.response;
  }
  return {
    match: async (
      actor: Actor,
      activityId: string,
    ): Promise<ActivityPlacesResponse> =>
      activityPlacesResponseSchema.parse(
        await evaluate(actor, activityId, matchActivityPlaces),
      ),
    debug: async (
      actor: Actor,
      activityId: string,
      settings: PlaceDebugSettings,
    ) => {
      if (!isAdminAthlete(actor.athleteId))
        throw new ActivityPlacesUnavailableError();
      return evaluate(actor, activityId, (options) =>
        debugActivityPlaces({ ...options, settings }),
      );
    },
  };
}
