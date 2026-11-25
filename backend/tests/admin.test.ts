import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import test, { after, before, mock } from 'node:test';

import { readAdminFigures } from '../../src/server/admin/convex-admin';
import { internal } from '../convex/_generated/api';
import schema from '../convex/schema';

/**
 * The operator dashboard's reads, through the app's client and its strict
 * schemas, the signed route and convex/admin.ts.
 */

const modules = {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './admin.ts': () => import('../convex/admin'),
  './http.ts': () => import('../convex/http'),
  './owners.ts': () => import('../convex/owners'),
};

const secret = 'a'.repeat(64);
const site = 'https://convex.test';
const environment = {
  ACTIVITYMAP_CONVEX_SITE: site,
  ACTIVITYMAP_CONVEX_KEY_ID: 'k1',
  ACTIVITYMAP_CONVEX_SIGNING_KEY: secret,
  ACTIVITYMAP_BRIDGE_SIGNING_KEYS: JSON.stringify({ k1: secret }),
};
const previous = Object.keys(environment).map(
  (name) => [name, process.env[name]] as const,
);
const now = Date.UTC(2026, 10, 25, 14, 32);

before(() => {
  Object.assign(process.env, environment);
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
});
after(() => {
  mock.timers.reset();
  for (const [name, value] of previous)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});

type Convex = ReturnType<typeof convexTest<typeof schema>>;

/** Sends the client's requests to the backend under test. */
const fetcher = (convex: Convex) =>
  ((url: URL, init: RequestInit) =>
    convex.fetch(url.pathname, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    })) as unknown as typeof fetch;

const figures = (convex: Convex) => readAdminFigures(fetcher(convex));

const provision = (convex: Convex, athleteId: string) =>
  convex.mutation(internal.owners.provision, {
    userId: `user-${athleteId}`,
    athleteId,
    epoch: `epoch-${athleteId.padStart(16, '0')}`,
    backend: 'convex',
    generation: 'test-generation-01',
    catalogue: 'a'.repeat(64),
    matchingVersion: 'b'.repeat(64),
  });

const job = {
  phase: 'source' as const,
  requested: 1,
  attempt: 0,
  revision: 0,
  claims: 0,
};

void test('an empty backend answers with nothing', async () => {
  const convex = convexTest(schema, modules);
  assert.deepEqual(await figures(convex), {
    observedAt: now,
    lastEventAt: null,
    catalogue: null,
    budget: [],
    users: [],
  });
});

void test('a user is counts, states and times, and nothing personal', async () => {
  const convex = convexTest(schema, modules);
  const owner = await provision(convex, '42');
  await convex.run(async (ctx) => {
    await ctx.db.patch('owners', owner, { writer: 'convex' });
    const stats = (await ctx.db.query('ownerStats').first())!;
    await ctx.db.patch('ownerStats', stats._id, {
      counts: {
        ...stats.counts,
        total: 10,
        neverFetched: 2,
        invalidatedDetails: 1,
        withData: 5,
        withoutData: 1,
        runnable: 4,
        photoCount: 7,
      },
    });
    await ctx.db.insert('ingestionSweeps', {
      owner,
      number: 2,
      phase: 'scanning',
      dueAt: now - 5,
      scanBefore: 1,
      page: 3,
      after: '',
      attempt: 1,
      claims: 4,
      lease: { claim: 4, expiresAt: now + 1 },
      error: 'upstream_error 503',
      completedAt: now - 10,
      listReadAt: now - 20,
    });
    for (const receivedAt of [now - 100, now - 300])
      await ctx.db.insert('providerEvents', {
        owner,
        event: `event-${receivedAt}`,
        activity: '00000000000000000001',
        aspect: 'create',
        eventTime: 1,
        receivedAt,
      });
    const jobs = [
      // Held by a run: not waiting.
      {
        status: 'queued' as const,
        dueAt: now - 900,
        lease: { claim: 1, expiresAt: now + 1, requested: 1 },
      },
      { status: 'queued' as const, dueAt: now - 500 },
      { status: 'queued' as const, dueAt: now - 600, phase: 'match' as const },
      { status: 'failed' as const, error: 'Secret text near 47.1, 8.2' },
      {
        status: 'failed' as const,
        phase: 'match' as const,
        error: 'Tile budget exceeded: result incomplete',
      },
      { status: 'blocked' as const, error: 'credentials_rejected' },
      { status: 'blocked' as const, error: 'credentials_rejected' },
      { status: 'idle' as const },
    ];
    for (const [index, fields] of jobs.entries())
      await ctx.db.insert('ingestionJobs', {
        owner,
        activity: String(index + 1).padStart(20, '0'),
        ...job,
        ...fields,
      });
    const records = [
      { id: 'a1', providerId: 'other', revokedAt: '2020-01-01T00:00:00Z' },
      {
        id: 'a2',
        providerId: 'strava',
        accessToken: 'secret-token',
        revokedAt: new Date(now - 50).toISOString(),
        scheduledErasureAt: new Date(now + 50).toISOString(),
      },
    ];
    for (const doc of records)
      await ctx.db.insert('authRecords', {
        model: 'account',
        key: doc.id,
        userId: 'user-42',
        doc: { ...doc, userId: 'user-42' },
      });
    await ctx.db.insert('authRecords', {
      model: 'user',
      key: 'user-42',
      email: 'person@example.org',
      doc: { id: 'user-42', name: 'A Person', email: 'person@example.org' },
    });
  });

  const { users, lastEventAt } = await figures(convex);
  assert.equal(lastEventAt, now - 100);
  assert.equal(users.length, 1);
  const { createdAt, ...user } = users[0]!;
  assert.equal(typeof createdAt, 'number');
  // The whole answer: a new field has to be added here, and looked at.
  assert.deepEqual(user, {
    athleteId: '42',
    active: true,
    revokedAt: now - 50,
    erasureDueAt: now + 50,
    counts: {
      activities: 10,
      recordings: 6,
      photos: 7,
      toFetch: 4,
      rebuilding: false,
    },
    lastEventAt: now - 100,
    sweep: {
      phase: 'scanning',
      dueAt: now - 5,
      running: true,
      error: 'upstream_error',
      listReadAt: now - 20,
    },
    jobs: {
      queued: { activities: 2, matches: 1, capped: false },
      failed: { activities: 1, matches: 1, capped: false },
      blocked: { activities: 2, matches: 0, capped: false },
      reasons: [
        { stage: 'activities', code: 'other', count: 1 },
        { stage: 'matches', code: 'tile_budget', count: 1 },
        { stage: 'activities', code: 'credentials_rejected', count: 2 },
      ],
      oldestDueAt: now - 600,
    },
  });
});

void test('the catalogue, its changed tiles and the request budget', async () => {
  const convex = convexTest(schema, modules);
  await convex.run(async (ctx) => {
    const metadata = await ctx.storage.store(new Blob(['{}']));
    await ctx.db.insert('placeCatalogueState', {
      revision: 3,
      snapshotId: 'snapshot',
      metadata,
      count: 12,
      setDigest: '0'.repeat(64),
      pending: {
        snapshotId: 'next',
        revision: 4,
        metadata,
        count: 13,
        setDigest: '1'.repeat(64),
        startedAt: now - 7,
      },
    });
    // Those of the pending revision wait for its completion.
    for (const [revision, tile] of [
      [2, '1,1'],
      [3, '1,1'],
      [4, '1,2'],
    ] as const)
      await ctx.db.insert('placeTileChanges', { revision, tile });
    await ctx.db.insert('providerBudget', {
      key: 'read:15m',
      windowStart: now - 1,
      used: 41,
      inFlight: 2,
      ceiling: 100,
    });
  });
  const { users: _users, ...overview } = await figures(convex);
  assert.deepEqual(overview, {
    observedAt: now,
    lastEventAt: null,
    catalogue: {
      revision: 3,
      places: 12,
      pending: { revision: 4, startedAt: now - 7 },
      tilesLeft: { count: 2, capped: false },
    },
    budget: [
      {
        key: 'read:15m',
        windowStart: now - 1,
        used: 41,
        limit: 100,
        blockedUntil: null,
      },
    ],
  });
});

void test('users are read page by page, and long job lists are capped', async () => {
  const convex = convexTest(schema, modules);
  const owner = await provision(convex, '1');
  for (let id = 2; id <= 35; id++) await provision(convex, String(id));
  await convex.run(async (ctx) => {
    for (let index = 0; index < 260; index++)
      await ctx.db.insert('ingestionJobs', {
        owner,
        activity: String(index + 1).padStart(20, '0'),
        ...job,
        phase: 'match',
        status: 'queued',
        dueAt: now,
      });
  });
  const { users } = await figures(convex);
  assert.deepEqual(
    users.map(({ athleteId }) => Number(athleteId)),
    Array.from({ length: 35 }, (_, index) => index + 1),
  );
  assert.deepEqual(users[0]!.jobs.queued, {
    activities: 0,
    matches: 250,
    capped: true,
  });
  // Provisioned, but not written by Convex yet.
  assert.equal(users[0]!.active, false);
});

void test('only the admin signature opens the route', async () => {
  const convex = convexTest(schema, modules);
  const send = async (domain: string, operation: object) => {
    const body = JSON.stringify({ operation });
    const timestamp = String(Date.now());
    const response = await convex.fetch('/internal/admin/v1', {
      method: 'POST',
      headers: {
        'X-ActivityMap-Key-Id': 'k1',
        'X-ActivityMap-Timestamp': timestamp,
        'X-ActivityMap-Signature': createHmac(
          'sha256',
          Buffer.from(secret, 'hex'),
        )
          .update(`${domain}\nk1\n${timestamp}\n${body}`)
          .digest('hex'),
      },
      body,
    });
    return response.status;
  };
  const operation = { kind: 'overview' };
  assert.equal(await send('activitymap-admin-v1', operation), 200);
  for (const domain of [
    'activitymap-sync-v1',
    'activitymap-write-v1',
    'activitymap-auth-v1',
    'activitymap-places-v1',
  ])
    assert.equal(await send(domain, operation), 401);
  assert.equal(await send('activitymap-admin-v1', { kind: 'unknown' }), 400);
});

void test('an answer with a field the app does not know is refused', async () => {
  const fake = (async (_url: URL, init: RequestInit) => {
    const { operation } = JSON.parse(init.body as string) as {
      operation: { kind: string };
    };
    return Response.json(
      operation.kind === 'users'
        ? { page: [], cursor: null }
        : {
            observedAt: 1,
            lastEventAt: null,
            catalogue: null,
            budget: [],
            name: 'A Person',
          },
    );
  }) as unknown as typeof fetch;
  await assert.rejects(readAdminFigures(fake), /name/);
});
