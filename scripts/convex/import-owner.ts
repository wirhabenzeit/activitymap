/**
 * Copy one owner's library from the LOCAL development Postgres into the
 * Convex application backend, through the same fenced write paths that live
 * ingestion uses (owners.provision, applySource, recording preparation and
 * match publication).
 *
 *   pnpm convex:import-owner --user <userId> [--limit <activities>]
 *
 * Re-running is safe: every run uses a newer source revision, so unchanged
 * stream sources keep their recordings and matches, and only missing
 * recordings and matches are published.
 */
import { encodeWhole } from '../../backend/recording/codec';
import {
  batchesOf,
  convexRun,
  parseArgs,
  pinLocalDatabase,
  token,
  withRetry,
} from './local-source';

const databaseHost = pinLocalDatabase();
const options = parseArgs(process.argv.slice(2));
const userId = options.get('user');
if (!userId) throw new Error('Pass --user <userId>');
const limit = Number(options.get('limit') ?? Number.MAX_SAFE_INTEGER);

const [
  { canonicalJson, sha256 },
  { db },
  { users, activityStreams },
  { activitiesRepository },
  { createPlaceMatchingRepository },
  { toActivityDTO },
  { and, eq, inArray, isNotNull, isNull, sql },
] = await Promise.all([
  import('../../src/server/places/catalogue-artifact'),
  import('../../src/server/db'),
  import('../../src/server/db/schema'),
  import('../../src/server/repositories/activities'),
  import('../../src/server/repositories/place-matching'),
  import('../../src/contracts/v1/activity'),
  import('drizzle-orm'),
]);

type Owner = {
  athleteId: string;
  backend: 'postgres' | 'convex';
  epoch: string;
  generation: string;
  revoked: boolean;
  catalogue: string;
  matchingVersion: string;
} | null;

const [user] = await db
  .select({ athleteId: users.athlete_id })
  .from(users)
  .where(eq(users.id, userId));
if (!user?.athleteId) throw new Error('User has no linked athlete');
const actor = {
  userId,
  athleteId: user.athleteId,
  authentication: 'cookie' as const,
};
const athleteId = String(user.athleteId);
const places = createPlaceMatchingRepository();

// The first page also fixes the catalogue identity for this run. Matching
// versions change exactly when the Postgres catalogue or recipe changes, so the
// Convex catalogue identity is derived from it.
const firstPage = await activitiesRepository.findPageByAthlete(user.athleteId, {
  afterId: 0,
  limit: 1,
});
if (firstPage.length === 0) throw new Error('The owner has no activities');
const { version: matchingVersion } = await places.sync(actor, [
  String(firstPage[0]!.id),
]);
const catalogue = sha256(
  canonicalJson({ postgresMatchingVersion: matchingVersion }),
);

const prior = await convexRun<Owner>('importer:owner', { userId });
if (prior?.revoked) throw new Error('The Convex owner is revoked');
if (prior && prior.athleteId !== athleteId)
  throw new Error('The Convex owner belongs to a different athlete');
const epoch = prior?.backend === 'convex' ? prior.epoch : token();
const generation = prior?.generation ?? token();
const scope = { userId, athleteId, epoch };
if (prior?.backend !== 'convex')
  await convexRun('owners:provision', {
    ...scope,
    backend: 'convex',
    ...(prior && { expectedEpoch: prior.epoch }),
    generation,
    catalogue: prior?.catalogue ?? catalogue,
    matchingVersion: prior?.matchingVersion ?? matchingVersion,
  });
if (prior && prior.catalogue !== catalogue)
  await convexRun('catalogue:select', { scope, catalogue, matchingVersion });

// One revision per run: newer than any earlier import of this owner.
const sourceRevision = Date.now();
const common = { scope, generation, sourceRevision };
console.error(
  `Importing ${userId} (athlete ${athleteId}) from ${databaseHost}; epoch ${epoch}`,
);

const totals = { activities: 0, applied: 0, recordings: 0, matches: 0 };
let afterId = 0;
while (totals.activities < limit) {
  const rows = await activitiesRepository.findPageByAthlete(user.athleteId, {
    afterId,
    limit: Math.min(256, limit - totals.activities),
  });
  if (rows.length === 0) break;
  afterId = rows.at(-1)!.id;
  totals.activities += rows.length;

  const dtos = rows.map((row) => {
    // Streams and matches are derived state; Convex publishes its own.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { streams, placeMatches, ...dto } = toActivityDTO(row);
    return dto;
  });
  // Postgres serves a stored set while fetched_at is set and invalidated_at is
  // null (the trigger stamps it when the stream source changes), whatever the
  // latest refresh attempt did. Select recordings by that rule alone.
  const currentStreams = (ids: bigint[]) =>
    and(
      inArray(activityStreams.activityId, ids),
      isNotNull(activityStreams.fetchedAt),
      isNull(activityStreams.invalidatedAt),
      isNotNull(activityStreams.payload),
    );
  const identities = await db
    .select({
      id: sql<string>`${activityStreams.activityId}::text`,
      generation: activityStreams.generation,
      revision: sql<string>`${activityStreams.revision}::text`,
    })
    .from(activityStreams)
    .where(currentStreams(rows.map((row) => BigInt(row.id))));
  const identityById = new Map(identities.map((item) => [item.id, item]));

  const needsRecording = new Set<string>();
  const needsMatch = new Set<string>();
  for (const items of batchesOf(dtos, { maxBytes: 192 * 1024, maxItems: 64 })) {
    const result = await convexRun<{
      applied: number;
      needsRecording: string[];
      needsMatch: string[];
    }>('importer:applySources', {
      ...common,
      items,
      recordings: items.flatMap((item) => identityById.get(item.id) ?? []),
    });
    totals.applied += result.applied;
    result.needsRecording.forEach((id) => needsRecording.add(id));
    result.needsMatch.forEach((id) => needsMatch.add(id));
  }

  // Generation and revision are re-read with the payload, so a refresh that
  // lands in between is published under its own identity.
  const streams =
    needsRecording.size === 0
      ? []
      : await db
          .select({
            activityId: sql<string>`${activityStreams.activityId}::text`,
            generation: activityStreams.generation,
            revision: sql<string>`${activityStreams.revision}::text`,
            fetchedAt: activityStreams.fetchedAt,
            payload: activityStreams.payload,
          })
          .from(activityStreams)
          .where(currentStreams([...needsRecording].map((id) => BigInt(id))));
  for (let i = 0; i < streams.length; i += 32) {
    const chunk = streams.slice(i, i + 32);
    const urls = await convexRun<string[]>('importer:uploadUrls', {
      count: chunk.length,
    });
    const items = await Promise.all(
      chunk.map(async (stream, index) => {
        const { file, manifest } = encodeWhole(stream.payload!);
        const { storageId } = await withRetry(async () => {
          const upload = await fetch(urls[index]!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/gzip' },
            body: new Uint8Array(file),
          });
          if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
          return (await upload.json()) as { storageId: string };
        });
        return {
          id: stream.activityId,
          file: storageId,
          manifest,
          recordingGeneration: stream.generation,
          recordingRevision: stream.revision,
          ...(stream.fetchedAt && {
            fetchedAt: stream.fetchedAt.toISOString(),
          }),
        };
      }),
    );
    totals.recordings += await convexRun<number>('importer:prepareRecordings', {
      ...common,
      items,
    });
  }

  const synced = needsMatch.size
    ? await places.sync(actor, [...needsMatch])
    : null;
  // Results are only valid under the catalogue identity pinned for this run.
  if (synced && synced.version !== matchingVersion)
    throw new Error(
      'The Postgres place catalogue changed during the import; re-run it to select the new catalogue',
    );
  const finished = [...(synced?.results.values() ?? [])].filter((result) =>
    ['complete', 'partial', 'uncovered'].includes(result.status),
  );
  for (const items of batchesOf(finished, {
    maxBytes: 192 * 1024,
    maxItems: 64,
  }))
    totals.matches += await convexRun<number>('importer:publishMatches', {
      ...common,
      catalogue,
      items,
    });
  console.error(JSON.stringify(totals));
}

console.log(JSON.stringify({ userId, epoch, sourceRevision, ...totals }));
process.exit(0);
