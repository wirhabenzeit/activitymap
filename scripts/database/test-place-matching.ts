import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import {
  type ActivityMatchReport,
  runActivityPlaceMatching,
} from '../../src/server/application/activity-places';
import type { Actor } from '../../src/server/auth/actor';
import { verifyConnectedTarget } from '../../src/server/db/migration-tooling';
import { resolveCatalogueImportTarget } from '../../src/server/places/catalogue-import-target';
import { createSyntheticCatalogue } from '../../src/server/places/catalogue.fixture';
import { parseCoverageGeometry } from '../../src/server/places/coverage';
import {
  DEFAULT_MATCHER_POLICY,
  MATCHER_VERSION,
  parametersHash,
} from '../../src/server/places/policy';
import { createPlaceQueries } from '../../src/server/places/queries';
import type {
  ActivityMatchInput,
  ActivityRunRecord,
  EvaluationContext,
  PlaceMatch,
  RunIdentity,
} from '../../src/server/places/run-types';
import { buildActivityPlaceEvidence } from '../../src/server/places/types';
import {
  ActivityPlaceRunLockedError,
  ActivityPlacesUnavailableError,
  createActivityPlacesRepository,
} from '../../src/server/repositories/activity-places';
import { createPlacesRepository } from '../../src/server/repositories/places';

const target = resolveCatalogueImportTarget(process.env);
if (
  !process.env.MIGRATION_DATABASE_URL ||
  !target.isLocal ||
  process.env.MIGRATION_REQUIRE_TARGET_GUARDS !== 'true' ||
  !target.database.endsWith('_test')
)
  throw new Error(
    'Place matching proofs require an explicit guarded local *_test database',
  );

const scratch = `place_matching_proof_${randomUUID().replaceAll('-', '')}`;
const admin = postgres(target.connectionString, {
  max: 1,
  prepare: false,
  onnotice: () => undefined,
});
const client = postgres(target.connectionString, {
  max: 6,
  prepare: false,
  connection: {
    search_path: `${scratch},public`,
    statement_timeout: 15_000,
    lock_timeout: 5_000,
  },
  onnotice: () => undefined,
});
const repository = createActivityPlacesRepository(client);
const queries = createPlaceQueries(client);
const placesRepository = createPlacesRepository(client);
const actor: Actor = {
  userId: randomUUID(),
  athleteId: 9321401,
  authentication: 'cookie',
};
const otherActor: Actor = {
  userId: randomUUID(),
  athleteId: 9321402,
  authentication: 'bearer',
};
const ids = {
  first: '9007199254741101',
  second: '9007199254741103',
  missing: '9007199254741105',
  recreated: '9007199254741107',
  foreign: '9007199254741109',
  pipeline: '9007199254741111',
  pipelineZero: '9007199254741113',
};
const peakId = randomUUID();
const hutId = randomUUID();
const point = { longitude: 8.001, latitude: 46 };
const catalogue = createSyntheticCatalogue({
  transformRows: (rows) =>
    rows
      .filter((row) => row.kinds.includes('peak') || row.kinds.includes('hut'))
      .map((row) => ({
        ...row,
        location: point,
        elevation_m: 1000,
      })),
});
const snapshot = catalogue.manifest.catalogue_snapshot_id;
const identity = (): RunIdentity => ({
  runId: randomUUID(),
  catalogueSnapshotId: snapshot,
  matcherVersion: 'matching-proof-v1',
  parametersHash: 'a'.repeat(64),
});
const payload = {
  latlng: {
    type: 'latlng',
    data: [
      [46, 8.0006],
      [46, 8.001],
      [46, 8.0014],
      [46, 8.0014],
      [46, 8.001],
      [46, 8.0006],
    ],
    original_size: 6,
    resolution: 'high',
    series_type: 'time',
  },
  time: {
    type: 'time',
    data: [0, 10, 20, 30, 40, 50],
    original_size: 6,
    resolution: 'high',
    series_type: 'time',
  },
  altitude: {
    type: 'altitude',
    data: [1000, 1000, 1000, 1000, 1000, 1000],
    original_size: 6,
    resolution: 'high',
    series_type: 'time',
  },
};

function match(
  placeId: string,
  supported = true,
  repeated = false,
): PlaceMatch {
  const episode = {
    section_id: 0,
    start_gps_index: 0,
    end_gps_index: 2,
    closest: { kind: 'sample' as const, index: 1 },
    min_horizontal_distance_m: 0,
    source: { point, mapped_elevation_m: 1000 },
    recorded_altitude_m: 1000,
    altitude_difference_m: 0,
    relation_assessments: [
      {
        relation:
          placeId === peakId
            ? ('reached_peak' as const)
            : ('arrived_at_hut' as const),
        status: supported ? ('supported' as const) : ('nearby' as const),
        reason_codes: ['proof_fixture'],
      },
    ],
    quality_flags: [],
  };
  return {
    placeId,
    evidence: buildActivityPlaceEvidence(
      repeated
        ? [
            episode,
            {
              ...episode,
              section_id: 1,
              start_gps_index: 3,
              end_gps_index: 5,
              closest: { kind: 'sample', index: 4 },
            },
          ]
        : [episode],
    ),
  };
}

function record(input: ActivityMatchInput, count: number): ActivityRunRecord {
  return {
    activityId: input.activityId,
    input: input.tokens,
    outcome: 'complete',
    published: true,
    matchCount: count,
    reasons: [],
  };
}

function context(
  run: RunIdentity,
  records: ActivityRunRecord[],
  activityIds = records.map((row) => row.activityId),
): EvaluationContext {
  return { ...run, actor, records, activityIds };
}

async function addActivity(
  id: string,
  owner: Actor = actor,
  sport = 'Hike',
  day = '2026-10-22',
) {
  await client`
    INSERT INTO activities (id, public_id, athlete, name, sport_type, start_date, start_date_local, timezone, geometry_state, distance)
    VALUES (${id}::bigint, ${id}::bigint, ${owner.athleteId}, 'Matching proof', ${sport},
      '2026-10-21 23:30:00', ${`${day} 01:30:00`}::timestamp, 'Europe/Zurich', 'summary', 200)
  `;
}

async function addStream(id: string, samples = payload) {
  await client`
    INSERT INTO activity_streams (activity_id, generation, requested_types, payload, available_types, revision,
      source_version, fetched_at, last_attempt_at, last_attempt_status)
    SELECT id, ${randomUUID()}, ARRAY['latlng','time','altitude'], ${JSON.stringify(samples)}::jsonb, ARRAY['latlng','time','altitude'], 1,
      md5(activity_stream_source(activities)::text), now(), now(), 'succeeded'
    FROM activities WHERE id = ${id}::bigint
  `;
}

async function read(id: string) {
  const input = await repository.readInput(actor, id);
  assert(input);
  return input;
}

async function publicCounts() {
  return admin`SELECT (SELECT count(*)::text FROM public.places) AS places,
    (SELECT count(*)::text FROM public.activities) AS activities,
    (SELECT count(*)::text FROM public.activity_places) AS memberships`;
}

let created = false;
try {
  await verifyConnectedTarget(admin, target);
  const before = await publicCounts();
  await admin`CREATE SCHEMA ${admin(scratch)}`;
  created = true;
  for (const table of [
    'user',
    'account',
    'activities',
    'activity_streams',
    'places',
    'activity_places',
  ]) {
    await admin`CREATE TABLE ${admin(scratch)}.${admin(table)} (LIKE public.${admin(table)} INCLUDING ALL)`;
  }
  // LIKE deliberately excludes foreign keys and triggers. Install local FKs;
  // delegate the source projection to the application's authoritative function.
  // Omitting invalidation triggers also proves the independent source race guard.
  await client`ALTER TABLE account ADD FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE`;
  await client`ALTER TABLE activities ADD FOREIGN KEY (athlete) REFERENCES "user"(athlete_id) ON DELETE CASCADE`;
  await client`ALTER TABLE activity_streams ADD FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE`;
  await client`ALTER TABLE activity_places ADD FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE`;
  await client`ALTER TABLE activity_places ADD FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE RESTRICT`;
  await client.unsafe(`CREATE FUNCTION ${scratch}.activity_stream_source(a ${scratch}.activities) RETURNS jsonb
    LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT public.activity_stream_source(jsonb_populate_record(NULL::public.activities, to_jsonb(a)))
    $$`);
  for (const owner of [actor, otherActor]) {
    await client`INSERT INTO "user" (id, athlete_id) VALUES (${owner.userId}, ${owner.athleteId})`;
    await client`INSERT INTO account (id, "userId", "providerId", "accountId", "accessToken", "refreshToken")
      VALUES (${randomUUID()}, ${owner.userId}, 'strava', ${String(owner.athleteId)}, 'proof-access', 'proof-refresh')`;
  }
  await addActivity(ids.first);
  await addActivity(ids.second, actor, 'Ride', '2026-10-23');
  await addActivity(ids.missing);
  await addActivity(ids.recreated);
  await addActivity(ids.foreign, otherActor);
  for (const id of [ids.first, ids.second, ids.recreated, ids.foreign])
    await addStream(id);
  for (const row of catalogue.rows) {
    const id = row.kinds.includes('peak') ? peakId : hutId;
    await client`INSERT INTO places (id, osm_type, osm_id, kinds, subtypes, display_name, names, location, elevation_m,
      tags, osm_version, osm_updated_at, point_derivation, normalization_version, catalogue_snapshot_id)
      VALUES (${id}::uuid, ${row.osm_type}, ${row.osm_id}::bigint, ${row.kinds}, ${row.subtypes}, ${row.display_name},
        ${JSON.stringify(row.names)}::jsonb, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)::geography,
        1000, ${JSON.stringify(row.tags)}::jsonb, ${row.osm_version}, ${row.osm_updated_at}::timestamptz, ${row.point_derivation}, ${row.normalization_version}, ${snapshot})`;
  }

  await placesRepository.assertCatalogue(snapshot, catalogue.rows.length);
  const crossingRoute = {
    type: 'GeometryCollection' as const,
    geometries: [
      {
        type: 'LineString' as const,
        coordinates: [
          [8, 46],
          [8.002, 46],
        ],
      },
    ],
  };
  const discovery = {
    geometry: crossingRoute,
    coverage: catalogue.coverage,
    radiusM: 20,
    limit: 10,
    catalogueSnapshotId: snapshot,
  };
  const betweenSamples = await placesRepository.discover(discovery);
  assert.equal(betweenSamples.covered, true);
  assert.deepEqual(
    new Set(betweenSamples.candidates.map((candidate) => candidate.id)),
    new Set([peakId, hutId]),
    'Continuous segments discover places between sampled endpoints',
  );
  const limited = await placesRepository.discover({ ...discovery, limit: 1 });
  assert.equal(limited.candidates.length, 1);
  assert.equal(limited.truncated, true);
  const gap = await placesRepository.discover({
    ...discovery,
    geometry: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [8, 46] },
        { type: 'Point', coordinates: [8.002, 46] },
      ],
    },
  });
  assert.equal(gap.covered, true, 'Covered point sections need no line anchor');
  assert.equal(
    gap.candidates.length,
    0,
    'Disconnected sections never invent a line through a gap',
  );
  const atPlace = await placesRepository.discover({
    ...discovery,
    geometry: {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [8.001, 46] }],
    },
  });
  assert.equal(atPlace.covered, true);
  assert.deepEqual(
    new Set(atPlace.candidates.map((candidate) => candidate.id)),
    new Set([peakId, hutId]),
    'A point section uses its own position as the coverage anchor',
  );
  const concave = parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [7.99, 45.99],
          [8.02, 45.99],
          [8.02, 46.01],
          [8.0012, 46.01],
          [8.0012, 45.9995],
          [8.0008, 45.9995],
          [8.0008, 46.01],
          [7.99, 46.01],
          [7.99, 45.99],
        ],
      ],
    ],
  });
  assert.deepEqual(
    await placesRepository.discover({ ...discovery, coverage: concave }),
    { candidates: [], covered: false, truncated: false },
    'An interior anchor and endpoint cannot hide a section leaving and re-entering a concave region',
  );
  const disjoint = parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [7.999, 45.999],
          [8.0004, 45.999],
          [8.0004, 46.001],
          [7.999, 46.001],
          [7.999, 45.999],
        ],
      ],
      [
        [
          [8.0016, 45.999],
          [8.003, 45.999],
          [8.003, 46.001],
          [8.0016, 46.001],
          [8.0016, 45.999],
        ],
      ],
    ],
  });
  assert.deepEqual(
    await placesRepository.discover({ ...discovery, coverage: disjoint }),
    { candidates: [], covered: false, truncated: false },
    'A continuous section cannot bridge disjoint covered components',
  );
  assert.deepEqual(
    await placesRepository.discover({
      ...discovery,
      coverage: disjoint,
      geometry: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [8, 46] },
          { type: 'Point', coordinates: [8.002, 46] },
        ],
      },
    }),
    { candidates: [], covered: true, truncated: false },
    'Separate sections may each lie inside a different covered component',
  );
  assert.deepEqual(
    await placesRepository.discover({
      ...discovery,
      coverage: concave,
      geometry: {
        type: 'GeometryCollection',
        geometries: [
          {
            type: 'LineString',
            coordinates: [
              [8, 46],
              [8.0002, 46],
            ],
          },
          { type: 'Point', coordinates: [8.03, 46] },
        ],
      },
    }),
    { candidates: [], covered: false, truncated: false },
    'Every section needs an interior anchor, including a later disconnected point',
  );
  const hole = parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [7.99, 45.99],
          [8.02, 45.99],
          [8.02, 46.01],
          [7.99, 46.01],
          [7.99, 45.99],
        ],
        [
          [8.0008, 45.9998],
          [8.0008, 46.0002],
          [8.0012, 46.0002],
          [8.0012, 45.9998],
          [8.0008, 45.9998],
        ],
      ],
    ],
  });
  assert.deepEqual(
    await placesRepository.discover({ ...discovery, coverage: hole }),
    { candidates: [], covered: false, truncated: false },
    'Interior coverage gaps invalidate the whole corridor',
  );
  assert.deepEqual(
    await placesRepository.discover({
      ...discovery,
      coverage: hole,
      geometry: {
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [8.001, 46] }],
      },
    }),
    { candidates: [], covered: false, truncated: false },
    'A point anchor inside a coverage hole is outside the region',
  );
  const border = parseCoverageGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [7.99, 45.99995],
          [8.02, 45.99995],
          [8.02, 46.01],
          [7.99, 46.01],
          [7.99, 45.99995],
        ],
      ],
    ],
  });
  assert.equal(
    (await placesRepository.discover({ ...discovery, coverage: border }))
      .covered,
    false,
    'Samples inside coverage are insufficient when their discovery corridor crosses its edge',
  );
  await client.begin(async (transaction) => {
    await transaction`SET LOCAL enable_seqscan = off`;
    const plan = await transaction`EXPLAIN (FORMAT JSON)
      WITH sections AS MATERIALIZED (
        SELECT (ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(crossingRoute)}),4326))).geom::geography AS route
      ), selected AS (
        SELECT DISTINCT hit.id FROM sections
        CROSS JOIN LATERAL (
          SELECT id FROM places WHERE catalogue_snapshot_id = ${snapshot}
            AND ST_DWithin(location, sections.route, 20)
          OFFSET 0
        ) AS hit ORDER BY hit.id LIMIT 11
      ) SELECT p.id FROM places p JOIN selected ON selected.id = p.id ORDER BY p.id`;
    assert.match(
      JSON.stringify(plan),
      /places_location_idx/,
      'Discovery can use the geography GiST index',
    );
  });

  assert.equal(await repository.readInput(actor, ids.missing), null);
  await assert.rejects(
    repository.readInput(actor, ids.foreign),
    ActivityPlacesUnavailableError,
  );
  const first = await read(ids.first);
  const second = await read(ids.second);
  const run = identity();
  assert.equal(
    await repository.publish(actor, first, run, [
      match(peakId, true, true),
      match(hutId, false),
    ]),
    'published',
  );
  assert.equal(
    await repository.publish(actor, second, run, [match(peakId)]),
    'published',
  );
  const scope = context(run, [
    record(first, 2),
    record(second, 1),
    {
      activityId: ids.missing,
      outcome: 'missing_streams',
      published: false,
      matchCount: 0,
      reasons: ['missing_streams'],
    },
  ]);

  const firstRead = await queries.getActivityPlaces(actor, ids.first, scope);
  assert.equal(firstRead.status, 'current');
  assert.equal(firstRead.places.length, 2);
  assert.equal(
    firstRead.places.find((place) => place.id === peakId)?.evidence.encounters
      .length,
    2,
  );
  const ranking = await queries.getTopPlaces(actor, {}, scope);
  assert.deepEqual(
    ranking.items.map((row) => [row.placeId, row.activityCount]),
    [[peakId, 2]],
    'Episodes count as distinct activities; nearby hut is excluded',
  );
  assert.equal(ranking.evaluation.evaluatedActivities, 2);
  assert.equal(ranking.evaluation.incompleteActivities, 1);
  assert.equal(ranking.evaluation.complete, false);
  assert.equal(ranking.evaluation.basis, 'explicit_evaluation_scope');
  const localDay = await queries.listActivitiesForPlace(
    actor,
    peakId,
    {
      startDateLocal: '2026-10-22',
      endDateLocal: '2026-10-22',
      sportTypes: ['Hike'],
      relation: 'reached_peak',
      kind: 'peak',
    },
    scope,
  );
  assert.deepEqual(
    localDay.items.map((row) => row.activityId),
    [ids.first],
    'Filters use local start day, never UTC day',
  );
  assert.equal(localDay.evaluation.matchingEvaluatedActivities, 1);
  assert.equal(
    (
      await queries.getTopPlaces(
        actor,
        { startDateLocal: '2026-10-21', endDateLocal: '2026-10-21' },
        scope,
      )
    ).items.length,
    0,
  );
  const page = await queries.listActivitiesForPlace(
    actor,
    peakId,
    { limit: 1 },
    scope,
  );
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0]?.activityId, ids.second);
  assert.equal(
    (
      await queries.listActivitiesForPlace(
        actor,
        peakId,
        { limit: 1, offset: 1 },
        scope,
      )
    ).items[0]?.activityId,
    ids.first,
  );
  await assert.rejects(
    queries.getTopPlaces(otherActor, {}, scope),
    ActivityPlacesUnavailableError,
  );
  await assert.rejects(
    queries.getActivityPlaces(
      actor,
      ids.foreign,
      context(run, [], [ids.foreign]),
    ),
    ActivityPlacesUnavailableError,
  );
  await assert.rejects(
    queries.getTopPlaces(
      actor,
      {},
      { ...scope, activityIds: [...scope.activityIds, ids.foreign] },
    ),
    ActivityPlacesUnavailableError,
  );
  await assert.rejects(
    queries.getTopPlaces(
      { ...actor, athleteId: otherActor.athleteId },
      {},
      { ...scope, actor: { ...actor, athleteId: otherActor.athleteId } },
    ),
    ActivityPlacesUnavailableError,
  );

  for (const changed of [
    { ...scope, runId: randomUUID() },
    { ...scope, matcherVersion: 'other' },
    { ...scope, parametersHash: 'b'.repeat(64) },
    { ...scope, catalogueSnapshotId: 'other' },
  ]) {
    const result = await queries.getTopPlaces(actor, {}, changed);
    assert.equal(result.items.length, 0);
    assert.equal(result.evaluation.evaluatedActivities, 0);
  }
  const unrecorded = await queries.getActivityPlaces(
    actor,
    ids.first,
    context(run, [], [ids.first]),
  );
  assert.equal(
    unrecorded.status,
    'stale',
    'Rows alone never prove a completed evaluation',
  );
  const failed = context(run, [
    { ...record(first, 2), outcome: 'failed', published: false },
  ]);
  assert.equal((await queries.getTopPlaces(actor, {}, failed)).items.length, 0);

  // The latest failed refresh may retain valid previously fetched samples.
  await client`UPDATE activity_streams SET last_attempt_status = 'failed' WHERE activity_id = ${ids.first}::bigint`;
  assert(await repository.readInput(actor, ids.first));
  assert.equal(
    (await queries.getActivityPlaces(actor, ids.first, scope)).status,
    'current',
  );

  // Failure after deleting the old set must roll back the whole replacement.
  await client.unsafe(`CREATE FUNCTION ${scratch}.fail_hut_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.place_id = '${hutId}'::uuid THEN RAISE EXCEPTION 'proof injected failure'; END IF; RETURN NEW; END $$`);
  await client`CREATE TRIGGER fail_hut_insert BEFORE INSERT ON activity_places FOR EACH ROW EXECUTE FUNCTION fail_hut_insert()`;
  await assert.rejects(
    repository.publish(actor, first, identity(), [match(peakId), match(hutId)]),
    (error: unknown) => {
      let current = error;
      while (current instanceof Error) {
        if (current.message.includes('proof injected failure')) return true;
        current = current.cause;
      }
      return false;
    },
  );
  assert.deepEqual(
    await queries.getActivityPlaces(actor, ids.first, scope),
    firstRead,
  );
  await client`DROP TRIGGER fail_hut_insert ON activity_places`;

  // Recompute zero matches explicitly and atomically remove every prior row.
  const zeroRun = identity();
  assert.equal(
    await repository.publish(actor, first, zeroRun, []),
    'published',
  );
  const zero = context(zeroRun, [record(first, 0)]);
  assert.deepEqual(
    (await queries.getActivityPlaces(actor, ids.first, zero)).places,
    [],
  );
  assert.equal(
    (await queries.getActivityPlaces(actor, ids.first, zero)).status,
    'current',
  );
  assert.equal(
    (await queries.getTopPlaces(actor, {}, zero)).evaluation.complete,
    true,
  );
  assert.equal(
    (
      await queries.getActivityPlaces(
        actor,
        ids.first,
        context(zeroRun, [], [ids.first]),
      )
    ).status,
    'missing',
  );
  assert.equal(
    (await queries.getActivityPlaces(actor, ids.first, scope)).status,
    'stale',
  );
  assert.equal(
    await repository.publish(actor, first, zeroRun, []),
    'published',
    'Repeat zero publication is safe',
  );

  await client`UPDATE activities SET distance = distance + 1 WHERE id = ${ids.first}::bigint`;
  assert.equal(
    await repository.publish(actor, first, identity(), [match(peakId)]),
    'superseded',
    'Authoritative source change wins even without an invalidation trigger',
  );
  assert.equal(await repository.readInput(actor, ids.first), null);
  assert.equal(
    (await queries.getActivityPlaces(actor, ids.first, zero)).status,
    'stale',
  );
  await client`UPDATE activity_streams s SET source_version = md5(activity_stream_source(a)::text), revision = revision + 1
    FROM activities a WHERE s.activity_id = a.id AND a.id = ${ids.first}::bigint`;
  const refreshed = await read(ids.first);
  assert.equal(
    await repository.publish(actor, first, identity(), []),
    'superseded',
  );
  await client`UPDATE activity_streams SET generation = ${randomUUID()} WHERE activity_id = ${ids.first}::bigint`;
  assert.equal(
    await repository.publish(actor, refreshed, identity(), []),
    'superseded',
    'Old generation cannot publish',
  );
  const newGeneration = await read(ids.first);
  await client`UPDATE activity_streams SET revision = revision + 1 WHERE activity_id = ${ids.first}::bigint`;
  assert.equal(
    await repository.publish(actor, newGeneration, identity(), []),
    'superseded',
    'Old revision cannot publish',
  );
  assert.equal(
    (await queries.getTopPlaces(actor, {}, scope)).items[0]?.activityCount,
    1,
    'Stale input is excluded from counts',
  );

  const beforeDeletion = await read(ids.recreated);
  await client`DELETE FROM activities WHERE id = ${ids.recreated}::bigint`;
  await addActivity(ids.recreated);
  await addStream(ids.recreated);
  assert.equal(
    await repository.publish(actor, beforeDeletion, identity(), []),
    'superseded',
    'Recreated activity has a new stream generation',
  );

  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = repository.withAthleteRunLock(actor, async () => {
    entered();
    await gate;
    return 'released';
  });
  try {
    await ready;
    await assert.rejects(
      repository.withAthleteRunLock(actor, async () => undefined),
      ActivityPlaceRunLockedError,
    );
    assert.equal(
      await repository.withAthleteRunLock(
        otherActor,
        async () => 'other athlete',
      ),
      'other athlete',
    );
  } finally {
    release();
  }
  assert.equal(await held, 'released');
  assert.equal(
    await repository.withAthleteRunLock(actor, async () => 'reacquired'),
    'reacquired',
  );

  // Exercise the actual application service, pure matcher, spatial repository,
  // atomic persistence and queries together against invented stored streams.
  await addActivity(ids.pipeline);
  await addActivity(ids.pipelineZero);
  await addStream(ids.pipeline);
  await addStream(ids.pipelineZero, {
    ...payload,
    latlng: {
      ...payload.latlng,
      data: payload.latlng.data.map(([lat, lon]) => [lat!, lon! + 0.05]),
    },
  });
  const pipelineIdentity = (): RunIdentity => ({
    ...identity(),
    matcherVersion: MATCHER_VERSION,
    parametersHash: parametersHash(DEFAULT_MATCHER_POLICY),
  });
  const reports: ActivityMatchReport[] = [];
  const observedRecords: ActivityRunRecord[] = [];
  const pipelineOptions = {
    actor,
    activityIds: [ids.pipeline, ids.pipelineZero],
    catalogue,
    policy: DEFAULT_MATCHER_POLICY,
    repositories: { places: placesRepository, activityPlaces: repository },
    async onReport(report: ActivityMatchReport) {
      reports.push(report);
    },
    async onRecord(result: ActivityRunRecord) {
      observedRecords.push(result);
    },
  };
  const dryIdentity = pipelineIdentity();
  const dryRun = await runActivityPlaceMatching({
    ...pipelineOptions,
    identity: dryIdentity,
  });
  assert.deepEqual(
    dryRun.map((result) => [
      result.outcome,
      result.published,
      result.matchCount,
    ]),
    [
      ['complete', false, 2],
      ['complete', false, 0],
    ],
    'Dry run evaluates matching and zero activities without publication',
  );
  assert.equal(
    (
      await client`SELECT count(*)::integer AS count FROM activity_places
    WHERE activity_id IN (${ids.pipeline}::bigint, ${ids.pipelineZero}::bigint)`
    )[0]?.count,
    0,
  );
  assert.equal(
    (await queries.getTopPlaces(actor, {}, context(dryIdentity, dryRun)))
      .evaluation.evaluatedActivities,
    0,
  );
  const appliedIdentity = pipelineIdentity();
  const applied = await runActivityPlaceMatching({
    ...pipelineOptions,
    identity: appliedIdentity,
    apply: true,
  });
  assert.deepEqual(
    applied.map((result) => [
      result.outcome,
      result.published,
      result.matchCount,
    ]),
    [
      ['complete', true, 2],
      ['complete', true, 0],
    ],
  );
  assert.equal(reports.length, 4);
  assert.equal(observedRecords.length, 4);
  assert(reports[0]?.sections[0]?.samples.length);
  const appliedContext = context(appliedIdentity, applied);
  const appliedRanking = await queries.getTopPlaces(actor, {}, appliedContext);
  assert.deepEqual(
    new Set(appliedRanking.items.map((row) => row.placeId)),
    new Set([peakId, hutId]),
  );
  assert(appliedRanking.items.every((row) => row.activityCount === 1));
  assert.equal(appliedRanking.evaluation.evaluatedActivities, 2);
  assert.equal(appliedRanking.evaluation.complete, true);
  const pipelineZero = await queries.getActivityPlaces(
    actor,
    ids.pipelineZero,
    appliedContext,
  );
  assert.equal(pipelineZero.status, 'current');
  assert.equal(pipelineZero.places.length, 0);

  await client`UPDATE account SET revoked_at = now(), "accessToken" = NULL, "refreshToken" = NULL WHERE "userId" = ${actor.userId}`;
  assert.equal(
    await repository.publish(actor, second, identity(), []),
    'superseded',
  );
  await assert.rejects(
    queries.getTopPlaces(actor, {}, scope),
    ActivityPlacesUnavailableError,
  );
  await assert.rejects(
    repository.readInput(actor, ids.second),
    ActivityPlacesUnavailableError,
  );
  await client`DELETE FROM "user" WHERE id = ${actor.userId}`;
  const [remaining] =
    await client`SELECT count(*)::integer AS count FROM activity_places`;
  assert.equal(
    remaining?.count,
    0,
    'Activity erasure cascades into memberships',
  );
  assert.equal(
    (await client`SELECT count(*)::integer AS count FROM places`)[0]?.count,
    2,
    'Public catalogue survives private activity erasure',
  );
  assert.deepEqual(
    await publicCounts(),
    before,
    'Existing public catalogue and activities are unchanged',
  );
  console.log(
    'Place matching proof passed: spatial discovery/GiST/coverage gaps, full matcher dry-run/apply/zero, ownership, current-source queries, filters/counts, atomic replacement/rollback, generations, revocation and run locks; public tables unchanged.',
  );
} finally {
  await client.end({ timeout: 5 });
  if (created) await admin`DROP SCHEMA ${admin(scratch)} CASCADE`;
  await admin.end({ timeout: 5 });
}
