/**
 * Compare what the app serves for one owner from the LOCAL Postgres with what
 * it serves from the Convex application backend (`backend/`), using the real
 * v1 route handlers on both sides. Run after `convex:import-owner`.
 *
 *   pnpm convex:verify-owner --user <userId> [--summaries <count>]
 *
 * Exits non-zero on any difference. Prints a per-field difference summary.
 */
import { readFileSync } from 'node:fs';

import { parse } from 'dotenv';

import { convexRun, parseArgs, pinLocalDatabase } from './local-source';

pinLocalDatabase();
const options = parseArgs(process.argv.slice(2));
const userId = options.get('user');
if (!userId) throw new Error('Pass --user <userId>');
const summaryLimit = Number(options.get('summaries') ?? 500);

// The local signer for the dev deployment lives in backend/.env.local.
const local = parse(readFileSync('backend/.env.local'));
for (const name of [
  'ACTIVITYMAP_CONVEX_SITE',
  'ACTIVITYMAP_CONVEX_KEY_ID',
  'ACTIVITYMAP_CONVEX_SIGNING_KEY',
]) {
  if (!local[name]) throw new Error(`backend/.env.local is missing ${name}`);
  process.env[name] = local[name];
}
const owner = await convexRun<{ epoch: string; backend: string } | null>(
  'importer:owner',
  { userId },
);
if (owner?.backend !== 'convex') throw new Error('Owner is not on Convex');
Object.assign(process.env, {
  ACTIVITYMAP_CLIENT_BACKEND: 'convex-preview',
  ACTIVITYMAP_CONVEX_PREVIEW_OWNERS: JSON.stringify({
    [userId]: { epoch: owner.epoch, transport: 'app' },
  }),
});

const [
  { db },
  { users },
  { eq },
  { createSyncBootstrapHandler },
  { createStreamSummariesHandler },
  { convexPreviewFor },
  { activitiesRepository },
  { changesRepository },
  { photosRepository },
  { createPlaceMatchingRepository },
  { summaryReconciliationRepository },
  { createActivityStreamsRepository },
] = await Promise.all([
  import('../../src/server/db'),
  import('../../src/server/db/schema'),
  import('drizzle-orm'),
  import('../../src/app/api/v1/sync/bootstrap/handler'),
  import('../../src/app/api/v1/stream-summaries/handler'),
  import('../../src/server/preview/convex'),
  import('../../src/server/repositories/activities'),
  import('../../src/server/repositories/changes'),
  import('../../src/server/repositories/photos'),
  import('../../src/server/repositories/place-matching'),
  import('../../src/server/repositories/summary-reconciliation'),
  import('../../src/server/repositories/activity-streams'),
]);

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
const preview = convexPreviewFor(actor);
if (!preview) throw new Error('The Convex preview adapter is not selected');
const resolveActor = async () => actor;
const onError = (error: unknown) => console.error(error);

const handlers = {
  postgres: createSyncBootstrapHandler({
    resolveActor,
    activitiesRepo: activitiesRepository,
    photosRepo: photosRepository,
    changesRepo: changesRepository,
    freshnessRepo: summaryReconciliationRepository,
    placesRepo: createPlaceMatchingRepository(),
    onError,
  }),
  convex: createSyncBootstrapHandler({
    resolveActor,
    activitiesRepo: preview.activitiesRepo,
    photosRepo: preview.photosRepo,
    changesRepo: preview.changesRepo,
    cursorBackend: preview.cursorBackend,
    bootstrapPage: preview.bootstrapPage,
    defaultPageSize: 500,
    freshnessRepo: preview.freshnessRepo,
    placesRepo: preview.placesRepo,
    onError,
  }),
};

type Item = Record<string, unknown> & { id: string };
async function library(handler: (request: Request) => Promise<Response>) {
  const items: Item[] = [];
  let cursor: string | null = null;
  const started = performance.now();
  do {
    const url = new URL('https://verify.local/api/v1/sync/bootstrap');
    url.searchParams.set('limit', '500');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await handler(new Request(url));
    if (!response.ok)
      throw new Error(
        `Bootstrap returned ${response.status}: ${await response.text()}`,
      );
    const { data } = (await response.json()) as {
      data: { items: Item[]; nextCursor: string | null };
    };
    items.push(...data.items);
    cursor = data.nextCursor;
  } while (cursor);
  return { items, ms: Math.round(performance.now() - started) };
}

// Opaque per-backend tokens: Postgres uses result UUIDs, Convex the change
// sequence. Clients only compare them within one backend, and moving an owner
// between backends forces a new bootstrap.
const EXPECTED = new Set(['activity.placeMatches.resultRevision']);
const differences = new Map<string, { count: number; example: string }>();
const expected = new Map<string, number>();
function note(field: string, id: string, left: unknown, right: unknown) {
  if (EXPECTED.has(field)) {
    expected.set(field, (expected.get(field) ?? 0) + 1);
    return;
  }
  const entry = differences.get(field) ?? {
    count: 0,
    example: `${id}: ${JSON.stringify(left)?.slice(0, 160)} != ${JSON.stringify(right)?.slice(0, 160)}`,
  };
  entry.count++;
  differences.set(field, entry);
}
function compare(prefix: string, id: string, left: unknown, right: unknown) {
  if (JSON.stringify(left) === JSON.stringify(right)) return;
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left)
  ) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys)
      compare(
        `${prefix}.${key}`,
        id,
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      );
    return;
  }
  note(prefix, id, left, right);
}

const [postgres, convex] = [
  await library(handlers.postgres),
  await library(handlers.convex),
];
const convexById = new Map(convex.items.map((item) => [item.id, item]));
for (const item of postgres.items) {
  const other = convexById.get(item.id);
  if (!other) note('<missing in convex>', item.id, item.id, null);
  else compare('activity', item.id, item, other);
}
const postgresIds = new Set(postgres.items.map((item) => item.id));
for (const id of convexById.keys())
  if (!postgresIds.has(id)) note('<extra in convex>', id, null, id);

// Chart summaries for the first activities, through the v1 handler.
const ids = postgres.items.slice(0, summaryLimit).map((item) => item.id);
const summaries = { postgres: [] as Item[], convex: [] as Item[] };
for (const [side, repository] of [
  ['postgres', createActivityStreamsRepository()],
  ['convex', preview.streams],
] as const) {
  const handler = createStreamSummariesHandler({ resolveActor, repository });
  for (let i = 0; i < ids.length; i += 100) {
    const url = new URL('https://verify.local/api/v1/stream-summaries');
    url.searchParams.set('ids', ids.slice(i, i + 100).join(','));
    const response = await handler(new Request(url));
    if (!response.ok)
      throw new Error(`Summaries returned ${response.status} (${side})`);
    const { data } = (await response.json()) as {
      data: { summaries: Item[] };
    };
    summaries[side].push(...data.summaries);
  }
}
const key = (item: Item) => String(item.activity_id);
const convexSummaries = new Map(
  summaries.convex.map((item) => [key(item), item]),
);
for (const item of summaries.postgres)
  compare('summary', key(item), item, convexSummaries.get(key(item)));

const report = {
  activities: { postgres: postgres.items.length, convex: convex.items.length },
  bootstrapMs: { postgres: postgres.ms, convex: convex.ms },
  summaries: {
    postgres: summaries.postgres.length,
    convex: summaries.convex.length,
  },
  expectedDifferences: Object.fromEntries(expected),
  differences: Object.fromEntries(
    [...differences].sort((a, b) => b[1].count - a[1].count),
  ),
};
console.log(JSON.stringify(report, null, 2));
process.exit(differences.size === 0 ? 0 : 1);
