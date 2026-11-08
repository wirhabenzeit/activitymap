'use node';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Infer } from 'convex/values';

import { decodeWhole } from '../recording/codec';
import { FIXTURE_SAMPLES, generateFixture } from '../recording/fixtures';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { fault, fixture } from './ingestion/validators';
import { uploadContentType } from './recording/validators';

const leaseMs = 6_000;
const crashes = [
  'before-detail',
  'after-detail',
  'before-streams',
  'after-streams',
  'before-upload',
  'after-upload',
  'during-commit',
  'after-commit',
  'overlap',
  'before-refresh',
  'after-refresh',
  'overlap-refresh',
] as const;
type Account = Id<'ingestionAccounts'>;

async function until<T>(
  label: string,
  read: () => Promise<T>,
  timeout = 25_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const j = internal.ingestionJobs;
    const p = internal.ingestionProbeRows;
    const since = Date.now();
    const prefix = `fixture-ingestion-probe-${randomUUID()}`;
    const accounts: Account[] = [];
    const apps = new Set<string>();
    const create = async (
      suffix: string,
      options: { expiredToken?: boolean; reconciliationMs?: number } = {},
    ) => {
      const app = `${prefix}-${suffix}`;
      const account = await ctx.runMutation(j.createAccount, {
        app,
        leaseMs,
        ...options,
      });
      accounts.push(account);
      apps.add(app);
      return account;
    };
    const read = (account: Account, key: string) =>
      ctx.runQuery(j.current, { account, key });
    const owner = (account: Account) => ctx.runQuery(p.account, { account });
    const published = (account: Account, key: string, version: number) =>
      until(`published ${key}/${version}`, async () => {
        const row = await read(account, key);
        return row?.recording && row.job.committedVersion === version
          ? row
          : null;
      });
    const envelope = (
      key: string,
      version: number,
      injected?: Infer<typeof fault>,
      sample: Infer<typeof fixture> = 'small',
      deleted = false,
    ) => ({
      key,
      version,
      fixture: sample,
      deleted,
      ...(injected ? { fault: injected } : {}),
    });
    const send = (
      account: Account,
      value: ReturnType<typeof envelope>,
      receipt: string = randomUUID(),
    ) => ctx.runMutation(j.receive, { account, generation: 1, receipt, value });
    const set = (account: Account, value: ReturnType<typeof envelope>) =>
      ctx.runMutation(j.setFixture, { account, value });
    const add = async (
      account: Account,
      value: ReturnType<typeof envelope>,
    ) => {
      await set(account, value);
      return send(account, value);
    };
    const purge = async (account: Account) => {
      await ctx.runMutation(j.revoke, { account });
      await until('account erasure', async () => {
        const state = await owner(account);
        return (
          state?.owner.state === 'revoked' &&
          !state.jobs &&
          !state.receipts &&
          !state.fixtures
        );
      });
    };
    const fileForAttempt = (id: Id<'recordingAttempts'>) =>
      until('stored upload before publication', async () =>
        (await ctx.runQuery(p.files, { since })).find(
          (row) => row.contentType === uploadContentType(id),
        ),
      );
    const uploading = (account: Account, key: string) =>
      until(
        'upload registration',
        async () => (await read(account, key))?.job.upload,
      );

    try {
      const events = await create('events');
      const first = envelope('9007199254740993', 1);
      await set(events, first);
      assert.deepEqual(
        (
          await Promise.all([
            send(events, first, 'same'),
            send(events, first, 'same'),
            send(events, first, 'different'),
          ])
        ).sort(),
        ['duplicate', 'outdated', 'queued'],
      );
      const row1 = await published(events, first.key, 1);
      assert.equal(row1.job.attempt, 1);
      assert.equal((await owner(events))?.receipts, 2);
      const other = await create('events');
      assert.equal(await read(other, first.key), null);
      const initial = row1.recording!;
      const blob = await ctx.storage.get(initial.manifest.file);
      assert(blob);
      assert.deepEqual(
        decodeWhole(
          new Uint8Array(await blob.arrayBuffer()),
          initial.manifest.manifest,
        ),
        generateFixture(FIXTURE_SAMPLES.small),
      );

      const update = envelope(first.key, 2, '403');
      await add(events, update);
      const failed = await until('activity backoff', async () => {
        const row = await read(events, first.key);
        return row?.job.lastFailure === 'forbidden' ? row : null;
      });
      assert.equal(failed.job.failures, 1);
      assert.equal(failed.recording, null);
      assert(await ctx.storage.get(initial.manifest.file));
      assert.equal((await owner(events))?.owner.state, 'active');
      assert(failed.job.due! > Date.now() + 3_500_000);
      assert.equal(await send(events, first), 'outdated');
      const empty = envelope(first.key, 3, undefined, 'empty');
      await add(events, empty);
      const emptyRow = await published(events, first.key, 3);
      assert.deepEqual(emptyRow.recording!.manifest.manifest.counts, {});
      assert.equal(emptyRow.recording!.summary?.basis, null);
      assert.equal(emptyRow.recording!.manifest.revision, 2);
      assert.equal(await ctx.storage.get(initial.manifest.file), null);

      const stale = envelope(first.key, 4, 'hold-upload');
      await add(events, stale);
      const staleUpload = await uploading(events, first.key);
      const staleFile = await fileForAttempt(staleUpload);
      await add(events, envelope(first.key, 5, undefined, 'typical'));
      const latest = await published(events, first.key, 5);
      assert.equal(latest.recording!.manifest.revision, 3);
      assert.equal(await send(events, stale), 'outdated');
      await until(
        'superseded file cleanup',
        async () => !(await ctx.storage.get(staleFile._id)),
      );
      assert.equal((await read(events, first.key))?.job.committedVersion, 5);
      assert(await ctx.storage.get(latest.recording!.manifest.file));

      // A rollback during replacement must also roll back removal of the prior file.
      await add(events, envelope(first.key, 6, 'during-commit'));
      const failedReplacement = await uploading(events, first.key);
      const failedWriter = (await read(events, first.key))!.job.worker!;
      await fileForAttempt(failedReplacement);
      await until(
        'replacement worker failed',
        async () =>
          (await ctx.runQuery(p.workerState, { worker: failedWriter })) ===
          'failed',
      );
      assert(await ctx.storage.get(latest.recording!.manifest.file));
      assert.equal((await read(events, first.key))?.recording, null);
      const replaced = await published(events, first.key, 6);
      assert.equal(replaced.recording!.manifest.revision, 4);
      assert.equal(
        await ctx.storage.get(latest.recording!.manifest.file),
        null,
      );

      await add(events, envelope(first.key, 7, 'hold-upload'));
      const deletedUpload = await uploading(events, first.key);
      const deletedFile = await fileForAttempt(deletedUpload);
      assert.equal(
        await add(events, envelope(first.key, 7, undefined, 'small', true)),
        'deleted',
      );
      assert.equal(await send(events, envelope(first.key, 7)), 'outdated');
      assert.equal(
        await ctx.storage.get(replaced.recording!.manifest.file),
        null,
      );
      await until(
        'deleted activity upload cleanup',
        async () => !(await ctx.storage.get(deletedFile._id)),
      );
      assert.equal((await read(events, first.key))?.job.phase, 'deleted');
      assert.equal((await read(events, first.key))?.recording, null);

      const revoked = await create('events', { expiredToken: true });
      await add(revoked, envelope('42', 1, 'overlap-refresh'));
      await until(
        'refresh lease',
        async () => (await owner(revoked))?.owner.refresh,
      );
      await purge(revoked);
      assert.equal(await send(revoked, envelope('42', 2)), 'ineligible');
      assert.equal((await owner(revoked))?.owner.token, 0);
      await add(other, envelope('42', 1, 'hold-upload'));
      const revokedUpload = await uploading(other, '42');
      const revokedFile = await fileForAttempt(revokedUpload);
      await purge(other);
      await until(
        'revoked account upload cleanup',
        async () => !(await ctx.storage.get(revokedFile._id)),
      );
      assert.equal(await read(other, '42'), null);

      const capApp = `${prefix}-cap`;
      apps.add(capApp);
      const cap = await ctx.runMutation(p.quotaCap, { app: capApp });
      assert.equal(
        cap.blockedRead,
        (Math.floor(cap.now / 900_000) + 1) * 900_000,
      );
      assert.equal(cap.allowedRefresh, null);
      const capWindows = await ctx.runQuery(p.budget, { app: capApp });
      assert.equal(
        capWindows.find((row) => row.window === 'overall:15m')?.used,
        76,
      );
      assert.equal(
        capWindows.find((row) => row.window === 'read:15m')?.used,
        75,
      );

      const quota = await create('quota');
      const sibling = await create('quota');
      await add(quota, envelope('1', 1, '429'));
      const blocked = await until('Retry-After', async () => {
        const row = await read(quota, '1');
        return row?.job.lastFailure === 'rate_limited' ? row.job : null;
      });
      assert.equal(blocked.failures, 0);
      assert(blocked.due! > Date.now() + 3_000);
      await add(sibling, envelope('2', 1));
      const siblingBlocked = await until(
        'shared provider deferral',
        async () => {
          const row = await read(sibling, '2');
          return row?.job.lastFailure === 'rate_limited' ? row.job : null;
        },
      );
      assert.equal(siblingBlocked.due, blocked.due);
      assert.equal(siblingBlocked.failures, 0);
      const budget = await ctx.runQuery(p.budget, { app: `${prefix}-quota` });
      assert.equal(budget.find((row) => row.window === 'read:15m')?.used, 2);
      await Promise.all([published(quota, '1', 1), published(sibling, '2', 1)]);

      await add(quota, envelope('3', 1, '401'));
      await until(
        'account credential block',
        async () => (await owner(quota))?.owner.state === 'blocked',
      );
      assert.equal((await read(quota, '3'))?.job.failures, 0);
      await add(quota, envelope('4', 1));
      await add(sibling, envelope('4', 1));
      await published(sibling, '4', 1);
      assert.equal((await read(quota, '4'))?.job.attempt, 0);

      const refreshAccount = await create('single-refresh', {
        expiredToken: true,
      });
      await Promise.all([
        add(refreshAccount, envelope('1', 1)),
        add(refreshAccount, envelope('2', 1)),
      ]);
      await Promise.all([
        published(refreshAccount, '1', 1),
        published(refreshAccount, '2', 1),
      ]);
      assert.equal((await owner(refreshAccount))?.owner.token, 2);
      const refreshBudget = await ctx.runQuery(p.budget, {
        app: `${prefix}-single-refresh`,
      });
      assert.equal(
        refreshBudget.find((row) => row.window === 'overall:15m')?.used,
        5,
      );
      assert.equal(
        refreshBudget.find((row) => row.window === 'read:15m')?.used,
        4,
      );

      const reconciliation = await create('reconcile', {
        reconciliationMs: 3_000,
      });
      await set(reconciliation, envelope('7', 1));
      const reconciliationDue = (await owner(reconciliation))!.owner
        .reconcileAt!;
      assert.equal(await read(reconciliation, '7'), null);
      const discovered = await published(reconciliation, '7', 1);
      assert(discovered.job._creationTime >= reconciliationDue);
      await set(reconciliation, envelope('7', 2, undefined, 'small', true));
      await until(
        'reconciled missing deletion',
        async () => (await read(reconciliation, '7'))?.job.phase === 'deleted',
      );
      assert.equal(
        await ctx.storage.get(discovered.recording!.manifest.file),
        null,
      );
      assert.equal((await owner(reconciliation))?.receipts, 0);
      assert((await owner(reconciliation))!.owner.reconciliationRuns >= 2);

      const trials = await Promise.all(
        crashes.map(async (injected, index) => {
          const start = Date.now();
          const refresh = injected.includes('refresh');
          const account = await create(
            refresh ? `refresh-${index}` : 'crashes',
            { expiredToken: refresh },
          );
          const key = String(index + 1);
          await add(account, envelope(key, 1, injected));
          const result = await published(account, key, 1);
          assert.equal(result.recording!.manifest.revision, 1, injected);
          assert.equal(
            result.job.attempt,
            injected === 'after-commit' ? 1 : 2,
            injected,
          );
          assert.equal(
            result.job.recoveries,
            injected === 'after-commit' ? 0 : 1,
            injected,
          );
          if (refresh) assert.equal((await owner(account))?.owner.token, 2);
          return {
            fault: injected,
            attempts: result.job.attempt,
            recoveries: result.job.recoveries,
            ms: Date.now() - start,
          };
        }),
      );
      // Let the deliberately delayed original actions finish and prove that
      // their expired/revoked credentials and uploads cannot change the result.
      await sleep(3_000);
      assert.equal((await owner(revoked))?.owner.token, 0);
      const activeFiles = await ctx.runQuery(p.files, { since });
      const expectedFiles = new Set<string>();
      for (const account of accounts) {
        for (const key of [
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          '10',
          '11',
          '12',
        ]) {
          const row = await read(account, key);
          if (row?.recording) expectedFiles.add(row.recording.manifest.file);
        }
      }
      assert.deepEqual(
        new Set(activeFiles.map((file) => file._id)),
        expectedFiles,
      );
      return {
        trials,
        quotaCap: 75,
        activeFiles: activeFiles.length,
        leaseMs,
        retryAfterMs: 4_000,
        elapsedMs: Date.now() - since,
      };
    } finally {
      // Wait for bounded background erasure before inspecting storage.
      for (const account of accounts) await purge(account);
      for (const app of apps) await ctx.runMutation(p.dispose, { app });
      await until(
        'zero residual marked files',
        async () => (await ctx.runQuery(p.files, { since })).length === 0,
      );
      await until(
        'zero residual upload attempts',
        async () => (await ctx.runQuery(p.attempts, { since })).length === 0,
      );
    }
  },
});
