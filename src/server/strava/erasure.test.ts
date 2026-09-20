import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  DueErasureCandidate,
  ErasureOutcome,
  ErasureRepository,
} from '~/server/repositories/erasure.ts';
import {
  MAX_ERASURE_BATCH_SIZE,
  eraseDueRevokedAthletes,
} from './erasure.ts';

const NOW = new Date('2026-09-20T12:00:00.000Z');

function candidate(index: number): DueErasureCandidate {
  return {
    accountId: `account-${index}`,
    userId: `user-${index}`,
    scheduledErasureAt: new Date(NOW.getTime() - index * 1_000),
  };
}

function fakeRepository({
  candidates,
  outcomes,
}: {
  candidates: DueErasureCandidate[];
  outcomes: Map<string, ErasureOutcome | Error>;
}): ErasureRepository & { requestedLimit: number | null; maxInFlight: number } {
  let inFlight = 0;
  const repository = {
    requestedLimit: null as number | null,
    maxInFlight: 0,
    async listDue(limit: number) {
      repository.requestedLimit = limit;
      return candidates.slice(0, limit);
    },
    async erase(due: DueErasureCandidate) {
      inFlight += 1;
      repository.maxInFlight = Math.max(repository.maxInFlight, inFlight);
      try {
        const outcome = outcomes.get(due.accountId) ?? 'erased';
        if (outcome instanceof Error) throw outcome;
        return outcome;
      } finally {
        inFlight -= 1;
      }
    },
  } satisfies ErasureRepository & {
    requestedLimit: number | null;
    maxInFlight: number;
  };
  return repository;
}

void test('eraseDueRevokedAthletes processes a bounded batch sequentially and counts outcomes', async () => {
  const candidates = [candidate(1), candidate(2), candidate(3), candidate(4)];
  const repository = fakeRepository({
    candidates,
    outcomes: new Map<string, ErasureOutcome | Error>([
      ['account-1', 'erased'],
      ['account-2', 'cancelled'],
      ['account-3', 'stale'],
    ]),
  });

  const result = await eraseDueRevokedAthletes({
    batchSize: 3,
    now: NOW,
    repository,
  });

  assert.deepEqual(result, {
    candidates: 3,
    erased: 1,
    cancelled: 1,
    stale: 1,
    failed: 0,
  });
  assert.equal(repository.requestedLimit, 3);
  assert.equal(repository.maxInFlight, 1);
});

void test('eraseDueRevokedAthletes continues after one athlete fails so another due erasure is not starved', async () => {
  const repository = fakeRepository({
    candidates: [candidate(1), candidate(2)],
    outcomes: new Map<string, ErasureOutcome | Error>([
      ['account-1', new Error('simulated database failure')],
      ['account-2', 'erased'],
    ]),
  });

  assert.deepEqual(
    await eraseDueRevokedAthletes({ now: NOW, repository }),
    {
      candidates: 2,
      erased: 1,
      cancelled: 0,
      stale: 0,
      failed: 1,
    },
  );
});

void test('eraseDueRevokedAthletes rejects an unbounded or invalid batch size', async () => {
  const repository = fakeRepository({ candidates: [], outcomes: new Map() });
  for (const batchSize of [0, -1, 1.5, MAX_ERASURE_BATCH_SIZE + 1]) {
    await assert.rejects(
      eraseDueRevokedAthletes({ batchSize, now: NOW, repository }),
      RangeError,
    );
  }
});
