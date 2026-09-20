import assert from 'node:assert/strict';
import test from 'node:test';

import { UserNotFoundError } from '~/server/db/internal';

import {
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_WEBHOOK_ATTEMPTS,
  PermanentWebhookError,
  classifyWebhookError,
  computeRetryDecision,
  sortByDrainPriority,
  webhookDrainPriorityRank,
} from './webhook-retry.ts';

void test('classifyWebhookError treats PermanentWebhookError and UserNotFoundError as permanent', () => {
  assert.equal(classifyWebhookError(new PermanentWebhookError('nope')), 'permanent');
  assert.equal(classifyWebhookError(new UserNotFoundError()), 'permanent');
});

void test('classifyWebhookError defaults everything else to retryable', () => {
  assert.equal(classifyWebhookError(new Error('ECONNRESET')), 'retryable');
  assert.equal(classifyWebhookError(new TypeError('fetch failed')), 'retryable');
  assert.equal(classifyWebhookError('a thrown string'), 'retryable');
  assert.equal(classifyWebhookError(undefined), 'retryable');
});

void test('computeRetryDecision backs off exponentially and stays retryable below the attempt cap', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  const first = computeRetryDecision({ attemptCount: 0, classification: 'retryable', now });
  assert.equal(first.status, 'failed');
  assert.equal(first.attemptCount, 1);
  assert.equal(first.nextAttemptAt.getTime() - now.getTime(), INITIAL_BACKOFF_MS);

  const second = computeRetryDecision({ attemptCount: 1, classification: 'retryable', now });
  assert.equal(second.status, 'failed');
  assert.equal(second.attemptCount, 2);
  assert.equal(second.nextAttemptAt.getTime() - now.getTime(), INITIAL_BACKOFF_MS * 2);

  const third = computeRetryDecision({ attemptCount: 2, classification: 'retryable', now });
  assert.equal(third.nextAttemptAt.getTime() - now.getTime(), INITIAL_BACKOFF_MS * 4);
});

void test('computeRetryDecision caps backoff at MAX_BACKOFF_MS before the attempt cap dead-letters it', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  // attemptCount 8 -> the 9th attempt: doubling from INITIAL_BACKOFF_MS
  // would exceed MAX_BACKOFF_MS here, so it must be capped instead of
  // growing further - and it must still be one attempt short of
  // MAX_WEBHOOK_ATTEMPTS, so it stays retryable rather than dead-lettering.
  const decision = computeRetryDecision({ attemptCount: 8, classification: 'retryable', now });
  assert.equal(decision.status, 'failed');
  assert.equal(decision.attemptCount, 9);
  assert.ok(decision.attemptCount < MAX_WEBHOOK_ATTEMPTS);
  assert.equal(decision.nextAttemptAt.getTime() - now.getTime(), MAX_BACKOFF_MS);
});

void test('computeRetryDecision dead-letters a retryable failure once MAX_WEBHOOK_ATTEMPTS is reached', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const decision = computeRetryDecision({
    attemptCount: MAX_WEBHOOK_ATTEMPTS - 1,
    classification: 'retryable',
    now,
  });
  assert.equal(decision.status, 'dead_letter');
  assert.equal(decision.attemptCount, MAX_WEBHOOK_ATTEMPTS);
  // Dead-lettered rows are excluded from the drain query regardless of
  // `nextAttemptAt`, so it does not need a future value - "now" is fine.
  assert.equal(decision.nextAttemptAt.getTime(), now.getTime());
});

void test('computeRetryDecision dead-letters a permanent failure immediately, even on the very first attempt', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const decision = computeRetryDecision({ attemptCount: 0, classification: 'permanent', now });
  assert.equal(decision.status, 'dead_letter');
  assert.equal(decision.attemptCount, 1);
});

void test('webhookDrainPriorityRank ranks deletions and athlete events ahead of routine create/update events', () => {
  assert.equal(webhookDrainPriorityRank({ objectType: 'activity', aspectType: 'delete' }), 0);
  assert.equal(webhookDrainPriorityRank({ objectType: 'athlete', aspectType: 'update' }), 0);
  assert.equal(webhookDrainPriorityRank({ objectType: 'activity', aspectType: 'create' }), 1);
  assert.equal(webhookDrainPriorityRank({ objectType: 'activity', aspectType: 'update' }), 1);
});

void test('sortByDrainPriority orders deletion/deauthorization events ahead of routine events, oldest-first within each rank', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  const routineOld = { id: 'routine-old', objectType: 'activity', aspectType: 'update', nextAttemptAt: minutesAgo(60) };
  const routineNew = { id: 'routine-new', objectType: 'activity', aspectType: 'create', nextAttemptAt: minutesAgo(1) };
  const deletionNew = { id: 'deletion-new', objectType: 'activity', aspectType: 'delete', nextAttemptAt: minutesAgo(1) };
  const deauthOld = { id: 'deauth-old', objectType: 'athlete', aspectType: 'update', nextAttemptAt: minutesAgo(30) };

  // Deliberately out-of-priority input order, including a much older
  // routine event than either priority event - a naive oldest-first-only
  // (FIFO) ordering would put `routineOld` first, which this must not do.
  const sorted = sortByDrainPriority([routineOld, routineNew, deletionNew, deauthOld]);

  assert.deepEqual(
    sorted.map((e) => e.id),
    // Priority events first (oldest of the two priority events first),
    // then routine events (oldest first).
    ['deauth-old', 'deletion-new', 'routine-old', 'routine-new'],
  );
});
