import { type Infer, v } from 'convex/values';

import { supersedes } from '../../../../../backend/ingestion/source-order';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { recordRateLimit, reserve } from './ingestion/budget';
import { claim, event, request } from './ingestion/validators';
import { updateFixturePreview } from './previewRows';
import { manifestValidator, summaryValidator } from './recording/validators';
import {
  beginUpload,
  eraseTarget,
  publishUpload,
  readCurrent,
  retireUpload,
} from './recordingRows';

const eventValidator = v.object(event);
const claimValidator = v.object(claim);
type Event = Infer<typeof eventValidator>;
type Claim = Infer<typeof claimValidator>;
type Job = Doc<'ingestionJobs'>;
type Account = Doc<'ingestionAccounts'>;

function jobFor(ctx: QueryCtx, account: Id<'ingestionAccounts'>, key: string) {
  return ctx.db
    .query('ingestionJobs')
    .withIndex('account_key', (q) => q.eq('account', account).eq('key', key))
    .unique();
}

function fixtureFor(
  ctx: QueryCtx,
  account: Id<'ingestionAccounts'>,
  key: string,
) {
  return ctx.db
    .query('ingestionFixtures')
    .withIndex('account_key', (q) => q.eq('account', account).eq('key', key))
    .unique();
}

function checkEvent(value: Event) {
  if (
    !/^[1-9][0-9]{0,19}$/.test(value.key) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    throw new Error(
      'Expected a canonical decimal activity ID and positive fixture revision',
    );
  }
}

async function queue(ctx: MutationCtx, job: Id<'ingestionJobs'>, due: number) {
  await ctx.db.patch('ingestionJobs', job, {
    phase: 'queued',
    due,
    leaseUntil: undefined,
    worker: undefined,
    upload: undefined,
  });
  await ctx.scheduler.runAt(due, internal.ingestionJobs.dispatch, { job, due });
}

async function enqueue(ctx: MutationCtx, account: Account, value: Event) {
  const prior = await jobFor(ctx, account._id, value.key);
  if (!supersedes(value, prior)) return 'outdated';
  const target = prior?.target
    ? await ctx.db.get('recordingTargets', prior.target)
    : null;
  if (target) {
    if (value.deleted) await eraseTarget(ctx, target);
    else
      await ctx.db.patch('recordingTargets', target._id, {
        sourceVersion: sourceVersion(value.version),
        latestAttempt: undefined,
      });
  }
  const reset = {
    ...value,
    fault: value.fault,
    generation: account.generation,
    phase: (value.deleted ? 'deleted' : 'queued') as 'deleted' | 'queued',
    revisionAttempts: 0,
    recoveries: 0,
    failures: 0,
    due: undefined,
    leaseUntil: undefined,
    worker: undefined,
    upload: undefined,
    lastFailure: undefined,
    target: value.deleted ? undefined : prior?.target,
    name: value.deleted ? undefined : prior?.name,
    committedVersion: value.deleted ? undefined : prior?.committedVersion,
  };
  let id;
  if (prior) {
    id = prior._id;
    await ctx.db.patch('ingestionJobs', id, reset);
  } else {
    id = await ctx.db.insert('ingestionJobs', {
      account: account._id,
      ...reset,
      attempt: 0,
    });
  }
  if (!value.deleted) await queue(ctx, id, Date.now());
  await updateFixturePreview(
    ctx,
    account._id,
    value.key,
    value.deleted ? 'delete' : 'invalidate',
  );
  return value.deleted ? 'deleted' : 'queued';
}

const sourceVersion = (version: number) => `fixture-v1:${version}`;

async function scheduleReconciliation(
  ctx: MutationCtx,
  account: Account,
  due: number,
) {
  await ctx.db.patch('ingestionAccounts', account._id, { reconcileAt: due });
  await ctx.scheduler.runAt(due, internal.ingestionJobs.reconcile, {
    account: account._id,
    generation: account.generation,
    due,
  });
}

export const createAccount = internalMutation({
  args: {
    app: v.string(),
    leaseMs: v.optional(v.number()),
    reconciliationMs: v.optional(v.number()),
    expiredToken: v.optional(v.boolean()),
    matchingCatalogue: v.optional(v.id('matchingCatalogues')),
  },
  handler: async (
    ctx,
    {
      app,
      leaseMs = 30_000,
      reconciliationMs = 3_600_000,
      expiredToken = false,
      matchingCatalogue,
    },
  ) => {
    if (
      !/^fixture-[a-z0-9-]{1,72}$/.test(app) ||
      !Number.isSafeInteger(leaseMs) ||
      leaseMs < 3_000 ||
      leaseMs > 60_000 ||
      !Number.isSafeInteger(reconciliationMs) ||
      reconciliationMs < 2_000 ||
      reconciliationMs > 3_600_000
    )
      throw new Error('Invalid fixture account settings');
    const id = await ctx.db.insert('ingestionAccounts', {
      app,
      matchingCatalogue,
      generation: 1,
      state: 'active',
      token: 1,
      tokenExpired: expiredToken,
      leaseMs,
      reconciliationMs,
      reconciliationRuns: 0,
    });
    const account = await ctx.db.get('ingestionAccounts', id);
    await scheduleReconciliation(ctx, account!, Date.now() + reconciliationMs);
    return id;
  },
});

// A generated provider snapshot can change without delivering a webhook.
export const setFixture = internalMutation({
  args: { account: v.id('ingestionAccounts'), value: eventValidator },
  handler: async (ctx, { account, value }) => {
    checkEvent(value);
    const owner = await ctx.db.get('ingestionAccounts', account);
    if (!owner || owner.state === 'revoked') return false;
    const prior = await fixtureFor(ctx, account, value.key);
    if (!supersedes(value, prior)) return false;
    if (prior)
      await ctx.db.patch('ingestionFixtures', prior._id, {
        ...value,
        fault: value.fault,
      });
    else await ctx.db.insert('ingestionFixtures', { account, ...value });
    return true;
  },
});

export const receive = internalMutation({
  args: {
    account: v.id('ingestionAccounts'),
    generation: v.number(),
    receipt: v.string(),
    value: eventValidator,
  },
  handler: async (
    ctx,
    { account, generation, receipt, value },
  ): Promise<string> => {
    checkEvent(value);
    if (!receipt || receipt.length > 256) throw new Error('Invalid receipt');
    const owner = await ctx.db.get('ingestionAccounts', account);
    if (!owner || owner.generation !== generation || owner.state === 'revoked')
      return 'ineligible';
    const prior = await ctx.db
      .query('ingestionReceipts')
      .withIndex('account_receipt', (q) =>
        q.eq('account', account).eq('receipt', receipt),
      )
      .unique();
    if (prior) return 'duplicate';
    await ctx.db.insert('ingestionReceipts', { account, receipt });
    return enqueue(ctx, owner, value);
  },
});

export const dispatch = internalMutation({
  args: { job: v.id('ingestionJobs'), due: v.number() },
  handler: async (ctx, { job: id, due }) => {
    const job = await ctx.db.get('ingestionJobs', id);
    if (!job || job.phase !== 'queued' || job.due !== due || due > Date.now())
      return;
    const account = await ctx.db.get('ingestionAccounts', job.account);
    if (
      !account ||
      account.state !== 'active' ||
      account.generation !== job.generation
    )
      return;
    const attempt = job.attempt + 1;
    const leaseUntil = Date.now() + account.leaseMs;
    const worker = await ctx.scheduler.runAfter(
      0,
      internal.ingestionWorker.run,
      { job: id, attempt },
    );
    await ctx.db.patch('ingestionJobs', id, {
      phase: 'fetch',
      attempt,
      revisionAttempts: job.revisionAttempts + 1,
      due: undefined,
      leaseUntil,
      worker,
    });
    await ctx.scheduler.runAt(leaseUntil, internal.ingestionJobs.recover, {
      job: id,
      attempt,
    });
  },
});

export const recover = internalMutation({
  args: claim,
  handler: async (ctx, { job: id, attempt }) => {
    const job = await ctx.db.get('ingestionJobs', id);
    if (
      !job ||
      job.attempt !== attempt ||
      job.leaseUntil === undefined ||
      job.leaseUntil > Date.now()
    )
      return;
    const account = await ctx.db.get('ingestionAccounts', job.account);
    if (
      !account ||
      account.state !== 'active' ||
      account.generation !== job.generation
    )
      return;
    if (account.refresh?.job === id && account.refresh.attempt === attempt) {
      await ctx.db.patch('ingestionAccounts', account._id, {
        refresh: undefined,
      });
    }
    await ctx.db.patch('ingestionJobs', id, {
      recoveries: job.recoveries + 1,
      lastFailure: 'lease_expired',
    });
    // A scheduler outage or repeated runtime failure should not hot-loop.
    await queue(
      ctx,
      id,
      Date.now() + Math.min(60_000, 250 * 2 ** Math.min(job.recoveries, 8)),
    );
  },
});

async function held(ctx: MutationCtx, { job: id, attempt }: Claim) {
  const job = await ctx.db.get('ingestionJobs', id);
  if (!job || job.attempt !== attempt || (job.leaseUntil ?? 0) <= Date.now())
    return null;
  const account = await ctx.db.get('ingestionAccounts', job.account);
  if (
    !account ||
    account.state !== 'active' ||
    account.generation !== job.generation
  )
    return null;
  return { job, account };
}

async function failActivity(ctx: MutationCtx, job: Job, reason: string) {
  const failures = job.failures + 1;
  const retryMs = Math.min(
    86_400_000,
    3_600_000 * 2 ** Math.min(failures - 1, 5),
  );
  await ctx.db.patch('ingestionJobs', job._id, {
    failures,
    lastFailure: reason,
  });
  await queue(ctx, job._id, Date.now() + retryMs);
}

export const nextRequest = internalMutation({
  args: {
    ...claim,
    previous: v.union(v.literal('fetch'), v.literal('detail')),
  },
  handler: async (ctx, { previous, ...token }) => {
    const live = await held(ctx, token);
    if (!live || live.job.phase !== previous) return null;
    const { job, account } = live;
    const snapshot = await fixtureFor(ctx, job.account, job.key);
    if (snapshot && supersedes(snapshot, job)) {
      const { key, version, deleted, fixture, fault } = snapshot;
      await enqueue(ctx, account, { key, version, deleted, fixture, fault });
      return null;
    }
    if (!snapshot || snapshot.version !== job.version || snapshot.deleted) {
      await failActivity(ctx, job, 'source_mismatch');
      return null;
    }
    const kind = account.tokenExpired
      ? 'refresh'
      : previous === 'fetch'
        ? 'detail'
        : 'streams';
    const now = Date.now();
    if (kind === 'refresh' && account.refresh && account.refresh.until > now) {
      await queue(ctx, job._id, account.refresh.until);
      return null;
    }
    const retryAt = await reserve(ctx, account.app, kind !== 'refresh', now);
    if (retryAt !== null) {
      await ctx.db.patch('ingestionJobs', job._id, {
        lastFailure: 'rate_limited',
      });
      await queue(ctx, job._id, retryAt);
      return null;
    }
    if (kind === 'refresh') {
      await ctx.db.patch('ingestionAccounts', account._id, {
        refresh: { ...token, until: job.leaseUntil! },
      });
    }
    await ctx.db.patch('ingestionJobs', job._id, { phase: kind });
    return {
      kind,
      key: job.key,
      version: job.version,
      fixture: snapshot.fixture,
      fault:
        job.revisionAttempts === 1 ||
        job.fault === '401' ||
        job.fault === '403' ||
        job.fault === '500'
          ? job.fault
          : undefined,
      credential: account.token,
      startedAt: now,
      leaseMs: account.leaseMs,
    };
  },
});

export const refreshed = internalMutation({
  args: { ...claim, previous: v.number(), next: v.number() },
  handler: async (ctx, { previous, next, ...token }) => {
    const live = await held(ctx, token);
    if (!live || live.job.phase !== 'refresh') return false;
    const { job, account } = live;
    if (
      account.refresh?.job !== token.job ||
      account.refresh.attempt !== token.attempt ||
      account.token !== previous ||
      next !== previous + 1
    )
      return false;
    await ctx.db.patch('ingestionAccounts', account._id, {
      token: next,
      tokenExpired: false,
      refresh: undefined,
    });
    await ctx.db.patch('ingestionJobs', job._id, { phase: 'fetch' });
    return true;
  },
});

export const failed = internalMutation({
  args: {
    ...claim,
    request,
    credential: v.number(),
    startedAt: v.number(),
    status: v.union(
      v.literal(401),
      v.literal(403),
      v.literal(429),
      v.literal(500),
    ),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { request: kind, status, credential, startedAt, retryAfterMs, ...token },
  ) => {
    const candidate = await ctx.db.get('ingestionJobs', token.job);
    const owner =
      candidate && (await ctx.db.get('ingestionAccounts', candidate.account));
    // A real 429 is application-wide, even when the originating attempt expired.
    const retryAt =
      status === 429 && owner
        ? await recordRateLimit(ctx, owner.app, startedAt, retryAfterMs)
        : null;
    const live = await held(ctx, token);
    if (!live || live.job.phase !== kind) return;
    const { job, account } = live;
    if (kind === 'refresh')
      await ctx.db.patch('ingestionAccounts', account._id, {
        refresh: undefined,
      });
    if (retryAt !== null) {
      await ctx.db.patch('ingestionJobs', job._id, {
        lastFailure: 'rate_limited',
      });
      await queue(ctx, job._id, Math.max(Date.now(), retryAt));
    } else if (status === 401) {
      if (account.token === credential) {
        await ctx.db.patch('ingestionAccounts', account._id, {
          state: 'blocked',
          refresh: undefined,
        });
        await ctx.db.patch('ingestionJobs', job._id, {
          phase: 'queued',
          leaseUntil: undefined,
          worker: undefined,
          lastFailure: 'unauthorized',
        });
      } else {
        // A rejected old credential cannot block a newer grant.
        await queue(ctx, job._id, Date.now());
      }
    } else {
      await failActivity(
        ctx,
        job,
        status === 403 ? 'forbidden' : 'upstream_error',
      );
    }
  },
});

export const registerUpload = internalMutation({
  args: {
    ...claim,
    credential: v.number(),
    manifest: manifestValidator,
    compressedHash: v.string(),
  },
  handler: async (
    ctx,
    { credential, manifest, compressedHash, ...token },
  ): Promise<Id<'recordingAttempts'> | null> => {
    const live = await held(ctx, token);
    if (
      !live ||
      live.job.phase !== 'streams' ||
      live.account.token !== credential
    )
      return null;
    const { job, account } = live;
    const target =
      job.target ??
      (await ctx.db.insert('recordingTargets', {
        owner: account._id,
        key: job.key,
        accountGeneration: String(account.generation),
        generation: `${job._id}:${job.attempt}`,
        sourceVersion: sourceVersion(job.version),
      }));
    const upload = await beginUpload(ctx, target, manifest, compressedHash);
    await ctx.db.patch('ingestionJobs', job._id, {
      target,
      upload,
      phase: 'upload',
    });
    await ctx.scheduler.runAt(
      job.leaseUntil!,
      internal.ingestionJobs.recoverUpload,
      {
        upload,
        worker: job.worker!,
      },
    );
    return upload;
  },
});

export const recoverUpload = internalMutation({
  args: {
    upload: v.id('recordingAttempts'),
    worker: v.id('_scheduled_functions'),
  },
  handler: async (ctx, { upload, worker }) => {
    const scheduled = await ctx.db.system.get('_scheduled_functions', worker);
    if (
      scheduled?.state.kind === 'success' ||
      scheduled?.state.kind === 'failed'
    ) {
      await retireUpload(ctx, upload);
    }
    // If the writer is still running, the registered 15-minute reaper owns it.
  },
});

export const abandonUpload = internalMutation({
  args: { upload: v.id('recordingAttempts') },
  handler: (ctx, { upload }) => retireUpload(ctx, upload),
});

export const commit = internalMutation({
  args: {
    ...claim,
    credential: v.number(),
    upload: v.id('recordingAttempts'),
    file: v.id('_storage'),
    summary: summaryValidator,
    name: v.string(),
  },
  handler: async (
    ctx,
    { credential, upload, file, summary, name, ...token },
  ): Promise<boolean> => {
    const live = await held(ctx, token);
    if (
      !live ||
      live.job.phase !== 'upload' ||
      live.job.upload !== upload ||
      live.account.token !== credential
    )
      return false;
    const { job, account } = live;
    const snapshot = await fixtureFor(ctx, job.account, job.key);
    if (snapshot && supersedes(snapshot, job)) {
      const { key, version, deleted, fixture, fault } = snapshot;
      await enqueue(ctx, account, { key, version, deleted, fixture, fault });
      return false;
    }
    if ((await publishUpload(ctx, upload, file, summary)) === null)
      return false;
    await ctx.db.patch('ingestionJobs', job._id, {
      phase: 'complete',
      committedVersion: job.version,
      name,
      failures: 0,
      lastFailure: undefined,
      leaseUntil: undefined,
      worker: undefined,
      upload: undefined,
    });
    if (job.target)
      await updateFixturePreview(ctx, account._id, job.key, {
        target: job.target,
        name,
      });
    if (account.matchingCatalogue)
      await ctx.scheduler.runAfter(0, internal.matchingFixture.enqueue, {
        job: job._id,
        version: job.version,
        generation: account.generation,
      });
    if (job.revisionAttempts === 1 && job.fault === 'during-commit')
      throw new Error('Injected during commit');
    return true;
  },
});

export const reconcile = internalMutation({
  args: {
    account: v.id('ingestionAccounts'),
    generation: v.number(),
    due: v.number(),
  },
  handler: async (ctx, { account: id, generation, due }) => {
    const account = await ctx.db.get('ingestionAccounts', id);
    if (
      !account ||
      account.state !== 'active' ||
      account.generation !== generation ||
      account.reconcileAt !== due ||
      due > Date.now()
    )
      return;
    const retryAt = await reserve(ctx, account.app, true, Date.now());
    if (retryAt !== null) {
      await scheduleReconciliation(ctx, account, retryAt);
      return;
    }
    const page = await ctx.db
      .query('ingestionFixtures')
      .withIndex('account_key', (q) => q.eq('account', id))
      .paginate({ cursor: account.reconcileCursor ?? null, numItems: 20 });
    for (const { key, version, deleted, fixture, fault } of page.page) {
      await enqueue(ctx, account, { key, version, deleted, fixture, fault });
    }
    await ctx.db.patch('ingestionAccounts', id, {
      reconcileCursor: page.isDone ? undefined : page.continueCursor,
      reconciliationRuns: account.reconciliationRuns + Number(page.isDone),
    });
    await scheduleReconciliation(
      ctx,
      account,
      Date.now() + (page.isDone ? account.reconciliationMs : 0),
    );
  },
});

export const revoke = internalMutation({
  args: { account: v.id('ingestionAccounts') },
  handler: async (ctx, { account: id }) => {
    const account = await ctx.db.get('ingestionAccounts', id);
    if (!account || account.state === 'revoked') return;
    await ctx.db.patch('ingestionAccounts', id, {
      state: 'revoked',
      generation: account.generation + 1,
      refresh: undefined,
      reconcileAt: undefined,
      reconcileCursor: undefined,
      token: 0,
      tokenExpired: true,
    });
    if (account.matchingCatalogue)
      await ctx.scheduler.runAfter(0, internal.matchingFixture.erase, {
        account: id,
      });
    await ctx.scheduler.runAfter(0, internal.ingestionJobs.eraseBatch, {
      account: id,
    });
  },
});

export const eraseBatch = internalMutation({
  args: { account: v.id('ingestionAccounts') },
  handler: async (ctx, { account }) => {
    if ((await ctx.db.get('ingestionAccounts', account))?.state !== 'revoked')
      return;
    const jobs = await ctx.db
      .query('ingestionJobs')
      .withIndex('account_key', (q) => q.eq('account', account))
      .take(20);
    for (const job of jobs) {
      const target = job.target
        ? await ctx.db.get('recordingTargets', job.target)
        : null;
      if (target) await eraseTarget(ctx, target);
      await ctx.db.delete('ingestionJobs', job._id);
    }
    const receipts = await ctx.db
      .query('ingestionReceipts')
      .withIndex('account_receipt', (q) => q.eq('account', account))
      .take(20);
    for (const receipt of receipts)
      await ctx.db.delete('ingestionReceipts', receipt._id);
    const fixtures = await ctx.db
      .query('ingestionFixtures')
      .withIndex('account_key', (q) => q.eq('account', account))
      .take(20);
    for (const fixture of fixtures)
      await ctx.db.delete('ingestionFixtures', fixture._id);
    if (Math.max(jobs.length, receipts.length, fixtures.length) === 20) {
      await ctx.scheduler.runAfter(0, internal.ingestionJobs.eraseBatch, {
        account,
      });
    }
  },
});

export const current = internalQuery({
  args: { account: v.id('ingestionAccounts'), key: v.string() },
  handler: async (ctx, { account: id, key }) => {
    const account = await ctx.db.get('ingestionAccounts', id);
    if (!account || account.state === 'revoked') return null;
    const job = await jobFor(ctx, id, key);
    if (!job) return null;
    const target = job.target
      ? await ctx.db.get('recordingTargets', job.target)
      : null;
    const recording = target ? await readCurrent(ctx, target) : null;
    return { job, recording };
  },
});
