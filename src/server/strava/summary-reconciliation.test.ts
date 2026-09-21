import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  SummaryReconciliationCandidate,
  SummaryReconciliationClaim,
  SummaryReconciliationRepository,
} from '~/server/repositories/summary-reconciliation.ts';
import type { Account } from '~/server/db/schema.ts';
import { StravaApiError } from './client.ts';
import {
  mergeSummaryActivity,
} from '~/server/repositories/summary-reconciliation.ts';
import type { StravaActivity } from './types.ts';
import { transformStravaActivity } from './transforms.ts';
import {
  reconcileStravaSummaries,
  type SummaryReconciliationSource,
} from './summary-reconciliation.ts';

const NOW = new Date('2026-09-20T12:00:00.000Z');
const ATHLETE_ID = 42;

function stravaActivity(
  id: number,
  overrides: Partial<StravaActivity> = {},
): StravaActivity {
  return {
    id,
    resource_state: 2,
    athlete: {
      id: ATHLETE_ID,
      resource_state: 1,
      firstname: 'Ada',
      lastname: 'Athlete',
      profile_medium: '',
      profile: '',
      city: '',
      state: '',
      country: '',
      sex: 'F',
      premium: false,
      summit: false,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    name: `Activity ${id}`,
    description: null,
    distance: 10_000,
    moving_time: 3_600,
    elapsed_time: 3_700,
    total_elevation_gain: 100,
    elev_high: 500,
    elev_low: 400,
    sport_type: 'Run',
    start_date: '2026-01-01T08:00:00Z',
    start_date_local: '2026-01-01T09:00:00Z',
    timezone: '(GMT+01:00) Europe/Zurich',
    start_latlng: [47, 8],
    end_latlng: [47.1, 8.1],
    achievement_count: 1,
    kudos_count: 2,
    comment_count: 3,
    athlete_count: 1,
    photo_count: 1,
    total_photo_count: 1,
    map: {
      id: `map-${id}`,
      polyline: 'detailed-polyline',
      summary_polyline: '_ibE_seK_seK_seK',
      resource_state: 2,
    },
    trainer: false,
    commute: false,
    manual: false,
    private: false,
    flagged: false,
    workout_type: null,
    upload_id: id + 1000,
    average_speed: 2.8,
    max_speed: 4.2,
    has_kudoed: false,
    hide_from_home: false,
    gear_id: null,
    kilojoules: null,
    average_watts: null,
    device_watts: false,
    max_watts: null,
    weighted_average_watts: null,
    calories: 500,
    device_name: null,
    pr_count: 0,
    ...overrides,
  };
}

void test('activity local time is deterministic across server timezones', () => {
  const transformed = transformStravaActivity(stravaActivity(1));

  assert.equal(
    transformed.start_date_local.toISOString(),
    '2026-01-01T09:00:00.000Z',
  );
});

void test('summary comparison invalidates only the affected component', () => {
  const detail = stravaActivity(1);
  const existing = {
    ...transformStravaActivity(detail, true, {
      photosCurrent: true,
      observedAt: new Date('2026-09-19T12:00:00Z'),
    }),
    athlete: ATHLETE_ID,
  };

  const engagementOnly = mergeSummaryActivity(
    existing,
    stravaActivity(1, { kudos_count: 99 }),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(engagementOnly.geometryState, 'detailed');
  assert.equal(engagementOnly.photosState, 'current');
  assert.equal(engagementOnly.map_polyline, 'detailed-polyline');

  const photoChange = mergeSummaryActivity(
    existing,
    stravaActivity(1, { photo_count: 2, total_photo_count: 2 }),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(photoChange.geometryState, 'detailed');
  assert.equal(photoChange.photosState, 'refresh_required');
  assert.equal(photoChange.is_complete, true);

  const metadataChange = mergeSummaryActivity(
    existing,
    stravaActivity(1, {
      distance: 11_000,
      moving_time: 3_700,
      elapsed_time: 3_900,
      total_elevation_gain: 120,
      start_date: '2026-01-01T10:00:00Z',
      start_date_local: '2026-01-01T11:00:00Z',
      start_latlng: [46.9, 7.9],
      end_latlng: [47.2, 8.2],
    }),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(metadataChange.geometryState, 'detailed');
  assert.equal(metadataChange.distance, 11_000);
  assert.equal(
    metadataChange.start_date_local.toISOString(),
    '2026-01-01T11:00:00.000Z',
  );
  assert.equal(metadataChange.map_polyline, 'detailed-polyline');

  const legacyTimestampEncoding = mergeSummaryActivity(
    {
      ...existing,
      geometryState: 'detailed',
      lastSummarySeenAt: null,
      lastDetailedFetchedAt: null,
      start_date_local: new Date('2026-01-01T08:00:00Z'),
      is_complete: true,
    },
    stravaActivity(1),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(legacyTimestampEncoding.geometryState, 'detailed');
  assert.equal(legacyTimestampEncoding.is_complete, true);
  assert.equal(
    legacyTimestampEncoding.start_date_local.toISOString(),
    '2026-01-01T09:00:00.000Z',
  );

  const geometryChange = mergeSummaryActivity(
    existing,
    stravaActivity(1, {
      map: { ...stravaActivity(1).map, id: 'changed-map' },
    }),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(geometryChange.geometryState, 'refresh_required');
  assert.equal(geometryChange.photosState, 'current');
  assert.equal(geometryChange.is_complete, false);
  assert.equal(geometryChange.map_polyline, 'detailed-polyline');

  const summaryPolylineChange = mergeSummaryActivity(
    existing,
    stravaActivity(1, {
      map: {
        ...stravaActivity(1).map,
        summary_polyline: '_ibE_seK_ibE_ibE',
      },
    }),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(summaryPolylineChange.geometryState, 'refresh_required');
  assert.equal(summaryPolylineChange.map_polyline, 'detailed-polyline');
});

function fakeRepository(): SummaryReconciliationRepository & {
  pageCalls: number[];
  releases: number;
  deletions: number[];
  confirmations: number[];
  beforeValues: number[];
} {
  const candidate: SummaryReconciliationCandidate = {
    userId: 'user-1',
    athleteId: ATHLETE_ID,
  };
  let phase: SummaryReconciliationClaim['phase'] = 'scanning';
  let nextPage = 1;
  let candidateAfterId: number | null = null;
  let completed = false;
  let leaseCounter = 0;

  const makeClaim = (): SummaryReconciliationClaim => ({
    ...candidate,
    scanStartedAt: NOW,
    scanBefore: Math.floor(NOW.getTime() / 1000) + 1,
    nextPage,
    phase,
    candidateAfterId,
    leaseToken: `lease-${++leaseCounter}`,
    leaseExpiresAt: new Date(NOW.getTime() + 600_000),
  });

  const repository = {
    pageCalls: [] as number[],
    releases: 0,
    deletions: [] as number[],
    confirmations: [] as number[],
    beforeValues: [] as number[],
    async listDue() {
      return completed ? [] : [candidate];
    },
    async claim() {
      return makeClaim();
    },
    async applySummaryPage(claim: SummaryReconciliationClaim, summaries: StravaActivity[], terminal: boolean) {
      repository.pageCalls.push(claim.nextPage);
      repository.beforeValues.push(claim.scanBefore);
      if (terminal) phase = 'confirming';
      else nextPage += 1;
      return { ...claim, phase, nextPage, candidateAfterId };
    },
    async listMissingCandidates(_claim: SummaryReconciliationClaim, limit: number) {
      return [2, 3].filter((id) => id > (candidateAfterId ?? 0)).slice(0, limit);
    },
    async confirmPresent(claim: SummaryReconciliationClaim, detail: StravaActivity) {
      repository.confirmations.push(detail.id);
      candidateAfterId = detail.id;
      return { ...claim, candidateAfterId };
    },
    async confirmMissing(claim: SummaryReconciliationClaim, activityId: number) {
      repository.deletions.push(activityId);
      candidateAfterId = activityId;
      return { ...claim, candidateAfterId };
    },
    async complete() {
      completed = true;
      return true;
    },
    async release() {
      repository.releases += 1;
    },
    async lastCompletedAt() {
      return completed ? NOW : null;
    },
  } satisfies SummaryReconciliationRepository & {
    pageCalls: number[];
    releases: number;
    deletions: number[];
    confirmations: number[];
    beforeValues: number[];
  };
  return repository;
}

void test('a bounded scan resumes with the same upper bound, confirms omissions, and completes only after confirmation', async () => {
  const repository = fakeRepository();
  const source: SummaryReconciliationSource = {
    async listPage({ page }) {
      return page === 1 ? [stravaActivity(1), stravaActivity(4)] : [];
    },
    async getActivity(id) {
      if (id === 2) throw new StravaApiError('Record Not Found', 404);
      return stravaActivity(id);
    },
  };
  const resolveAccount = async () => ({
    accessToken: 'token',
    access_token: 'token',
    revokedAt: null,
  }) as Account;

  const first = await reconcileStravaSummaries({
    now: NOW,
    pageSize: 2,
    pagesPerAthlete: 1,
    repository,
    resolveAccount,
    createSource: () => source,
  });
  assert.equal(first.partial, 1);
  assert.equal(first.completed, 0);
  assert.deepEqual(repository.pageCalls, [1]);

  const second = await reconcileStravaSummaries({
    now: NOW,
    pageSize: 2,
    pagesPerAthlete: 1,
    repository,
    resolveAccount,
    createSource: () => source,
  });
  assert.equal(second.completed, 1);
  assert.equal(second.deleted, 1);
  assert.equal(second.confirmedPresent, 1);
  assert.deepEqual(repository.pageCalls, [1, 2]);
  assert.equal(new Set(repository.beforeValues).size, 1);
  assert.deepEqual(repository.deletions, [2]);
  assert.deepEqual(repository.confirmations, [3]);
});

void test('a short non-empty Strava page does not terminate the scan', async () => {
  const repository = fakeRepository();
  const source: SummaryReconciliationSource = {
    async listPage({ page }) {
      return page === 1 ? [stravaActivity(1), stravaActivity(4)] : [];
    },
    async getActivity(id) {
      return stravaActivity(id);
    },
  };

  const result = await reconcileStravaSummaries({
    now: NOW,
    pageSize: 3,
    pagesPerAthlete: 3,
    repository,
    resolveAccount: async () => ({
      accessToken: 'token',
      access_token: 'token',
      revokedAt: null,
    }) as Account,
    createSource: () => source,
  });

  assert.equal(result.pages, 2);
  assert.equal(result.summaries, 2);
  assert.equal(result.completed, 1);
  assert.deepEqual(repository.pageCalls, [1, 2]);
});

void test('the invocation time budget checkpoints and releases partial work', async () => {
  const repository = fakeRepository();
  let currentTime = 0;
  const source: SummaryReconciliationSource = {
    async listPage() {
      currentTime = 45_000;
      return [stravaActivity(1), stravaActivity(4)];
    },
    async getActivity(id) {
      return stravaActivity(id);
    },
  };

  const result = await reconcileStravaSummaries({
    now: NOW,
    pageSize: 2,
    pagesPerAthlete: 3,
    timeBudgetMs: 45_000,
    clock: () => currentTime,
    repository,
    resolveAccount: async () => ({
      accessToken: 'token',
      access_token: 'token',
      revokedAt: null,
    }) as Account,
    createSource: () => source,
  });

  assert.equal(result.pages, 1);
  assert.equal(result.partial, 1);
  assert.equal(result.stoppedForTimeBudget, 1);
  assert.equal(result.stoppedForRateLimit, 0);
  assert.equal(result.elapsedMs, 45_000);
  assert.equal(repository.releases, 1);
});

void test('low Strava rate-limit headroom stops before another API request', async () => {
  const repository = fakeRepository();
  let rateLimitUsage: ReturnType<
    NonNullable<SummaryReconciliationSource['getRateLimitUsage']>
  > = null;
  let requests = 0;
  const source: SummaryReconciliationSource = {
    async listPage() {
      requests += 1;
      rateLimitUsage = {
        read: {
          limit15Minutes: 100,
          limitDaily: 1000,
          usage15Minutes: 75,
          usageDaily: 400,
        },
      };
      return [stravaActivity(1), stravaActivity(4)];
    },
    async getActivity(id) {
      return stravaActivity(id);
    },
    getRateLimitUsage: () => rateLimitUsage,
  };

  const result = await reconcileStravaSummaries({
    now: NOW,
    pageSize: 2,
    pagesPerAthlete: 3,
    repository,
    resolveAccount: async () => ({
      accessToken: 'token',
      access_token: 'token',
      revokedAt: null,
    }) as Account,
    createSource: () => source,
  });

  assert.equal(requests, 1);
  assert.equal(result.pages, 1);
  assert.equal(result.partial, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.stoppedForRateLimit, 1);
  assert.equal(repository.releases, 1);
});

void test('a Strava 429 preserves the checkpoint and yields without failing the cron', async () => {
  const repository = fakeRepository();
  const source: SummaryReconciliationSource = {
    async listPage() {
      return [];
    },
    async getActivity() {
      throw new StravaApiError('Rate Limit Exceeded', 429);
    },
  };
  const result = await reconcileStravaSummaries({
    now: NOW,
    repository,
    resolveAccount: async () => ({
      accessToken: 'token',
      access_token: 'token',
      revokedAt: null,
    }) as Account,
    createSource: () => source,
  });
  assert.equal(result.failed, 0);
  assert.equal(result.completed, 0);
  assert.equal(result.partial, 1);
  assert.equal(result.stoppedForRateLimit, 1);
  assert.equal(repository.releases, 1);
  assert.deepEqual(repository.deletions, []);
});
