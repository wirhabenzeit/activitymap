import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import type {
  LivePlaceRequest,
  LivePlaceResponse,
} from '~/contracts/live-places';
import { livePlaceResponseSchema } from '~/contracts/live-places';
import {
  type ActivityMatchReport,
  runActivityPlaceMatching,
} from '~/server/application/activity-places';
import type { Actor } from '~/server/auth/actor';
import { localPlacesEnabled } from '~/server/config/local-places';
import { resolveDatabaseConnection } from '~/server/db/connection';
import { createActivityPlacesRepository } from '~/server/repositories/activity-places';
import { createPlacesRepository } from '~/server/repositories/places';

import { loadCatalogueArtifact } from './catalogue-artifact';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
} from './policy';

// Frozen, validated local catalogue only. Each run checks the database snapshot.
let cataloguePromise: ReturnType<typeof loadCatalogueArtifact> | undefined;
function catalogue() {
  return (cataloguePromise ??= loadCatalogueArtifact(
    process.env.ACTIVITYMAP_LOCAL_PLACE_CATALOGUE ??
      'output/places/switzerland-2026-10-20',
  ).catch((error) => {
    cataloguePromise = undefined;
    throw error;
  }));
}

export async function matchLivePlaces(
  actor: Actor,
  request: LivePlaceRequest,
): Promise<LivePlaceResponse> {
  if (!localPlacesEnabled())
    throw new Error('Local place matching is disabled');
  const start = performance.now();
  const frozen = await catalogue();
  const policy = { ...DEFAULT_MATCHER_POLICY, ...request.thresholds };
  const client = postgres(
    resolveDatabaseConnection(process.env).connectionString,
    {
      max: 2,
      prepare: false,
      connection: {
        statement_timeout: 15000,
        lock_timeout: 2000,
        application_name: 'local-live-place-preview',
      },
      onnotice: () => undefined,
    },
  );
  try {
    const reports: ActivityMatchReport[] = [];
    const records = await runActivityPlaceMatching({
      actor,
      activityIds: request.activityIds,
      catalogue: frozen,
      policy,
      identity: {
        runId: randomUUID(),
        catalogueSnapshotId: frozen.manifest.catalogue_snapshot_id,
        matcherVersion: MATCHER_VERSION,
        parametersHash: parametersHash(policy),
      },
      repositories: {
        places: createPlacesRepository(client),
        activityPlaces: {
          ...createActivityPlacesRepository(client),
          // Preview does not publish; independent reads need no publication lock.
          withAthleteRunLock: async (_actor, work) => work(),
        },
      },
      apply: false,
      onReport: async (report) => {
        reports.push(report);
      },
      onRecord: async () => undefined,
    });
    const ids = [
      ...new Set(
        reports.flatMap((report) =>
          report.candidates.map((candidate) => candidate.id),
        ),
      ),
    ];
    const metadata = new Map(
      (ids.length
        ? await client<
            {
              id: string;
              osm_type: 'node' | 'way' | 'relation';
              osm_id: string;
            }[]
          >`
      SELECT id, osm_type, osm_id::text FROM places WHERE id IN ${client(ids)}
    `
        : []
      ).map((row) => [row.id, row]),
    );
    const places = new Map<string, LivePlaceResponse['places'][number]>();
    const encounters: LivePlaceResponse['encounters'] = [];
    const candidates = new Map<
      string,
      LivePlaceResponse['candidates'][number]
    >();
    for (const report of reports) {
      const complete =
        records.find((record) => record.activityId === report.activityId)
          ?.outcome === 'complete';
      for (const candidate of report.candidates) {
        const source = metadata.get(candidate.id)!;
        const relations =
          report.matches.find((match) => match.placeId === candidate.id)
            ?.evidence.supported_relations ?? [];
        const supportedKinds = candidate.kinds.filter(
          (kind) =>
            complete &&
            relations.includes(
              kind === 'peak'
                ? 'reached_peak'
                : kind === 'pass'
                  ? 'visited_pass'
                  : 'arrived_at_hut',
            ),
        );
        let entry = candidates.get(candidate.id);
        if (!entry) {
          entry = {
            id: candidate.id,
            name: candidate.displayName,
            kinds: candidate.kinds,
            elevationM: candidate.elevationM ?? null,
            longitude: candidate.location.longitude,
            latitude: candidate.location.latitude,
            osmType: source.osm_type,
            osmId: source.osm_id,
            activityIds: [],
            evaluations: [],
          };
          candidates.set(candidate.id, entry);
        }
        entry.activityIds.push(report.activityId);
        entry.evaluations.push({
          activityId: report.activityId,
          complete,
          supportedKinds,
        });
      }
      for (const match of report.matches) {
        const candidate = report.candidates.find(
          (place) => place.id === match.placeId,
        )!;
        const supported = match.evidence.supported_relations.length > 0;
        encounters.push({
          activityId: report.activityId,
          placeId: candidate.id,
          name: candidate.displayName,
          distanceM: Math.min(
            ...match.evidence.encounters.flatMap((e) =>
              e.fragments.map((f) => f.min_horizontal_distance_m),
            ),
          ),
          supported,
          encounters: match.evidence.encounters.length,
        });
        if (!supported || !complete) continue;
        const existing = places.get(candidate.id);
        if (existing) {
          existing.activityIds.push(report.activityId);
          continue;
        }
        const source = metadata.get(candidate.id)!;
        places.set(candidate.id, {
          id: candidate.id,
          name: candidate.displayName,
          kinds: candidate.kinds,
          elevationM: candidate.elevationM ?? null,
          longitude: candidate.location.longitude,
          latitude: candidate.location.latitude,
          osmType: source.osm_type,
          osmId: source.osm_id,
          activityIds: [report.activityId],
        });
      }
    }
    return livePlaceResponseSchema.parse({
      userId: actor.userId,
      places: [...places.values()],
      encounters,
      candidates: [...candidates.values()],
      activities: records.map(({ activityId, outcome, reasons }) => ({
        activityId,
        outcome,
        reasons,
      })),
      durationMs: Math.round(performance.now() - start),
    });
  } finally {
    await client.end({ timeout: 2 });
  }
}
