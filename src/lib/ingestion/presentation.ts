import type {
  IngestionProgress,
  IngestionReason,
  IngestionRunOutcomeDTO,
  IngestionScheduling,
  IngestionStatusDTO,
} from '~/contracts/v1/ingestion-status';
import { message } from '~/lib/presentation/messages';

const progress: Record<IngestionProgress, string> = {
  not_started: message('status.progress.notStarted'),
  in_progress: message('status.progress.inProgress'),
  complete: message('status.progress.complete'),
  unknown: message('status.progress.unknown'),
};
const scheduling: Record<IngestionScheduling, string> = {
  idle: message('status.scheduling.idle'),
  scheduled: message('status.scheduling.scheduled'),
  waiting: message('status.scheduling.waiting'),
  blocked: message('status.scheduling.blocked'),
  disabled: message('status.scheduling.disabled'),
  stalled: message('status.scheduling.stalled'),
  not_scheduled: message('status.scheduling.notScheduled'),
  unknown: message('status.scheduling.unknown'),
};
const reasons: Record<IngestionReason, string> = {
  rate_limited: message('status.reason.rateLimited'),
  time_budget: message('status.reason.timeBudget'),
  credentials_unavailable: message('status.scheduling.blocked'),
  unauthorized: message('status.reason.unauthorized'),
  upstream_error: message('status.reason.upstreamError'),
  invalid_response: message('status.reason.invalidResponse'),
  detail_failures: message('status.reason.detailFailures'),
  photo_refresh_failed: message('status.reason.photoRefreshFailed'),
  history_fetch_failed: message('status.reason.historyFetchFailed'),
  persistence_failed: message('status.reason.persistenceFailed'),
  internal_error: message('status.reason.internalError'),
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

export function coverageRows(
  status: IngestionStatusDTO,
  locale?: string,
): CoverageRow[] {
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
      message('status.pipeline.history', undefined, locale),
      h,
      h.totalActivityCount === null
        ? message(
            'status.historyUnknown',
            { count: h.knownActivityCount },
            locale,
          )
        : message(
            'status.historyComplete',
            { count: h.knownActivityCount },
            locale,
          ),
    ),
    row(
      message('status.pipeline.details', undefined, locale),
      d,
      message(
        'status.detailsCounts',
        {
          fetched: d.detailed,
          awaiting: d.neverFetched,
          invalidated: d.invalidated,
          retrying: d.retryWaiting,
        },
        locale,
      ),
    ),
    {
      ...row(
        message('status.pipeline.streams', undefined, locale),
        s,
        message(
          'status.streamsCounts',
          {
            withData: s.withData,
            withoutData: s.withoutData,
            queued: s.runnable,
            waiting: s.waiting,
            blocked: s.blocked,
            failed: s.failed,
            summaries: s.chartSummaries,
          },
          locale,
        ),
      ),
      coverage:
        s.failed > 0
          ? message('status.compact.needsAttention', undefined, locale)
          : progress[s.progress],
    },
    row(
      message('status.pipeline.photos', undefined, locale),
      p,
      message(
        'status.photosCounts',
        {
          current: p.current,
          total: p.activitiesWithPhotos,
          refresh: p.refreshRequired,
          unknown: p.unknown,
          photos: p.photoCount,
        },
        locale,
      ),
    ),
  ];
}
export function outcomeText(
  outcome: IngestionRunOutcomeDTO,
  locale?: string,
): string {
  const labels = {
    succeeded: message('status.outcome.succeeded', undefined, locale),
    partial: message('status.outcome.partial', undefined, locale),
    deferred: message('status.outcome.deferred', undefined, locale),
    failed: message('status.outcome.failed', undefined, locale),
    blocked: message('status.outcome.blocked', undefined, locale),
  };
  return outcome.reason
    ? message(
        'status.outcome.withReason',
        {
          outcome: labels[outcome.outcome],
          reason: reasons[outcome.reason],
        },
        locale,
      )
    : labels[outcome.outcome];
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
  if (state.scheduling === 'blocked')
    return message('status.compact.reconnect');
  if (state.scheduling === 'disabled') return message('status.compact.paused');
  if (state.scheduling === 'stalled')
    return message('status.compact.needsAttention');
  if (state.scheduling === 'unknown')
    return message('status.compact.scheduleUnknown');
  if (state.scheduling === 'waiting') return message('status.compact.waiting');
  if (state.scheduling === 'not_scheduled')
    return message('status.compact.refreshPending');
  if (
    state.scheduling === 'scheduled' &&
    'lastOutcome' in state &&
    state.lastOutcome?.outcome === 'deferred' &&
    state.lastOutcome.reason === 'rate_limited'
  )
    return message('status.compact.waiting');
  if (state.scheduling === 'scheduled')
    return state.progress === 'complete'
      ? message('status.compact.checking')
      : state.progress === 'not_started'
        ? message('status.compact.queued')
        : message('status.compact.importing');
  return state.progress === 'complete'
    ? message('status.compact.ready')
    : state.progress === 'unknown'
      ? message('status.progress.unknown')
      : message('status.progress.notStarted');
}

/** Short summaries for the main screen; the full read model stays in disclosures. */
export function coverageSummaries(status: IngestionStatusDTO, locale?: string) {
  const { history: h, details: d, streams: s, photos: p } = status;
  return [
    {
      title: message('status.summary.history', undefined, locale),
      count: message(
        h.totalActivityCount === null
          ? 'status.historySummaryUnknown'
          : 'status.historySummary',
        { count: h.knownActivityCount },
        locale,
      ),
      status: schedulingLabel(h),
      progress: null,
    },
    {
      title: message('status.summary.details', undefined, locale),
      count: message(
        'status.detailsSummary',
        {
          count: d.detailed,
          total: h.knownActivityCount,
        },
        locale,
      ),
      status: schedulingLabel(d),
      progress: coverageProgress(d.detailed, h.knownActivityCount),
    },
    {
      title: message('status.summary.streams', undefined, locale),
      count: message(
        'status.streamsSummary',
        {
          count: s.withData + s.withoutData,
          total: h.knownActivityCount,
        },
        locale,
      ),
      status:
        s.failed > 0
          ? message('status.compact.needsAttention', undefined, locale)
          : schedulingLabel(s),
      progress: coverageProgress(
        s.withData + s.withoutData,
        h.knownActivityCount,
      ),
    },
    {
      title: message('status.summary.photos', undefined, locale),
      count:
        p.activitiesWithPhotos === 0
          ? message('status.noPhotos', undefined, locale)
          : p.activitiesWithStoredPhotos === undefined
            ? message('status.photosUnknown', undefined, locale)
            : message(
                'status.photosSummary',
                {
                  count: p.activitiesWithStoredPhotos,
                  total: p.activitiesWithPhotos,
                },
                locale,
              ),
      status: schedulingLabel(p),
      progress: coverageProgress(
        p.activitiesWithStoredPhotos,
        p.activitiesWithPhotos,
      ),
    },
  ];
}
