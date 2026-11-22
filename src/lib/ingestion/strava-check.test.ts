import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import test from 'node:test';

import {
  type IngestionStatusDTO,
  ingestionStatusDTOSchema,
} from '~/contracts/v1/ingestion-status';

import {
  type StravaCheckRequest,
  requestStravaCheck,
  stravaCheckView,
} from './strava-check';

const fixtures = JSON.parse(
  readFileSync('shared/ingestion-status-fixtures.v1.json', 'utf8'),
) as { scenarios: { id: string; status: unknown }[] };
const scanning = ingestionStatusDTOSchema.parse(
  fixtures.scenarios.find((s) => s.id === 'initial-import-unknown-total')!
    .status,
);
const observed = Date.parse(scanning.observedAt);
const time = (iso: string) => `<${iso.slice(11, 16)}>`;
const at = (minutes: number) => observed + minutes * 60_000;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();
function sweep(
  reconciliation: Partial<IngestionStatusDTO['history']['reconciliation']>,
  history: Partial<IngestionStatusDTO['history']> = {},
): IngestionStatusDTO {
  return {
    ...scanning,
    history: {
      ...scanning.history,
      scheduling: 'scheduled',
      retryAt: null,
      ...history,
      reconciliation: { ...scanning.history.reconciliation, ...reconciliation },
    },
  };
}
const idle = sweep({
  phase: 'idle',
  pagesScanned: null,
  scanStartedAt: null,
  lastCompletedAt: iso(-120),
  nextDueAt: iso(6 * 24 * 60),
});
const view = (
  status: IngestionStatusDTO | undefined,
  request: StravaCheckRequest | null = null,
  now = at(1),
) => stravaCheckView(status, request, now, time);

void test('reopening Settings shows the check as the server has it', () => {
  // Idle: the button is available, with when the list was last read.
  assert.deepEqual(view(idle), {
    disabled: false,
    message: `Last checked <${iso(-120).slice(11, 16)}>.`,
  });
  // Requested (here or on another device) but not picked up yet.
  assert.deepEqual(
    view(sweep({ ...idle.history.reconciliation, nextDueAt: iso(-1) })),
    {
      disabled: true,
      message: 'Check requested. Missing activities appear as they are found.',
    },
  );
  // Reading the list, and then completing the library.
  assert.deepEqual(view(scanning), {
    disabled: true,
    message: `Checking your Strava activity list… Started <${scanning.history.reconciliation.scanStartedAt!.slice(11, 16)}>.`,
  });
  assert.match(
    view(sweep({ phase: 'confirming' })).message!,
    /^Activity list checked </,
  );
  // Strava's limit, and rejected credentials (the reconnect prompt speaks).
  assert.deepEqual(
    view(sweep({}, { scheduling: 'waiting', retryAt: iso(30) })),
    {
      disabled: true,
      message: `Strava’s request limit was reached. The check continues after <${iso(30).slice(11, 16)}>.`,
    },
  );
  assert.deepEqual(view(sweep({}, { scheduling: 'blocked' })), {
    disabled: true,
    message: null,
  });
  // No status yet: the server decides.
  assert.deepEqual(view(undefined), { disabled: false, message: null });
});

void test('the answer to a request is shown until a newer status replaces it', () => {
  const started: StravaCheckRequest = { kind: 'started', at: at(1) };
  // The status still predates the request.
  assert.deepEqual(view(idle, started, at(1)), {
    disabled: true,
    message: 'Check requested. Missing activities appear as they are found.',
  });
  // A newer status that already finished the (small) check wins.
  const finished = {
    ...idle,
    observedAt: iso(2),
    history: {
      ...idle.history,
      reconciliation: {
        ...idle.history.reconciliation,
        lastCompletedAt: iso(2),
      },
    },
  };
  assert.equal(view(finished, started, at(3)).disabled, false);

  // Checked within the hour: not asked again until then, even if the
  // status refreshes in between.
  const recent: StravaCheckRequest = {
    kind: 'recent',
    at: at(1),
    retryAt: at(45),
  };
  const expected = {
    disabled: true,
    message: `Strava was checked recently. You can check again after <${iso(45).slice(11, 16)}>.`,
  };
  assert.deepEqual(view(idle, recent, at(2)), expected);
  assert.deepEqual(
    view({ ...idle, observedAt: iso(5) }, recent, at(6)),
    expected,
  );
  assert.equal(view(idle, recent, at(46)).disabled, false);

  const failed: StravaCheckRequest = {
    kind: 'failed',
    at: at(1),
    retryAt: at(2),
    message: 'Nope.',
  };
  assert.deepEqual(view(idle, failed, at(1)), {
    disabled: true,
    message: 'Nope.',
  });
  assert.equal(view(idle, failed, at(3)).disabled, false);
});

void test('the request maps the command’s answer', async (t) => {
  const run = (status: string, retryAt: string | null = null) => ({
    schemaVersion: '1',
    serverTime: '2026-11-22T10:00:00.000Z',
    data: {
      available: true,
      runId: 'sweep-1',
      status,
      reason: null,
      startedAt: null,
      finishedAt: null,
      retryAt,
      summaries: 0,
      details: 0,
      photos: 0,
    },
  });
  const respond = (response: Response) =>
    t.mock.method(globalThis, 'fetch', async () => response);
  const now = () => 1_000;

  respond(Response.json(run('running')));
  assert.deepEqual(await requestStravaCheck(now), {
    kind: 'started',
    at: 1_000,
  });

  respond(Response.json(run('succeeded', '2026-11-22T11:00:00.000Z')));
  assert.deepEqual(await requestStravaCheck(now), {
    kind: 'recent',
    at: 1_000,
    retryAt: Date.parse('2026-11-22T11:00:00.000Z'),
  });

  respond(
    Response.json(
      {
        error: {
          code: 'rate_limited',
          message: 'Please wait for Strava capacity.',
          retryable: true,
          requestId: 'r',
        },
      },
      { status: 429, headers: { 'Retry-After': '120' } },
    ),
  );
  assert.deepEqual(await requestStravaCheck(now), {
    kind: 'failed',
    at: 1_000,
    retryAt: 121_000,
    message: 'Please wait for Strava capacity.',
  });

  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('offline');
  });
  assert.equal((await requestStravaCheck(now)).kind, 'failed');
});
