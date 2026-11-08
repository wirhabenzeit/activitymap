// Synthetic hosted proof. Run from the repository root with tsx and react-server.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { ConvexHttpClient } from 'convex/browser';
import { parse } from 'dotenv';

import fixtures from '../../../../shared/sync-integrity-fixtures.v1.json' with { type: 'json' };
import { createLogoutHandler } from '../../../../src/app/api/v1/auth/logout/handler';
import { createIngestionStatusHandler } from '../../../../src/app/api/v1/ingestion-status/handler';
import { createStreamSummariesHandler } from '../../../../src/app/api/v1/stream-summaries/handler';
import { createSyncBootstrapHandler } from '../../../../src/app/api/v1/sync/bootstrap/handler';
import { createSyncChangesHandler } from '../../../../src/app/api/v1/sync/changes/handler';
import { convexPreviewFor } from '../../../../src/server/preview/convex';
import { encodeSyncCursor } from '../../../../src/server/sync/cursor';

const deployment = 'spotted-fennec-603';
const bridgeURL = `https://${deployment}.convex.site/existing-client-preview`;
const lab = new URL('./', import.meta.url);
const envKey = 'ACTIVITYMAP_PREVIEW_BRIDGE_DIGESTS';
const { CONVEX_DEPLOY_KEY: adminKey } = parse(
  await readFile(new URL('.env.client-preview-proof', lab)),
);
assert(adminKey?.startsWith(`dev:${deployment}|`));
const catalogue =
  process.env.PREVIEW_TEST_CATALOGUE ??
  JSON.parse(
    await readFile(
      new URL('results/full-library-validation-1/plan.json', lab),
      'utf8',
    ),
  ).catalogue;
const client = new ConvexHttpClient(`https://${deployment}.convex.cloud`, {
  logger: false,
});
client.setAdminAuth(adminKey);

function cli(...args) {
  return execFileSync(
    'pnpm',
    ['exec', 'convex', 'env', ...args, '--deployment', deployment],
    {
      cwd: lab,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
}
const base = randomUUID();
const athleteBase = 8_600_000_000_000_000 + randomBytes(4).readUInt32BE();
const owners = [athleteBase, athleteBase + 1].map((athleteId) => ({
  userId: `fixture-client-${base}-${athleteId}`,
  athleteId,
  epoch: randomUUID(),
  key: randomBytes(32).toString('hex'),
}));
const [owner, other] = owners;
const registered = [];
const scope = ({ userId, athleteId, epoch }) => ({ userId, athleteId, epoch });
const sha = (text) => createHash('sha256').update(text).digest('hex');
const fixtureId = '2';
const activity = (id, data = {}) => ({
  ...fixtures.activity,
  id,
  athlete: String(owner.athleteId),
  streams: undefined,
  placeMatches: undefined,
  ...data,
});
const photo = (id, activityId) => ({
  ...fixtures.photo,
  unique_id: id,
  activity_id: activityId,
  athlete_id: String(owner.athleteId),
  urls: null,
});
const call = (handler, path) => handler(new Request(`http://localhost${path}`));
async function dto(response, status = 200) {
  assert.equal(response.status, status);
  return (await response.json()).data;
}
async function until(check, message) {
  for (let i = 0; i < 80; i++) {
    const result = await check();
    if (result) return result;
    await sleep(250);
  }
  throw new Error(message);
}

let previous;
let configured = false;
let fixtureAccount;
let browser;
try {
  previous = cli('get', envKey);
  const digests = previous ? JSON.parse(previous) : {};
  cli(
    'set',
    envKey,
    JSON.stringify({
      ...digests,
      ...Object.fromEntries(
        owners.map(({ userId, key }) => [userId, sha(key)]),
      ),
    }),
  );
  configured = true;
  process.env.ACTIVITYMAP_CLIENT_BACKEND = 'convex-preview';
  process.env.ACTIVITYMAP_CONVEX_PREVIEW_OWNERS = JSON.stringify(
    Object.fromEntries(
      owners.map(({ userId, key, epoch }) => [userId, { key, epoch }]),
    ),
  );
  delete process.env.VERCEL_ENV;
  fixtureAccount = await client.mutation('ingestionJobs:createAccount', {
    app: `fixture-client-${base}`,
    matchingCatalogue: catalogue,
    reconciliationMs: 600_000,
  });
  const matchingVersion = sha('fixture catalogue version');
  for (const entry of owners) {
    await client.mutation('preview:register', {
      ...scope(entry),
      ...(entry === owner && { fixtureAccount, matchingVersion }),
    });
    registered.push(entry);
  }
  const publish = (args) =>
    client.mutation('preview:publish', { ...scope(owner), ...args });
  const sendEvent = async (version, deleted = false) => {
    const value = { key: fixtureId, version, deleted, fixture: 'small' };
    await client.mutation('ingestionJobs:setFixture', {
      account: fixtureAccount,
      value,
    });
    return client.mutation('ingestionJobs:receive', {
      account: fixtureAccount,
      generation: 1,
      receipt: `event-${version}-${deleted}`,
      value,
    });
  };
  await publish({ activity: activity('1') });
  await publish({ photo: photo('photo-before', '1') });
  assert.equal(await sendEvent(1), 'queued');
  const actor = { ...scope(owner), authentication: 'bearer' };
  let signedIn = true;
  const resolveActor = async () => (signedIn ? actor : null);
  const dependencies = () => ({
    ...convexPreviewFor(actor),
    resolveActor,
    onError: (error) => {
      throw error;
    },
  });
  const match = async (id) => dependencies().placesRepo.read(actor, id);
  await until(async () => {
    const row = (await dependencies().activitiesRepo.findManyByIds([2]))[0];
    if (!row) return false;
    const result = await match('2');
    return result.resultRevision ? result : false;
  }, 'Fixture recording and hosted matching did not publish').catch(
    async (error) => {
      const current = await client.query('ingestionJobs:current', {
        account: fixtureAccount,
        key: fixtureId,
      });
      const head = await dependencies().changesRepo.latestSequence(
        actor.athleteId,
      );
      console.log({
        fixturePhase: current?.job.phase,
        failure: current?.job.lastFailure,
        publishedRecording: Boolean(current?.recording),
        previewSequence: head,
      });
      throw error;
    },
  );

  const first = await dto(
    await call(
      createSyncBootstrapHandler(dependencies()),
      '/api/v1/sync/bootstrap?limit=1',
    ),
  );
  assert.equal(first.items[0].id, '1');
  assert(first.nextCursor && first.snapshotCursor);
  const earlier = await match('2');
  const [before] = await dependencies().streams.readSummaries(actor, ['2']);
  assert(before.row.summary);
  assert.equal(before.row.revision, '1');

  if (process.env.PREVIEW_DEV_SERVER === '1') {
    const { verifyDevServer } = await import('./client-preview-dev-server.mjs');
    await verifyDevServer(owner);
  }

  // Catch an update to a row already paged and a new recording/match during bootstrap.
  await publish({
    activity: activity('1', { name: 'Updated during bootstrap' }),
  });
  assert.equal(await sendEvent(2), 'queued');
  await until(async () => {
    const result = await match('2');
    return result.streamRevision === '2' && result.resultRevision !== null;
  }, 'Fixture replacement and matching did not publish');
  await publish({ photo: photo('photo-during', '2') });
  const page = await dto(
    await call(
      createSyncBootstrapHandler(dependencies()),
      `/api/v1/sync/bootstrap?limit=1&cursor=${first.nextCursor}`,
    ),
  );
  assert.equal(page.items[0].id, '2');
  assert.equal(page.items[0].placeMatches.streamRevision, '2');
  assert.notEqual(
    page.items[0].placeMatches.resultRevision,
    earlier.resultRevision,
  );
  assert.equal(page.snapshotCursor, null);
  const photos = await dto(
    await call(
      createSyncBootstrapHandler(dependencies()),
      '/api/v1/sync/bootstrap?resource=photos',
    ),
  );
  assert.deepEqual(
    photos.items.map((row) => row.unique_id),
    ['photo-before', 'photo-during'],
  );
  assert.equal(photos.snapshotCursor, null);

  const seen = [];
  let cursor = first.snapshotCursor;
  while (true) {
    const page = await dto(
      await call(
        createSyncChangesHandler(dependencies()),
        `/api/v1/sync/changes?limit=2&cursor=${cursor}`,
      ),
    );
    seen.push(...page.items);
    if (cursor === page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert(
    seen.some((item) => item.activity?.name === 'Updated during bootstrap'),
  );
  assert(seen.some((item) => item.activity?.streams?.revision === '2'));
  assert.deepEqual(
    seen.map((item) => Number(item.sequence)),
    seen.map((item) => Number(item.sequence)).sort((a, b) => a - b),
  );

  const summaries = await dto(
    await call(
      createStreamSummariesHandler({
        resolveActor,
        repository: dependencies().streams,
        compact: true,
      }),
      '/api/v1/stream-summaries/compact?ids=2,999',
    ),
  );
  assert.deepEqual(
    summaries.summaries.map((row) => row.metadata.revision),
    ['2'],
  );
  assert.equal(summaries.summaries[0].summary.codec, 'polyline-v1');
  const raw = await dependencies().streams.read(actor, '2');
  assert(raw.payload.latlng.data.length > 0);
  const status = await dto(
    await call(
      createIngestionStatusHandler({
        resolveActor,
        loadStatus: dependencies().loadStatus,
      }),
      '/api/v1/ingestion-status',
    ),
  );
  assert.equal(status.history.knownActivityCount, 2);
  assert.equal(status.photos.photoCount, 2);
  assert.equal(status.streams.withData, 1);
  assert.equal(status.streams.chartSummaries, 1);

  const expired = encodeSyncCursor({
    athleteId: actor.athleteId,
    sequence: 0,
    backend: dependencies().cursorBackend,
    issuedAt: new Date(Date.now() - 91 * 86_400_000),
  });
  const pgCursor = encodeSyncCursor({
    athleteId: actor.athleteId,
    sequence: 0,
    issuedAt: new Date(),
  });
  const pg = { ...dependencies(), cursorBackend: undefined };
  const foreignOwner = { ...scope(other), authentication: 'bearer' };
  const otherDeps = {
    ...convexPreviewFor(foreignOwner),
    resolveActor: async () => foreignOwner,
  };
  for (const [deps, invalid] of [
    [dependencies(), expired],
    [dependencies(), pgCursor],
    [pg, cursor],
    [otherDeps, cursor],
  ]) {
    const rejected = await call(
      createSyncChangesHandler(deps),
      `/api/v1/sync/changes?cursor=${invalid}`,
    );
    assert.equal(rejected.status, 409);
    assert.equal(
      (await rejected.json()).error.code,
      'sync_rebootstrap_required',
    );
  }
  const future = new Date(Date.now() + 91 * 86_400_000);
  const insideLifetime = encodeSyncCursor({
    athleteId: actor.athleteId,
    sequence: 0,
    backend: dependencies().cursorBackend,
    issuedAt: future,
  });
  const missingHistory = await call(
    createSyncChangesHandler({ ...dependencies(), now: () => future }),
    `/api/v1/sync/changes?cursor=${insideLifetime}`,
  );
  assert.equal(missingHistory.status, 409);
  const foreignPage = await call(
    createSyncBootstrapHandler(pg),
    `/api/v1/sync/bootstrap?cursor=${first.nextCursor}`,
  );
  assert.equal(foreignPage.status, 409);
  const otherLibrary = await dto(
    await call(createSyncBootstrapHandler(otherDeps), '/api/v1/sync/bootstrap'),
  );
  assert.equal(otherLibrary.items.length, 0);
  const bridgeRead = (user, key) =>
    fetch(bridgeURL, {
      method: 'POST',
      headers: {
        'x-preview-user': user.userId,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        ...scope(user),
        operation: { kind: 'raw', id: 2 },
      }),
    });
  for (const key of ['invalid', other.key, adminKey])
    assert.equal((await bridgeRead(owner, key)).status, 401);
  const otherRaw = await bridgeRead(other, other.key);
  assert.equal(otherRaw.status, 200);
  assert.equal(await otherRaw.json(), null);
  assert(
    !JSON.stringify({ page, summaries }).includes('.convex.cloud/api/storage/'),
  );

  let browserPostgres = false;
  if (process.env.PREVIEW_BROWSER === '1') {
    const { openPreviewBrowser } = await import('./client-preview-browser.mjs');
    const pgActivities = {
      findPageByAthlete: async () => [],
      findManyByIds: async () => [],
    };
    const pgDeps = {
      resolveActor,
      activitiesRepo: pgActivities,
      photosRepo: pgActivities,
      changesRepo: { latestSequence: async () => 0, findAfter: async () => [] },
    };
    const handler = (path) => {
      const pathname = new URL(`http://localhost${path}`).pathname;
      const deps = browserPostgres ? pgDeps : dependencies();
      if (pathname === '/api/v1/sync/bootstrap')
        return call(createSyncBootstrapHandler(deps), path);
      if (pathname === '/api/v1/sync/changes')
        return call(createSyncChangesHandler(deps), path);
      if (pathname === '/api/v1/stream-summaries/compact')
        return call(
          createStreamSummariesHandler({
            resolveActor,
            repository: dependencies().streams,
            compact: true,
          }),
          path,
        );
      return new Response('{}', { status: 404 });
    };
    browser = await openPreviewBrowser(owner.userId, handler);
    await browser.sync('bootstrap');
    await browser.verify(['1', '2'], ['photo-before', 'photo-during']);
    assert.equal(await browser.summaries(), '2');
    browser.setOffline(true);
    await browser.reopen();
    await browser.verify(['1', '2'], ['photo-before', 'photo-during']);
    assert.equal(await browser.summaries(), '2');
    browser.setOffline(false);
  }
  assert.equal(await sendEvent(3, true), 'deleted');
  const deletion = await dto(
    await call(
      createSyncChangesHandler(dependencies()),
      `/api/v1/sync/changes?cursor=${cursor}`,
    ),
  );
  assert.deepEqual(
    deletion.items.map(({ entityType, operation, id }) => [
      entityType,
      operation,
      id,
    ]),
    [
      ['photo', 'delete', 'photo-during'],
      ['activity', 'delete', '2'],
    ],
  );
  assert.equal(await sendEvent(2), 'duplicate');
  await assert.rejects(dependencies().streams.read(actor, '2'), {
    name: 'ActivityStreamsUnavailableError',
  });
  if (browser) {
    await browser.sync('changes');
    await browser.verify(['1'], ['photo-before']);
    browserPostgres = true;
    await browser.sync('bootstrap');
    await browser.verify([], []);
    browserPostgres = false;
    await browser.sync('bootstrap');
    await browser.verify(['1'], ['photo-before']);
    await browser.signOut();
    await browser.reopen();
    await browser.verify([], []);
    console.log(
      'Chromium passed hosted preview bootstrap, cached summaries, reopening, incremental tombstones, backend switching and scope clearing.',
    );
  }
  if (process.env.PREVIEW_LOCAL_POSTGRES === '1') {
    const { verifyPostgresBoundary } =
      await import('./client-preview-postgres.mjs');
    await verifyPostgresBoundary(owner, cursor);
  }
  const logout = createLogoutHandler({
    resolveCurrentSessionToken: async () =>
      signedIn ? 'fixture-session' : null,
    revokeSessionByToken: async () => {
      signedIn = false;
    },
  });
  assert.equal((await call(logout, '/api/v1/auth/logout')).status, 200);
  assert.equal(
    (
      await call(
        createSyncBootstrapHandler(dependencies()),
        '/api/v1/sync/bootstrap',
      )
    ).status,
    401,
  );
  console.log(
    'Hosted preview passed bootstrap, concurrent update, compact/raw summaries, matching, status, tombstones, cursor isolation and bridge authorization.',
  );
} finally {
  try {
    await browser?.close();
    if (configured) {
      if (previous) cli('set', envKey, previous);
      else cli('remove', envKey);
    }
  } finally {
    const cleanup = await Promise.allSettled([
      ...registered.map((entry) =>
        client.mutation('preview:erase', scope(entry)),
      ),
      ...(fixtureAccount
        ? [client.mutation('ingestionJobs:revoke', { account: fixtureAccount })]
        : []),
    ]);
    assert(
      cleanup.every(({ status }) => status === 'fulfilled'),
      'Some synthetic fixture cleanup operations failed',
    );
  }
}
