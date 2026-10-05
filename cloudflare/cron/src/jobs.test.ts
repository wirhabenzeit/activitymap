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

void test('every Worker cron trigger has jobs, and every job schedule is a trigger', () => {
  const config = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8',
  )
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  const crons = (JSON.parse(config) as { triggers: { crons: string[] } })
    .triggers.crons;
  assert.deepEqual([...crons].sort(), Object.keys(SCHEDULES).sort());
});

void test('jobs are POSTed in order with the cron secret and their bounds', async () => {
  const { fetch, calls } = fakeFetch({});
  const results = await runSchedule('37 * * * *', { ...options, fetch });

  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      '/api/cron/reconcile-strava-summaries',
      '/api/cron/backfill-activity-streams',
      '/api/cron/backfill-activity-photos',
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(
      (call.init.headers as Record<string, string>)['x-cron-secret'],
      's3cret',
    );
  }
  assert.equal(
    calls[1]!.init.body,
    JSON.stringify({ activityLimit: 40, requestLimit: 60 }),
  );
  assert.equal(calls[2]!.init.body, undefined);
  assert.ok(results.every(isSuccess));
});

void test('a failed reconcile skips stream backfill but still catches up photos', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/cron/reconcile-strava-summaries': 503,
  });
  const results = await runSchedule('37 * * * *', { ...options, fetch });

  assert.deepEqual(
    results.map((result) => [result.name, result.status]),
    [
      ['reconcile-strava-summaries', 503],
      ['backfill-activity-streams', 'skipped'],
      ['backfill-activity-photos', 200],
    ],
  );
  assert.equal(calls.length, 2);
});

void test('a network error is reported, not thrown', async () => {
  const { fetch } = fakeFetch({
    '/api/cron/drain-webhook-inbox': new Error('connection reset'),
  });
  const [result] = await runSchedule('*/5 * * * *', { ...options, fetch });

  assert.equal(result!.status, 'error');
  assert.equal(result!.body, 'connection reset');
  assert.equal(isSuccess(result!), false);
});

void test('an unknown trigger is an error rather than a silent no-op', async () => {
  await assert.rejects(runSchedule('1 2 3 4 5', options), /No jobs/);
});
