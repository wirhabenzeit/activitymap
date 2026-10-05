import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backfillActivityPhotos,
  type PhotoSourceFactory,
} from './photo-backfill';
import {
  PhotoBackfillStopped,
  type PhotoBackfillRepository,
  type PhotoClaim,
} from '~/server/repositories/photo-backfill';
import { StravaApiError } from '~/server/strava/client';
import type { StravaRequestBudget } from '~/server/strava/request-budget';

const claim = (id: number): PhotoClaim => ({
  activityId: id,
  athleteId: 42,
  userId: 'user',
  accountId: 'account',
  authorizationVersion: 'grant',
  sourceVersion: 'v1',
  token: `lease-${id}`,
  attemptCount: 1,
  tokens: {
    accessToken: 'test',
    refreshToken: null,
    expiresAtDate: new Date('2030-01-01'),
    expiresAtSeconds: 1893456000,
  },
});
const budget: StravaRequestBudget = {
  reserve: async () => ({ startedAt: new Date(), read: true }),
  observe: async () => undefined,
};
function fake(candidates: PhotoClaim[]) {
  const saved: number[] = [];
  const blocked: string[] = [];
  const released: Array<[number, string | null]> = [];
  let finished = false;
  let requests = 0;
  const repository: PhotoBackfillRepository = {
    start: async () => 'run',
    reserveRequest: async () => {
      requests++;
    },
    claimNext: async () => candidates.shift() ?? null,
    isCurrent: async () => true,
    blockAccount: async (c) => {
      blocked.push(c.accountId);
    },
    replaceCredentials: async (c) => c,
    complete: async (c) => {
      saved.push(c.activityId);
      return true;
    },
    release: async (c, error) => {
      released.push([c.activityId, error]);
    },
    finish: async () => {
      finished = true;
    },
  };
  return {
    repository,
    saved,
    blocked,
    released,
    get finished() {
      return finished;
    },
    get requests() {
      return requests;
    },
  };
}
void test('photo-only catch-up saves authoritative empty sets and accounts for requests', async () => {
  const f = fake([claim(1), claim(2)]);
  const result = await backfillActivityPhotos({
    repository: f.repository,
    requestBudget: budget,
    sourceFactory: (options) => ({
      getActivityPhotos: async () => {
        await options.beforeRequest();
        await options.requestBudget.reserve(true);
        await options.requestBudget.reserve(true);
        return [];
      },
    }),
  });
  assert.deepEqual(f.saved, [1, 2]);
  assert.equal(result.fetched, 2);
  assert.equal(result.requests, 4);
  assert.equal(f.requests, 4);
  assert.equal(f.finished, true);
});
void test('failed photos stay pending and do not prevent later candidates from progressing', async () => {
  const f = fake([claim(1), claim(2)]);
  const result = await backfillActivityPhotos({
    repository: f.repository,
    requestBudget: budget,
    sourceFactory: () => ({
      getActivityPhotos: async (id) => {
        if (id === 1) throw new StravaApiError('unavailable', 503);
        return [];
      },
    }),
  });
  assert.deepEqual(f.saved, [2]);
  assert.deepEqual(f.released, [[1, 'upstream_error']]);
  assert.equal(result.failed, 1);
});
void test('rate limits stop the run without treating the response as an empty photo collection', async () => {
  const f = fake([claim(1), claim(2)]);
  const result = await backfillActivityPhotos({
    repository: f.repository,
    requestBudget: budget,
    sourceFactory: () => ({
      getActivityPhotos: async () => {
        throw new StravaApiError('limited', 429);
      },
    }),
  });
  assert.deepEqual(f.saved, []);
  assert.equal(result.selected, 1);
  assert.equal(result.stopReason, 'rate_limited');
  assert.deepEqual(
    f.released,
    [[1, null]],
    'quota failures do not back off an activity',
  );
  assert.equal(f.finished, true);
});
void test('request cap and superseded activity release their leases without recording a photo failure', async () => {
  for (const reason of ['request_limit', 'superseded']) {
    const f = fake([claim(1)]);
    const result = await backfillActivityPhotos({
      repository: f.repository,
      requestBudget: budget,
      sourceFactory: () => ({
        getActivityPhotos: async () => {
          throw new PhotoBackfillStopped(reason);
        },
      }),
    });
    assert.deepEqual(f.saved, []);
    assert.deepEqual(f.released, [[1, null]]);
    assert.equal(result.failed, 0);
    assert.equal(
      result.stopReason,
      reason === 'superseded' ? 'complete' : reason,
    );
  }
});
void test('account rejection excludes that account from the remainder of the run', async () => {
  const f = fake([claim(1)]);
  const exclusions: string[][] = [];
  const original = f.repository.claimNext.bind(f.repository);
  f.repository.claimNext = async (token, excluded) => {
    exclusions.push([...(excluded ?? [])]);
    return original(token);
  };
  await backfillActivityPhotos({
    repository: f.repository,
    requestBudget: budget,
    sourceFactory: () => ({
      getActivityPhotos: async () => {
        throw new StravaApiError('unauthorized', 401);
      },
    }),
  });
  assert.deepEqual(exclusions, [[], ['user']]);
  assert.deepEqual(f.released, [[1, null]]);
  assert.deepEqual(f.blocked, ['account']);
});
void test('concurrent source update rejects the result even after a successful request', async () => {
  const f = fake([claim(1)]);
  f.repository.complete = async () => false;
  const result = await backfillActivityPhotos({
    repository: f.repository,
    requestBudget: budget,
    sourceFactory: () => ({ getActivityPhotos: async () => [] }),
  });
  assert.equal(result.fetched, 0);
  assert.equal(result.superseded, 1);
  assert.deepEqual(f.released, [[1, null]]);
});
void test('no second worker runs while the first holds the lease', async () => {
  const f = fake([]);
  f.repository.start = async () => null;
  const sourceFactory: PhotoSourceFactory = () => {
    throw new Error('must not fetch');
  };
  assert.equal(
    (await backfillActivityPhotos({ repository: f.repository, sourceFactory }))
      .stopReason,
    'busy',
  );
});

void test('parallel photo sizes share one token refresh and commit the collection', async (t) => {
  const keys = [
    'ACTIVITYMAP_EXTERNAL_EFFECTS',
    'AUTH_STRAVA_ID',
    'AUTH_STRAVA_SECRET',
  ] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() =>
    keys.forEach((key, index) => {
      if (previous[index] === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = previous[index];
    }),
  );
  process.env.ACTIVITYMAP_EXTERNAL_EFFECTS = 'enabled';
  process.env.AUTH_STRAVA_ID = 'test';
  process.env.AUTH_STRAVA_SECRET = 'test';
  const expired = claim(1);
  expired.tokens = {
    accessToken: null,
    refreshToken: 'old-refresh',
    expiresAtDate: new Date(0),
    expiresAtSeconds: 0,
  };
  const f = fake([expired]);
  let refreshes = 0;
  let persisted = 0;
  let photoRequests = 0;
  f.repository.replaceCredentials = async (c) => {
    // Mirrors the repository's compare-and-set: two callbacks with the old
    // grant cannot both carry this claim forward.
    if (persisted++) return null;
    return { ...c, authorizationVersion: 'new-grant' };
  };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/oauth/token')) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: 2_000_000_000,
        expires_in: 21_600,
      });
    }
    photoRequests++;
    return Response.json([]);
  });
  const result = await backfillActivityPhotos({
    repository: f.repository,
    requestBudget: budget,
  });
  assert.equal(refreshes, 1);
  assert.equal(persisted, 1);
  assert.equal(photoRequests, 2);
  assert.equal(result.requests, 3);
  assert.equal(result.fetched, 1);
  assert.equal(result.superseded, 0);
});
