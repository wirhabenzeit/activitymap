import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, type TestContext } from 'node:test';
import type { Actor } from '~/server/auth/actor';
import type { Account, Activity } from '~/server/db/schema';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import type { DetailFailureCode } from '~/server/strava/ingestion-policy';
import type { ActivityImportProgress } from '~/server/strava/activity-import-policy';
import type { FetchStravaActivitiesResult } from '~/server/strava/service';
import {
  warmSignupActivitiesForActor,
  type SignupWarmupDeps,
} from './signup-warmup';

const actor: Actor = {
  userId: 'owner',
  athleteId: 42,
  authentication: 'cookie',
};
const started = Date.parse('2026-10-17T10:00:00Z');
const originalEnvironment = {
  ACTIVITYMAP_EXTERNAL_EFFECTS: process.env.ACTIVITYMAP_EXTERNAL_EFFECTS,
  AUTH_STRAVA_ID: process.env.AUTH_STRAVA_ID,
  AUTH_STRAVA_SECRET: process.env.AUTH_STRAVA_SECRET,
};
beforeEach(() => {
  process.env.ACTIVITYMAP_EXTERNAL_EFFECTS = 'enabled';
  process.env.AUTH_STRAVA_ID = 'test-client';
  process.env.AUTH_STRAVA_SECRET = 'test-secret';
});
afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});
const activity = (id: number) =>
  ({ id, athlete: 42, start_date: new Date(started - id * 1000) }) as Activity;

function setup(t: TestContext, count = 200) {
  let time = started;
  let account: Account | undefined = {
    id: 'account',
    userId: actor.userId,
    accountId: '42',
    accessToken: 'test-token',
    accessTokenExpiresAt: new Date(started + 3_600_000),
  } as Account;
  const rows = Array.from({ length: count }, (_, i) => activity(i + 1));
  const pending = new Set(rows.map((a) => a.id));
  const calls: URL[] = [];
  const buckets = new Map<string, number>();
  const failures: { activityId: number; code: DetailFailureCode }[] = [];
  let pageCount = 200;
  let photoFailure = false;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const parsed = new URL(url instanceof Request ? url.url : url);
    calls.push(parsed);
    if (parsed.pathname.endsWith('/photos'))
      return Response.json(
        photoFailure ? { message: 'Rate limit exceeded' } : [],
        { status: photoFailure ? 429 : 200 },
      );
    if (parsed.pathname.endsWith('/athlete/activities'))
      return Response.json(
        Array.from({ length: pageCount }, (_, i) => activity(201 + i)),
      );
    return Response.json(activity(Number(parsed.pathname.split('/').at(-1))));
  });
  const deps: SignupWarmupDeps = {
    enabled: true,
    clock: () => time,
    resolveAccount: async () => account,
    rateLimits: {
      incrementAndGet: async (key, window) => {
        const bucket = `${key}:${window.toISOString()}`;
        const next = (buckets.get(bucket) ?? 0) + 1;
        buckets.set(bucket, next);
        return next;
      },
    },
    activitiesRepo: {
      findManyByAthlete: async (athleteId, opts) => {
        assert.equal(athleteId, actor.athleteId);
        assert.equal(opts?.limit, 200);
        return rows;
      },
      findManyByIds: async () => [],
      findPageByAthlete: async () => [],
      deleteManyForAthlete: async (_athleteId, ids) => ids,
      upsertOne: async (row) => row,
      replaceExistingForAthlete: async (_athleteId, row) => row,
    },
    ingestion: {
      findDetailCandidates: async () => [...pending],
      clearDetailAttempts: async () => undefined,
      recordDetailFailures: async (records) => {
        failures.push(...records);
      },
    },
    requestBudget: {
      reserve: async (read) => ({ read, startedAt: new Date(time) }),
      observe: async () => undefined,
    },
    // Exercise the real Strava client (including its two photo sizes, budget,
    // and account guards) while replacing only database persistence.
    fetchActivities: async (input, options) => {
      const client = options!.createClient!(input.accessToken);
      const result: FetchStravaActivitiesResult = {
        activities: [],
        photos: [],
        notFoundIds: [],
      };
      if (input.activityIds) {
        assert.equal(
          input.requireExisting,
          true,
          'must not resurrect a concurrently deleted activity',
        );
        const id = input.activityIds[0]!;
        try {
          await client.getActivity(id);
        } catch (error) {
          return { ...result, failures: [{ activityId: id, error }] };
        }
        result.activities = [activity(id)];
        try {
          await client.getActivityPhotos(id);
        } catch (error) {
          return {
            ...result,
            photoRefreshFailedIds: [id],
            photoRefreshFailures: [{ activityId: id, error }],
          };
        }
        // eslint-disable-next-line drizzle/enforce-delete-with-where -- in-memory Set
        pending.delete(id);
        return result;
      }
      const listed = await client.getActivities(input);
      return { ...result, activities: listed.map((row) => activity(row.id)) };
    },
  };
  return {
    deps,
    calls,
    buckets,
    failures,
    pending,
    setTime: (next: number) => {
      time = next;
    },
    setAccount: (next: Account | undefined) => {
      account = next;
    },
    getAccount: () => account!,
    setPageCount: (next: number) => {
      pageCount = next;
    },
    failPhotos: () => {
      photoFailure = true;
    },
  };
}

void test('warmup enriches only the newest five, then loads three bounded history pages', async (t) => {
  const { deps, calls } = setup(t);
  const result = await warmSignupActivitiesForActor(actor, 200, deps);
  assert.deepEqual(result, {
    details: 5,
    summaries: 600,
    requests: 18,
    stopReason: 'complete',
  });
  assert.deepEqual(
    calls.slice(0, 3).map((url) => url.pathname),
    [
      '/api/v3/activities/1',
      '/api/v3/activities/1/photos',
      '/api/v3/activities/1/photos',
    ],
  );
  const pages = calls.filter((url) =>
    url.pathname.endsWith('/athlete/activities'),
  );
  assert.deepEqual(
    pages.map((url) => url.searchParams.get('page')),
    ['1', '2', '3'],
  );
  assert.ok(pages.every((url) => url.searchParams.get('per_page') === '200'));
  assert.ok(
    pages.every(
      (url) =>
        url.searchParams.get('before') === String(started / 1000 - 200 + 1),
    ),
  );
});

void test('short initial/history pages stop paging, while recent details still load', async (t) => {
  const small = setup(t, 2);
  const result = await warmSignupActivitiesForActor(actor, 2, small.deps);
  assert.equal(result.details, 2);
  assert.equal(result.summaries, 0);
  const large = setup(t);
  large.setPageCount(12);
  const partial = await warmSignupActivitiesForActor(actor, 200, large.deps);
  assert.equal(partial.summaries, 12);
  assert.equal(
    large.calls.filter((url) => url.pathname.endsWith('/athlete/activities'))
      .length,
    1,
  );
});

void test('account and global dispatch counters suppress duplicate warmups', async (t) => {
  const { deps, calls, buckets } = setup(t);
  const runs = await Promise.all([
    warmSignupActivitiesForActor(actor, 200, deps),
    warmSignupActivitiesForActor(
      { ...actor, authentication: 'bearer' },
      200,
      deps,
    ),
  ]);
  assert.deepEqual(runs.map((r) => r.stopReason).sort(), ['busy', 'complete']);
  assert.equal(calls.length, 18);
  assert.equal(
    (
      await warmSignupActivitiesForActor(
        { ...actor, userId: 'someone-else' },
        200,
        deps,
      )
    ).stopReason,
    'busy',
  );
  assert.equal(calls.length, 18);
  assert.ok(
    [...buckets.keys()].every((key) => !key.includes('owner')),
    'do not persist raw user IDs',
  );
});

void test('no quota means no HTTP requests, and no per-activity failure backoff', async (t) => {
  const { deps, calls, failures } = setup(t);
  deps.requestBudget!.reserve = async () => {
    throw new StravaBudgetExceededError(900);
  };
  const result = await warmSignupActivitiesForActor(actor, 200, deps);
  assert.equal(result.stopReason, 'rate_limit');
  assert.equal(calls.length, 0);
  assert.deepEqual(failures, []);
});

void test('a photo rate limit preserves the successful detail and stops subsequent work', async (t) => {
  const fixture = setup(t);
  fixture.failPhotos();
  const result = await warmSignupActivitiesForActor(actor, 200, fixture.deps);
  assert.equal(result.stopReason, 'rate_limit');
  assert.equal(result.details, 1);
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(fixture.failures, []);
});

void test('revoked, expired, missing and mismatched accounts never make an HTTP request', async (t) => {
  for (const change of [
    () => undefined,
    (account: Account) => ({ ...account, revokedAt: new Date(started) }),
    (account: Account) => ({ ...account, accountId: '43' }),
    (account: Account) => ({ ...account, userId: 'other-user' }),
    (account: Account) => ({
      ...account,
      accessTokenExpiresAt: new Date(started - 1),
    }),
  ]) {
    const fixture = setup(t);
    fixture.setAccount(change(fixture.getAccount()));
    assert.equal(
      (await warmSignupActivitiesForActor(actor, 200, fixture.deps)).stopReason,
      'account_unavailable',
    );
    assert.equal(fixture.calls.length, 0);
  }
});

void test('a grant change after selection fences every request without backing off an activity', async (t) => {
  const fixture = setup(t);
  let reads = 0;
  fixture.deps.resolveAccount = async () => {
    const account = fixture.getAccount();
    return ++reads > 1
      ? { ...account, accessToken: 'reconnected-token' }
      : account;
  };
  const result = await warmSignupActivitiesForActor(actor, 200, fixture.deps);
  assert.equal(result.stopReason, 'account_unavailable');
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(fixture.failures, []);
});

void test('deadline and request caps stop even inside detail/photo fetching', async (t) => {
  const timed = setup(t);
  timed.deps.requestBudget!.reserve = async (read) => {
    timed.setTime(started + 36_000);
    return { read, startedAt: new Date(started) };
  };
  assert.equal(
    (await warmSignupActivitiesForActor(actor, 200, timed.deps)).stopReason,
    'deadline',
  );
  assert.equal(timed.calls.length, 0);
  assert.deepEqual(timed.failures, []);
  const capped = setup(t);
  capped.deps.fetchActivities = async (input, options) => {
    const client = options!.createClient!(input.accessToken);
    // Model a future client adding follow-up calls; the cap still bounds it.
    for (let i = 0; i < 25; i++) await client.getActivity(1);
    throw new Error('unreachable');
  };
  assert.equal(
    (await warmSignupActivitiesForActor(actor, 200, capped.deps)).stopReason,
    'request_limit',
  );
  assert.equal(capped.calls.length, 20);
  assert.deepEqual(capped.failures, []);
});

void test('disabled or empty imports do not claim a slot or touch Strava', async (t) => {
  const { deps, buckets, calls } = setup(t);
  await warmSignupActivitiesForActor(actor, 0, deps);
  await warmSignupActivitiesForActor(actor, 200, { ...deps, enabled: false });
  assert.equal(buckets.size, 0);
  assert.equal(calls.length, 0);
});

void test('manual batches refresh recent data and continue the saved history page and pending details', async (t) => {
  const { fetchManualActivityBatchForActor } = await import('./signup-warmup');
  const fixture = setup(t);
  const progress: ActivityImportProgress[] = [];
  const batch = {
    cursor: { before: 1_700_000_000, page: 4, done: false },
    isCurrent: async () => true,
    replaceCredentials: async () => true,
    onRateLimited: () => undefined,
    onProgress: async (next: (typeof progress)[number]) => {
      progress.push(next);
    },
  };
  const first = await fetchManualActivityBatchForActor(
    actor,
    batch,
    fixture.deps,
  );
  assert.equal(first.summaries, 800);
  const pages = fixture.calls.filter((url) =>
    url.pathname.endsWith('/athlete/activities'),
  );
  assert.deepEqual(
    pages.map((url) => url.searchParams.get('page')),
    ['1', '4', '5', '6'],
  );
  assert.equal(progress.at(-1)?.cursor?.page, 7);
  fixture.calls.length = 0;
  await fetchManualActivityBatchForActor(
    actor,
    { ...batch, cursor: progress.at(-1)!.cursor! },
    fixture.deps,
  );
  assert.ok(
    fixture.calls.some((url) => url.pathname === '/api/v3/activities/6'),
  );
  assert.ok(fixture.calls.some((url) => url.searchParams.get('page') === '7'));
});

void test('expired manual credentials refresh through the same request budget and grant guard', async (t) => {
  const { fetchManualActivityBatchForActor } = await import('./signup-warmup');
  const f = setup(t, 2);
  f.setAccount({
    ...f.getAccount(),
    refreshToken: 'refresh',
    accessTokenExpiresAt: new Date(started - 1),
  });
  const mockedFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      if (
        (url instanceof Request ? url.url : url.toString()).includes(
          '/oauth/token',
        )
      )
        return Response.json({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_at: Math.floor(started / 1000) + 3600,
          expires_in: 3600,
        });
      return mockedFetch(url, init);
    },
  );
  let refreshed = false;
  const result = await fetchManualActivityBatchForActor(
    actor,
    {
      cursor: { before: 1_700_000_000, page: 1, done: true },
      isCurrent: async () => true,
      onProgress: async () => undefined,
      onRateLimited: () => undefined,
      replaceCredentials: async (previous, tokens) => {
        assert.equal(previous, 'test-token');
        refreshed = true;
        f.setAccount({ ...f.getAccount(), accessToken: tokens.access_token });
        return true;
      },
    },
    f.deps,
  );
  assert.equal(refreshed, true);
  assert.equal(result.stopReason, 'complete');
  assert.equal(result.requests, 8); // OAuth + recent page + two detail/photo sets.
});

void test('shared app load yields as busy without misreporting exhausted Strava quota', async (t) => {
  const { StravaBudgetBusyError } =
    await import('~/server/strava/request-budget');
  const { deps, calls, failures } = setup(t);
  deps.requestBudget!.reserve = async () => {
    throw new StravaBudgetBusyError();
  };
  const result = await warmSignupActivitiesForActor(actor, 200, deps);
  assert.equal(result.stopReason, 'busy');
  assert.equal(calls.length, 0);
  assert.deepEqual(failures, []);
});
