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

  const geometryChange = mergeSummaryActivity(
    existing,
    stravaActivity(1, { distance: 11_000 }),
    ATHLETE_ID,
    NOW,
  );
  assert.equal(geometryChange.geometryState, 'refresh_required');
  assert.equal(geometryChange.photosState, 'current');
  assert.equal(geometryChange.is_complete, false);
  assert.equal(geometryChange.map_polyline, 'detailed-polyline');
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

void test('a transient confirmation failure preserves the checkpoint for a later run', async () => {
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
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 0);
  assert.equal(repository.releases, 1);
  assert.deepEqual(repository.deletions, []);
});
