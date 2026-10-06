import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ingestionStatusDTOSchema } from '~/contracts/v1/ingestion-status';
import type { BackgroundJobRun } from '~/server/db/schema';
import type { IngestionSnapshot } from '~/server/repositories/ingestion-status';
import { deriveIngestionStatus, jobState } from './ingestion-status.ts';

type Scenario = {
  id: string;
  streamBackfillEnabled: boolean;
  snapshot: unknown;
  status: unknown;
};

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      '../../../shared/ingestion-status-fixtures.v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { version: number; scenarios: Scenario[] };

/** JSON snapshots carry ISO strings where the read model has Dates. */
function revive(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value))
    return new Date(value);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, revive(entry)]),
    );
  return value;
}

for (const scenario of fixtures.scenarios) {
  void test(`shared fixture ${scenario.id} derives exactly its committed status`, () => {
    const status = deriveIngestionStatus(
      revive(scenario.snapshot) as IngestionSnapshot,
      { streamBackfillEnabled: scenario.streamBackfillEnabled },
    );
    assert.deepEqual(ingestionStatusDTOSchema.parse(status), status);
    assert.deepEqual(status, scenario.status);

    // The contract's documented partitions hold for every scenario.
    const known = status.history.knownActivityCount;
    const { details, streams, photos } = status;
    assert.equal(
      details.detailed + details.neverFetched + details.invalidated,
      known,
    );
    assert.equal(
      streams.withData +
        streams.withoutData +
        streams.runnable +
        streams.waiting +
        streams.blocked +
        streams.failed,
      known,
    );
    assert.equal(
      photos.current + photos.refreshRequired + photos.unknown,
      photos.activitiesWithPhotos,
    );
    assert.ok(
      details.retryWaiting <= details.neverFetched + details.invalidated,
    );
    assert.ok(streams.chartSummaries <= streams.withData);
    // Unknown totals are never invented.
    if (status.history.progress !== 'complete')
      assert.equal(status.history.totalActivityCount, null);
  });
}

void test('the shared fixtures cover every scenario #297 asks clients to agree on', () => {
  assert.equal(fixtures.version, 1);
  assert.deepEqual(fixtures.scenarios.map((scenario) => scenario.id).sort(), [
    'account-credentials-rejected',
    'complete-with-no-gps-and-empty-streams',
    'details-waiting-after-failures',
    'expired-status-snapshot',
    'initial-import-unknown-total',
    'partial-import-with-detail-failures',
    'photo-only-staleness',
    'rate-limit-wait',
    'reconnected-after-rejection',
    'revoked-account',
    'scheduler-stalled-or-disabled',
  ]);
});

const NOW = new Date('2026-10-05T12:00:00.000Z');
const run = (overrides: Partial<BackgroundJobRun>): BackgroundJobRun => ({
  job: 'reconcile-strava-summaries',
  lastStartedAt: new Date(NOW.getTime() - 30 * 60_000),
  lastFinishedAt: new Date(NOW.getTime() - 29 * 60_000),
  lastStatus: 'completed',
  lastStopReason: null,
  lastCompletedAt: new Date(NOW.getTime() - 29 * 60_000),
  ...overrides,
});

void test('job heartbeats distinguish active, stalled, crashed, disabled and never observed', () => {
  const job = 'reconcile-strava-summaries';
  assert.equal(jobState(job, undefined, NOW), 'unknown');
  assert.equal(jobState(job, run({}), NOW), 'active');
  assert.equal(jobState(job, run({}), NOW, false), 'disabled');
  assert.equal(jobState(job, run({ lastStatus: 'disabled' }), NOW), 'disabled');
  // A failed run is still a running scheduler; the outcome reports the failure.
  assert.equal(jobState(job, run({ lastStatus: 'failed' }), NOW), 'active');
  // Two missed hourly runs plus grace is a stall.
  assert.equal(
    jobState(
      job,
      run({ lastStartedAt: new Date(NOW.getTime() - 2 * 3_600_000) }),
      NOW,
    ),
    'active',
  );
  assert.equal(
    jobState(
      job,
      run({ lastStartedAt: new Date(NOW.getTime() - 3 * 3_600_000) }),
      NOW,
    ),
    'stalled',
  );
  // Started and never finished: the worker crashed or timed out.
  assert.equal(
    jobState(
      job,
      run({
        lastStatus: 'running',
        lastStartedAt: new Date(NOW.getTime() - 10 * 60_000),
        lastFinishedAt: null,
      }),
      NOW,
    ),
    'stalled',
  );
  assert.equal(
    jobState(
      job,
      run({
        lastStatus: 'running',
        lastStartedAt: new Date(NOW.getTime() - 60_000),
        lastFinishedAt: null,
      }),
      NOW,
    ),
    'active',
  );
  // The detail sync runs hourly, like the other ingestion jobs.
  assert.equal(
    jobState(
      'sync-activities',
      run({ lastStartedAt: new Date(NOW.getTime() - 3_600_000) }),
      NOW,
    ),
    'active',
  );
  assert.equal(
    jobState(
      'sync-activities',
      run({ lastStartedAt: new Date(NOW.getTime() - 13 * 3_600_000) }),
      NOW,
    ),
    'stalled',
  );
});

void test('photo availability can be complete while verification is queued, waiting, or disabled', () => {
  const snapshot = revive(fixtures.scenarios[0]!.snapshot) as IngestionSnapshot;
  snapshot.account.connected = true;
  snapshot.photos = {
    activitiesWithPhotos: 183,
    activitiesWithStoredPhotos: 183,
    current: 0,
    refreshRequired: 183,
    unknown: 0,
    photoCount: 290,
    pendingRefreshes: 183,
    retryWaiting: 0,
  };
  snapshot.jobs['backfill-activity-photos'] = {
    job: 'backfill-activity-photos',
    lastStartedAt: snapshot.observedAt,
    lastFinishedAt: snapshot.observedAt,
    lastCompletedAt: snapshot.observedAt,
    lastStatus: 'completed',
    lastStopReason: null,
  };
  const options = { streamBackfillEnabled: false, photoBackfillEnabled: true };
  assert.equal(
    deriveIngestionStatus(snapshot, options).photos.progress,
    'complete',
  );
  assert.equal(
    deriveIngestionStatus(snapshot, options).photos.scheduling,
    'scheduled',
  );
  snapshot.photos.retryWaiting = 183;
  snapshot.photos.nextRetryAt = new Date(
    snapshot.observedAt.getTime() + 3_600_000,
  );
  assert.equal(
    deriveIngestionStatus(snapshot, options).photos.scheduling,
    'waiting',
  );
  assert.equal(
    deriveIngestionStatus(snapshot, options).photos.retryAt,
    snapshot.photos.nextRetryAt.toISOString(),
  );
  assert.equal(
    deriveIngestionStatus(snapshot, { ...options, photoBackfillEnabled: false })
      .photos.scheduling,
    'disabled',
  );
});

void test('photo credential rejection takes precedence over activity retries and clears after reconnect', () => {
  const snapshot = revive(fixtures.scenarios[0]!.snapshot) as IngestionSnapshot;
  snapshot.account.connected = true;
  snapshot.account.photoCredentialsBlocked = 'unauthorized';
  snapshot.photos.pendingRefreshes = 1;
  snapshot.photos.retryWaiting = 1;
  snapshot.photos.nextRetryAt = new Date(
    snapshot.observedAt.getTime() + 3_600_000,
  );
  const options = { streamBackfillEnabled: false, photoBackfillEnabled: true };
  const status = deriveIngestionStatus(snapshot, options).photos;
  assert.equal(status.scheduling, 'blocked');
  assert.equal(status.schedulingReason, 'unauthorized');
  assert.equal(status.retryAt, null);
  snapshot.account.photoCredentialsBlocked = null;
  assert.notEqual(
    deriveIngestionStatus(snapshot, options).photos.scheduling,
    'blocked',
  );
});
