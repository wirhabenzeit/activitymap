import type {
  IngestionProgress,
  IngestionScheduling,
  IngestionReason,
  IngestionStatusDTO,
  IngestionRunOutcomeDTO,
} from '~/contracts/v1/ingestion-status';

const progress: Record<IngestionProgress, string> = {
  not_started: 'Not started',
  in_progress: 'Partially available',
  complete: 'Covered',
  unknown: 'Unknown',
};
const scheduling: Record<IngestionScheduling, string> = {
  idle: 'No work pending',
  scheduled: 'Automatic processing scheduled',
  waiting: 'Waiting to retry',
  blocked: 'Reconnect Strava to continue',
  disabled: 'Background processing is disabled on the server',
  stalled:
    'Background processing has stopped reporting; contact support if this continues',
  not_scheduled: 'No automatic refresh is scheduled',
  unknown: 'No background run has been recorded',
};
const reasons: Record<IngestionReason, string> = {
  rate_limited:
    'Strava request limit reached; processing will resume on a later run',
  time_budget: 'More work remains for the next scheduled run',
  credentials_unavailable: 'Reconnect Strava to continue',
  unauthorized: 'Strava rejected the connection; reconnect Strava',
  upstream_error: 'Strava could not be reached',
  invalid_response: 'Strava returned data that could not be read',
  detail_failures:
    'Some activity details could not be fetched and will be retried',
  photo_refresh_failed: 'Photo metadata could not be refreshed',
  history_fetch_failed: 'Activity history could not be fetched',
  persistence_failed: 'The server could not save the update',
  internal_error: 'The server could not finish processing',
};
export type CoverageRow = {
  title: string;
  coverage: string;
  counts: string;
  schedule: string;
  reason: string | null;
  retryAt: string | null;
  outcome: IngestionRunOutcomeDTO | null;
};

export function coverageRows(status: IngestionStatusDTO): CoverageRow[] {
  const { history: h, details: d, streams: s, photos: p } = status;
  const row = (
    title: string,
    state: typeof p | typeof h | typeof d | typeof s,
    counts: string,
  ): CoverageRow => ({
    title,
    coverage: progress[state.progress],
    counts,
    schedule: scheduling[state.scheduling],
    reason: state.schedulingReason ? reasons[state.schedulingReason] : null,
    retryAt: state.retryAt,
    outcome: 'lastOutcome' in state ? state.lastOutcome : null,
  });
  return [
    row(
      'Activity history',
      h,
      h.totalActivityCount === null
        ? `${h.knownActivityCount} activities imported · Strava total not yet known`
        : `${h.knownActivityCount} activities imported · full history discovered`,
    ),
    row(
      'Activity details',
      d,
      `${d.detailed} fetched · ${d.neverFetched} awaiting first fetch · ${d.invalidated} awaiting refresh · ${d.retryWaiting} of these waiting to retry`,
    ),
    {
      ...row(
        'Streams & charts',
        s,
        `${s.withData} with data · ${s.withoutData} with no sensor data · ${s.runnable} queued · ${s.waiting} waiting · ${s.blocked} blocked · ${s.failed} failed. ${s.chartSummaries} chart summaries available.`,
      ),
      coverage: s.failed > 0 ? 'Needs attention' : progress[s.progress],
    },
    row(
      'Photo metadata',
      p,
      `${p.current} of ${p.activitiesWithPhotos} activities with photos checked · ${p.refreshRequired} awaiting refresh · ${p.unknown} not checked. ${p.photoCount} photo records; image downloads are separate.`,
    ),
  ];
}
export function outcomeText(outcome: IngestionRunOutcomeDTO): string {
  const labels = {
    succeeded: 'Last run succeeded',
    partial: 'Last run partly succeeded',
    deferred: 'Last run deferred',
    failed: 'Last run failed',
    blocked: 'Last run blocked',
  };
  return `${labels[outcome.outcome]}${outcome.reason ? `: ${reasons[outcome.reason]}` : ''}`;
}
export const snapshotIsStale = (observedAt: string, now: number) =>
  now - Date.parse(observedAt) >= 120_000;

export function coverageProgress(completed: number | undefined, total: number) {
  if (completed === undefined || total <= 0) return null;
  const value = Math.max(0, Math.min(completed, total));
  // Don't round incomplete work up to 100%.
  return { value, total, percent: Math.floor((value / total) * 1000) / 10 };
}

type PipelineState = IngestionStatusDTO[
  'history' | 'details' | 'streams' | 'photos'];

/** What a pipeline's scheduler is doing, as one or two words. */
export function schedulingLabel(state: PipelineState) {
  if (state.scheduling === 'blocked') return 'Reconnect';
  if (state.scheduling === 'disabled') return 'Paused';
  if (state.scheduling === 'stalled') return 'Needs attention';
  if (state.scheduling === 'unknown') return 'Schedule unknown';
  if (state.scheduling === 'waiting') return 'Waiting';
  if (state.scheduling === 'not_scheduled') return 'Refresh pending';
  if (
    state.scheduling === 'scheduled' &&
    'lastOutcome' in state &&
    state.lastOutcome?.outcome === 'deferred' &&
    state.lastOutcome.reason === 'rate_limited'
  )
    return 'Waiting';
  if (state.scheduling === 'scheduled')
    return state.progress === 'complete'
      ? 'Checking'
      : state.progress === 'not_started'
        ? 'Queued'
        : 'Importing';
  return state.progress === 'complete'
    ? 'Ready'
    : state.progress === 'unknown'
      ? 'Unknown'
      : 'Not started';
}

/** Short summaries for the main screen; the full read model stays in disclosures. */
export function coverageSummaries(status: IngestionStatusDTO) {
  const { history: h, details: d, streams: s, photos: p } = status;
  return [
    {
      title: 'History',
      count: `${h.knownActivityCount.toLocaleString()} imported${h.totalActivityCount === null ? ' · total unknown' : ''}`,
      status: schedulingLabel(h),
      progress: null,
    },
    {
      title: 'Details',
      count: `${d.detailed.toLocaleString()} of ${h.knownActivityCount.toLocaleString()} ready`,
      status: schedulingLabel(d),
      progress: coverageProgress(d.detailed, h.knownActivityCount),
    },
    {
      title: 'Streams',
      count: `${(s.withData + s.withoutData).toLocaleString()} of ${h.knownActivityCount.toLocaleString()} checked`,
      status: s.failed > 0 ? 'Needs attention' : schedulingLabel(s),
      progress: coverageProgress(
        s.withData + s.withoutData,
        h.knownActivityCount,
      ),
    },
    {
      title: 'Photos',
      count:
        p.activitiesWithPhotos === 0
          ? 'No photos reported'
          : p.activitiesWithStoredPhotos === undefined
            ? 'Photo availability not reported by this server'
            : `${p.activitiesWithStoredPhotos.toLocaleString()} of ${p.activitiesWithPhotos.toLocaleString()} activities have photos available`,
      status: schedulingLabel(p),
      progress: coverageProgress(
        p.activitiesWithStoredPhotos,
        p.activitiesWithPhotos,
      ),
    },
  ];
}
