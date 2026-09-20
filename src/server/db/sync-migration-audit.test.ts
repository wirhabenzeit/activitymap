import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRetireGeometryFallback,
  formatSyncMigrationAudit,
  type SyncMigrationAudit,
} from './sync-migration-audit.ts';

const READY_AUDIT: SyncMigrationAudit = {
  activities: {
    geometryStateMissing: 0,
    lastSummarySeenMissing: 0,
    legacyDetailedFallbacks: 0,
    legacySummaryFallbacks: 0,
    total: 12,
  },
  athletes: {
    connected: 2,
    neverReconciled: 0,
    staleOverSevenDays: 0,
  },
  reconciliationsInProgress: 0,
};

void test('geometry fallback retirement requires complete component-state coverage', () => {
  assert.equal(canRetireGeometryFallback(READY_AUDIT), true);
  assert.equal(
    canRetireGeometryFallback({
      ...READY_AUDIT,
      activities: { ...READY_AUDIT.activities, geometryStateMissing: 1 },
    }),
    false,
  );
});

void test('audit output is aggregate-only and states the retirement decision', () => {
  const output = formatSyncMigrationAudit(READY_AUDIT);

  assert.match(output, /\| Activities \| 12 \|/);
  assert.match(output, /Ready to retire the DTO geometry fallback:\*\* yes/);
});
