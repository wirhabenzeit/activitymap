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

void test('the Worker config and job schedule define a single hourly trigger', () => {
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

void test('failure in housekeeping does not stop later jobs', async () => {
  const { fetch } = fakeFetch({ '/api/cron/cleanup-rate-limits': 503 });
  const results = await runSchedule(hourly, { ...options, fetch });
  assert.deepEqual(
    results.slice(1).map(({ name, status }) => [name, status]),
    [
      ['cleanup-rate-limits', 503],
      ['erase-revoked-athletes', 200],
      ['reconcile-strava-summaries', 200],
      ['backfill-activity-streams', 200],
      ['backfill-activity-photos', 200],
      ['sync-activities', 200],
      ['match-activity-places', 200],
    ],
  );
});

void test('all eight jobs are POSTed once per hour in order with the cron secret and their bounds', async () => {
  const { fetch, calls } = fakeFetch({});
  const results = await runSchedule(hourly, { ...options, fetch });

  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      '/api/cron/drain-webhook-inbox',
      '/api/cron/cleanup-rate-limits',
      '/api/cron/erase-revoked-athletes',
      '/api/cron/reconcile-strava-summaries',
      '/api/cron/backfill-activity-streams',
      '/api/cron/backfill-activity-photos',
      '/api/cron/sync-activities',
      '/api/cron/match-activity-places',
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
    calls[3]!.init.body,
    JSON.stringify({ batchSize: 1, pagesPerAthlete: 3 }),
  );
  assert.equal(
    calls[4]!.init.body,
    JSON.stringify({ activityLimit: 40, requestLimit: 60 }),
  );
  assert.equal(calls[5]!.init.body, undefined);
  assert.equal(
    calls[6]!.init.body,
    JSON.stringify({
      maxIncompleteActivities: 30,
      maxOldActivities: 30,
      minActivitiesThreshold: 2,
    }),
  );
  assert.ok(results.every(isSuccess));
});

void test('a failed reconcile skips stream backfill but still catches up photos', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/cron/reconcile-strava-summaries': 503,
  });
  const results = await runSchedule(hourly, { ...options, fetch });

  assert.deepEqual(
    results.slice(3).map((result) => [result.name, result.status]),
    [
      ['reconcile-strava-summaries', 503],
      ['backfill-activity-streams', 'skipped'],
      ['backfill-activity-photos', 200],
      ['sync-activities', 200],
      ['match-activity-places', 200],
    ],
  );
  assert.ok(
    calls.every(
      (call) =>
        new URL(call.url).pathname !== '/api/cron/backfill-activity-streams',
    ),
  );
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
  const matching = results.find(({ name }) => name === 'match-activity-places');
  assert.equal(
    matching?.status,
    200,
    'Matching still runs when webhook ingestion fails',
  );

  assert.equal(result.status, 'error');
  assert.equal(result.body, 'connection reset');
  assert.equal(isSuccess(result), false);
});

void test('an unknown trigger is an error rather than a silent no-op', async () => {
  await assert.rejects(runSchedule('1 2 3 4 5', options), /No jobs/);
});
