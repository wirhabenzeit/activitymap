import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import { SCHEDULES, isSuccess, runSchedule } from './jobs.ts';

type Call = { url: string; init: RequestInit };

function fakeFetch(statuses: Record<string, number | Error>) {
  const calls: Call[] = [];
  const fetch = (async (input: URL, init?: RequestInit) => {
    const url = input.href;
    calls.push({ url, init: init ?? {} });
    const outcome = statuses[new URL(url).pathname] ?? 200;
    if (outcome instanceof Error) throw outcome;
    return new Response(JSON.stringify({ ok: outcome < 300 }), {
      status: outcome,
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = { baseUrl: 'https://activitymap.cc', cronSecret: 's3cret' };
const hourly = '0 * * * *';

void test('the Worker config and job schedule define one hourly batch', () => {
  const config = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8',
  )
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  const crons = (JSON.parse(config) as { triggers: { crons: string[] } })
    .triggers.crons;
  assert.deepEqual(crons, [hourly]);
  assert.deepEqual(Object.keys(SCHEDULES), crons);
});

void test('the hourly batch holds what still lives in Postgres, and no ingestion', async () => {
  const { fetch, calls } = fakeFetch({});
  const results = await runSchedule(hourly, { ...options, fetch });

  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      '/api/cron/drain-webhook-inbox',
      '/api/cron/cleanup-rate-limits',
      '/api/cron/erase-revoked-athletes',
      '/api/cron/mirror-convex-shadow',
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(
      (call.init.headers as Record<string, string>)['x-cron-secret'],
      's3cret',
    );
    assert.equal(call.init.body, undefined);
  }
  assert.ok(results.every(isSuccess));
});

void test('failure in one job does not stop the jobs after it', async () => {
  const { fetch } = fakeFetch({ '/api/cron/cleanup-rate-limits': 503 });
  const results = await runSchedule(hourly, { ...options, fetch });
  assert.deepEqual(
    results.map(({ name, status }) => [name, status]),
    [
      ['drain-webhook-inbox', 200],
      ['cleanup-rate-limits', 503],
      ['erase-revoked-athletes', 200],
      ['mirror-convex-shadow', 200],
    ],
  );
});

void test('a job is skipped when the job it requires did not succeed', async () => {
  const { fetch, calls } = fakeFetch({ '/api/first': 503 });
  SCHEDULES['9 9 9 9 9'] = [
    { name: 'first', path: '/api/first' },
    { name: 'second', path: '/api/second', requires: 'first' },
    { name: 'third', path: '/api/third' },
  ];
  try {
    const results = await runSchedule('9 9 9 9 9', { ...options, fetch });
    assert.deepEqual(
      results.map(({ name, status }) => [name, status]),
      [
        ['first', 503],
        ['second', 'skipped'],
        ['third', 200],
      ],
    );
    assert.deepEqual(
      calls.map((call) => new URL(call.url).pathname),
      ['/api/first', '/api/third'],
    );
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only entry
    delete SCHEDULES['9 9 9 9 9'];
  }
});

void test('a network error is reported, not thrown', async () => {
  const { fetch } = fakeFetch({
    '/api/cron/drain-webhook-inbox': new Error('connection reset'),
  });
  const results = await runSchedule(hourly, {
    ...options,
    fetch,
  });
  const result = results[0]!;
  assert.equal(
    results.at(-1)?.status,
    200,
    'Later jobs still run when the inbox drain fails',
  );

  assert.equal(result.status, 'error');
  assert.equal(result.body, 'connection reset');
  assert.equal(isSuccess(result), false);
});

void test('an unknown trigger is an error rather than a silent no-op', async () => {
  await assert.rejects(runSchedule('1 2 3 4 5', options), /No jobs/);
});
