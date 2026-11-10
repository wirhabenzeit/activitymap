/**
 * Compare what the app serves for one owner from the LOCAL Postgres with what
 * it serves from the Convex application backend (`backend/`), using the real
 * v1 route handlers on both sides. Run after `convex:import-owner`.
 *
 *   pnpm convex:verify-owner --user <userId> [--summaries <count>]
 *
 * Exits non-zero on any difference. Prints a per-field difference summary.
 */
import { createComparison } from '../../src/server/convex-mirror/compare';
import {
  convexRun,
  loadBridgeEnv,
  parseArgs,
  pinLocalDatabase,
} from './local-source';

pinLocalDatabase();
const options = parseArgs(process.argv.slice(2));
const userId = options.get('user');
if (!userId) throw new Error('Pass --user <userId>');
const summaryLimit = Number(options.get('summaries') ?? 500);

// The local signer for the dev deployment lives in backend/.env.local.
loadBridgeEnv([
  'ACTIVITYMAP_CONVEX_SITE',
  'ACTIVITYMAP_CONVEX_KEY_ID',
  'ACTIVITYMAP_CONVEX_SIGNING_KEY',
]);
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

const comparison = createComparison();

const [postgres, convex] = [
  await library(handlers.postgres),
  await library(handlers.convex),
];
comparison.compareItems(
  'activity',
  postgres.items,
  convex.items,
  (item) => item.id,
);

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
comparison.compareItems(
  'summary',
  summaries.postgres,
  summaries.convex,
  (item) => String(item.activity_id),
);

const differences = comparison.differences();
const report = {
  activities: { postgres: postgres.items.length, convex: convex.items.length },
  bootstrapMs: { postgres: postgres.ms, convex: convex.ms },
  summaries: {
    postgres: summaries.postgres.length,
    convex: summaries.convex.length,
  },
  expectedDifferences: comparison.expected(),
  differences,
};
console.log(JSON.stringify(report, null, 2));
process.exit(Object.keys(differences).length === 0 ? 0 : 1);
