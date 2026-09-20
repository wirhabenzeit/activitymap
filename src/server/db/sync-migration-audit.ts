export interface SyncMigrationAudit {
  activities: {
    geometryStateMissing: number;
    lastSummarySeenMissing: number;
    legacyDetailedFallbacks: number;
    legacySummaryFallbacks: number;
    total: number;
  };
  athletes: {
    connected: number;
    neverReconciled: number;
    staleOverSevenDays: number;
  };
  reconciliationsInProgress: number;
}

export function canRetireGeometryFallback(audit: SyncMigrationAudit): boolean {
  return audit.activities.geometryStateMissing === 0;
}

export function formatSyncMigrationAudit(audit: SyncMigrationAudit): string {
  const ready = canRetireGeometryFallback(audit);
  return [
    '### v1 sync migration audit',
    '',
    '| Check | Count |',
    '| --- | ---: |',
    `| Activities | ${audit.activities.total} |`,
    `| Missing geometry state | ${audit.activities.geometryStateMissing} |`,
    `| Legacy detailed fallbacks | ${audit.activities.legacyDetailedFallbacks} |`,
    `| Legacy summary fallbacks | ${audit.activities.legacySummaryFallbacks} |`,
    `| Missing last-summary timestamp | ${audit.activities.lastSummarySeenMissing} |`,
    `| Connected athletes | ${audit.athletes.connected} |`,
    `| Connected athletes never reconciled | ${audit.athletes.neverReconciled} |`,
    `| Connected athletes stale over seven days | ${audit.athletes.staleOverSevenDays} |`,
    `| Reconciliations in progress | ${audit.reconciliationsInProgress} |`,
    '',
    `**Ready to retire the DTO geometry fallback:** ${ready ? 'yes' : 'no'}`,
  ].join('\n');
}
