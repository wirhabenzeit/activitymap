import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceInitialImport, presentInitialImport } from './initial-import';
import type {
  InitialImportRepository,
  InitialImportState,
} from '~/server/repositories/initial-import';
import type { Account } from '~/server/db/schema';
import { StravaBudgetExceededError } from '~/server/strava/request-budget';
import { StravaApiError } from '~/server/strava/client';

const actor = {
  userId: 'alice',
  athleteId: 42,
  authentication: 'bearer' as const,
};
const time = new Date('2026-10-10T12:00:00Z');
const account = {
  access_token: 'test-only',
  revokedAt: null,
  accountId: '42',
} as Account;
function harness() {
  let state: InitialImportState | null = null;
  let calls = 0;
  const repository: InitialImportRepository = {
    read: async () => state,
    claim: async (_actor, now) => {
      if (state?.leaseToken) return null;
      state ??= {
        userId: 'alice',
        athleteId: 42,
        startedAt: now,
        before: 1791633601,
        nextPage: 1,
        importedCount: 0,
        completedAt: null,
        historyComplete: false,
        leaseToken: null,
        leaseExpiresAt: null,
        retryAt: null,
        message: null,
      };
      state.leaseToken = 'claim';
      return { ...state, leaseToken: 'claim', before: state.before! };
    },
    commit: async (_actor, claim, page, now) => {
      assert.equal(claim.nextPage, state!.nextPage);
      state!.importedCount += page.length;
      state!.nextPage++;
      state!.historyComplete = page.length < 50;
      state!.completedAt =
        state!.historyComplete || state!.importedCount >= 200 ? now : null;
      state!.leaseToken = null;
      state!.retryAt = null;
      state!.message = null;
    },
    fail: async (_actor, _claim, message, retryAt) => {
      state!.message = message;
      state!.retryAt = retryAt;
      state!.leaseToken = null;
    },
  };
  const deps = {
    repository,
    now: () => time,
    enabled: () => true,
    resolveAccount: async () => account,
    createSource: () => ({
      getActivities: async (params: {
        per_page?: number;
        page?: number;
        before?: number;
      }) => {
        calls++;
        assert.equal(params.per_page, 50);
        assert.equal(params.page, state!.nextPage);
        assert.equal(params.before, 1791633601);
        return Array.from({ length: 50 }, (_, n) => ({
          id: n + state!.nextPage * 50,
        })) as never;
      },
    }),
  };
  return {
    deps,
    get calls() {
      return calls;
    },
    get state() {
      return state!;
    },
  };
}

void test('four bounded pages reach 200, keep one cutoff, and completed accounts never call Strava again', async () => {
  const h = harness();
  for (const expected of [50, 100, 150, 200]) {
    const progress = await advanceInitialImport(actor, h.deps);
    assert.equal(progress.importedCount, expected);
    assert.equal(progress.phase, expected === 200 ? 'ready' : 'importing');
  }
  assert.equal(h.calls, 4);
  assert.equal(
    (await advanceInitialImport(actor, h.deps)).historyComplete,
    false,
  );
  assert.equal(h.calls, 4);
});
void test('an empty account is complete, and a small library needs no invented 200-item target', async () => {
  for (const size of [0, 7, 49]) {
    const h = harness();
    const progress = await advanceInitialImport(actor, {
      ...h.deps,
      createSource: () => ({
        getActivities: async () =>
          Array.from({ length: size }, (_, id) => ({ id })) as never,
      }),
    });
    assert.equal(progress.phase, size ? 'ready' : 'empty');
    assert.equal(progress.importedCount, size);
    assert.equal(progress.historyComplete, true);
  }
});
void test('rate limits retain progress and the same next page; early retries do no upstream work', async () => {
  const h = harness();
  await advanceInitialImport(actor, h.deps);
  const failed = await advanceInitialImport(actor, {
    ...h.deps,
    createSource: () => ({
      getActivities: async () => {
        throw new StravaBudgetExceededError(3600);
      },
    }),
  });
  assert.equal(failed.phase, 'paused');
  assert.equal(failed.importedCount, 50);
  assert.equal(
    failed.retryAt,
    new Date(time.getTime() + 3600_000).toISOString(),
  );
  await advanceInitialImport(actor, h.deps);
  assert.equal(h.calls, 1);
  assert.equal(h.state.nextPage, 2);
  const resumed = await advanceInitialImport(actor, {
    ...h.deps,
    now: () => new Date(time.getTime() + 3601_000),
  });
  assert.equal(resumed.importedCount, 100);
});
void test('rejected credentials and a changed account never fetch or commit another account data', async () => {
  const h = harness();
  const progress = await advanceInitialImport(actor, {
    ...h.deps,
    resolveAccount: async () => ({ ...account, accountId: '99' }),
  });
  assert.equal(progress.phase, 'failed');
  assert.equal(h.calls, 0);
  const denied = await advanceInitialImport(actor, {
    ...h.deps,
    createSource: () => ({
      getActivities: async () => {
        throw new StravaApiError('Denied', 403);
      },
    }),
  });
  assert.equal(denied.phase, 'failed');
  assert.equal(denied.importedCount, 0);
});
void test('a concurrent lease performs no second credential lookup or upstream fetch', async () => {
  const h = harness();
  await h.deps.repository.claim(actor, time);
  const progress = await advanceInitialImport(actor, {
    ...h.deps,
    resolveAccount: async () => {
      throw new Error('must not resolve');
    },
  });
  assert.equal(progress.phase, 'importing');
  assert.equal(h.calls, 0);
});
void test('migration-exempt existing accounts are ready even without an onboarding count', async () => {
  const h = harness();
  await h.deps.repository.claim(actor, time);
  assert.equal(
    presentInitialImport(
      { ...h.state, startedAt: null, completedAt: time, importedCount: 0 },
      time,
    ).phase,
    'ready',
  );
});
