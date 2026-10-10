import assert from 'node:assert/strict';
import test from 'node:test';
import { runInitialImport, InitialImportError } from './initial-import';
import { makeEnvelope } from '~/contracts/v1/envelope';
import type { InitialImportDTO } from '~/contracts/v1/initial-import';

const status = (
  phase: InitialImportDTO['phase'],
  count = 0,
  retryAt: string | null = null,
): InitialImportDTO => ({
  phase,
  importedCount: count,
  target: 200,
  historyComplete: phase === 'empty',
  retryAt,
  message: null,
});
function responses(states: InitialImportDTO[], calls: string[]) {
  return (async (_url, options) => {
    calls.push(options!.method!);
    assert.equal(options!.credentials, 'include');
    return Response.json(makeEnvelope(states.shift()!, new Date()));
  }) as typeof fetch;
}
void test('web publishes and refreshes each batch before the next import request', async () => {
  const calls: string[] = [];
  const result = await runInitialImport({
    signal: new AbortController().signal,
    fetchImpl: responses(
      [
        status('not_started'),
        status('importing', 50),
        status('importing', 100),
        status('importing', 150),
        status('ready', 200),
      ],
      calls,
    ),
    onProgress: (state) => calls.push(`progress:${state.importedCount}`),
    onBatch: async () => {
      calls.push('browse');
    },
  });
  assert.deepEqual(calls, [
    'GET',
    'progress:0',
    'POST',
    'progress:50',
    'browse',
    'POST',
    'progress:100',
    'browse',
    'POST',
    'progress:150',
    'browse',
    'POST',
    'progress:200',
    'browse',
  ]);
  assert.equal(result.phase, 'ready');
});
void test('returning users do not trigger imports or onboarding messages', async () => {
  const calls: string[] = [];
  await runInitialImport({
    signal: new AbortController().signal,
    fetchImpl: responses([status('ready', 200)], calls),
    onProgress: () => {
      throw new Error('unexpected banner');
    },
    onBatch: async () => {
      throw new Error('unexpected refresh');
    },
  });
  assert.deepEqual(calls, ['GET']);
});
void test('server Retry-After and stored retry deadlines stop early POST retries', async () => {
  const calls: string[] = [];
  await runInitialImport({
    signal: new AbortController().signal,
    fetchImpl: responses(
      [status('paused', 50, new Date(Date.now() + 3600_000).toISOString())],
      calls,
    ),
    onProgress: () => undefined,
    onBatch: async () => undefined,
  });
  assert.deepEqual(calls, ['GET']);
  await assert.rejects(
    runInitialImport({
      signal: new AbortController().signal,
      fetchImpl: async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '3600' } }),
      onProgress: () => undefined,
      onBatch: async () => undefined,
    }),
    (error: unknown) =>
      error instanceof InitialImportError &&
      error.retryAt > Date.now() + 3500_000,
  );
});
void test('a saved failure can be retried, but a new failed batch never spins', async () => {
  const calls: string[] = [];
  await runInitialImport({
    signal: new AbortController().signal,
    fetchImpl: responses([status('failed', 50), status('failed', 50)], calls),
    onProgress: () => undefined,
    onBatch: async () => undefined,
  });
  assert.deepEqual(calls, ['GET', 'POST']);
});
void test('account cancellation rejects late progress before it refreshes browsing', async () => {
  const controller = new AbortController();
  await assert.rejects(
    runInitialImport({
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort();
        return Response.json(makeEnvelope(status('importing'), new Date()));
      },
      onProgress: () => {
        throw new Error('old account progress escaped');
      },
      onBatch: async () => {
        throw new Error('old account refreshed');
      },
    }),
    { name: 'AbortError' },
  );
});
