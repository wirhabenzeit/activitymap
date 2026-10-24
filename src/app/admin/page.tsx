import type { Metadata } from 'next';
import Link from 'next/link';

import { type JobHealth, jobHealth } from '~/lib/admin/job-health';
import { type RunFailure, runFailures } from '~/lib/admin/job-run-summary';
import {
  coverageProgress,
  coverageSummaries,
  schedulingLabel,
} from '~/lib/ingestion/presentation';
import { cn } from '~/lib/utils';
import {
  type ActivityFailure,
  type AdminDashboard,
  loadAdminDashboard,
} from '~/server/application/admin-dashboard';
import { requireAdmin } from '~/server/auth/admin';

/**
 * Read-only operations dashboard (issue #328): scheduled job health and run
 * history, the webhook inbox, per-athlete import coverage and the shared
 * Strava request budget. Outside the `(app)` group, like `/share`, so it has
 * no app chrome. Only athletes listed in `ACTIVITYMAP_ADMIN_ATHLETE_IDS` get
 * past `requireAdmin()`; everyone else gets the ordinary 404.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Admin · ActivityMap',
  robots: { index: false, follow: false, nocache: true },
};

const HEALTH: Record<JobHealth, { label: string; tone: Tone }> = {
  ok: { label: 'OK', tone: 'good' },
  late: { label: 'Late', tone: 'warn' },
  failing: { label: 'Failing', tone: 'bad' },
  disabled: { label: 'Paused', tone: 'muted' },
  no_runs: { label: 'No runs logged', tone: 'warn' },
  unscheduled: { label: 'Not scheduled', tone: 'muted' },
};

type Tone = 'good' | 'warn' | 'bad' | 'muted';

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'good' &&
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        tone === 'warn' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
        tone === 'bad' && 'bg-red-500/15 text-red-700 dark:text-red-300',
        tone === 'muted' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

const utc = (date: Date | null | undefined) =>
  date ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';

function ago(date: Date | null | undefined, now: Date) {
  if (!date) return 'never';
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const duration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">{children}</div>
    </section>
  );
}

const th = 'px-3 py-2 text-left font-medium text-muted-foreground';
const td = 'px-3 py-2 align-top';

type Run = AdminDashboard['runs'][number];

const PIPELINE_JOB: Record<ActivityFailure['pipeline'], string> = {
  details: 'sync-activities',
  streams: 'backfill-activity-streams',
  photos: 'backfill-activity-photos',
};

/** Activities a completed run failed on, from its numeric summary. */
function itemFailures(run: Run) {
  const summary = run.summary ?? {};
  const count = (key: string) =>
    typeof summary[key] === 'number' ? summary[key] : 0;
  return Math.max(
    count('failed'),
    count('failedDetails'),
    runFailures(run.summary).length,
  );
}

/** The newest logged cause per `job:activityId`. */
function latestCauses(runs: readonly Run[]) {
  const causes = new Map<string, { failure: RunFailure; at: Date }>();
  for (const run of [...runs].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  ))
    for (const failure of runFailures(run.summary)) {
      const key = `${run.job}:${failure.activityId}`;
      if (!causes.has(key)) causes.set(key, { failure, at: run.startedAt });
    }
  return causes;
}

const stravaActivity = (id: string) =>
  `https://www.strava.com/activities/${id}`;

function RunDetails({ run }: { run: Run }) {
  if (run.error)
    return <span className="text-red-700 dark:text-red-300">{run.error}</span>;
  const failures = runFailures(run.summary);
  const counts = Object.entries(run.summary ?? {})
    .flatMap(([key, value]) =>
      Array.isArray(value) ? [] : [`${key}=${String(value)}`],
    )
    .join(' ');
  return (
    <div className="space-y-1">
      <span className="font-mono text-muted-foreground">{counts}</span>
      {failures.length > 0 && (
        <ul className="space-y-0.5">
          {failures.map((failure) => (
            <li
              key={failure.activityId}
              className="text-amber-700 dark:text-amber-300"
            >
              <a
                href={stravaActivity(failure.activityId)}
                className="font-mono underline"
                target="_blank"
                rel="noreferrer"
              >
                {failure.activityId}
              </a>{' '}
              <span className="font-medium">{failure.code}</span> ·{' '}
              {failure.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ failures?: string }>;
}) {
  await requireAdmin();
  const { failures } = await searchParams;
  const onlyFailures = failures === '1';
  const data = await loadAdminDashboard();
  const now = data.observedAt;
  const health = jobHealth(data.runs, now);
  const runs = onlyFailures ? data.problemRuns : data.runs;
  const counts = data.inbox.countsByStatus;
  const causes = latestCauses([...data.problemRuns, ...data.runs]);
  const failingByAthlete = new Map<string, ActivityFailure[]>();
  for (const failure of data.activityFailures) {
    const key = `${failure.athleteId}:${failure.pipeline}`;
    failingByAthlete.set(key, [...(failingByAthlete.get(key) ?? []), failure]);
  }
  const itemFailuresByJob = new Map<string, number>();
  for (const run of data.runs)
    itemFailuresByJob.set(
      run.job,
      (itemFailuresByJob.get(run.job) ?? 0) + itemFailures(run),
    );
  const matchingByUser = new Map(
    data.matching.coverage.map((row) => [row.userId, row]),
  );
  const matchingTotals = data.matching.coverage.reduce(
    (totals, row) => ({
      checked: totals.checked + row.checked,
      limited: totals.limited + row.limited,
      eligible: totals.eligible + row.eligible,
      pending: totals.pending + row.pending,
      retryWaiting: totals.retryWaiting + row.retryWaiting,
      failed: totals.failed + row.failed,
      waitingForStreams: totals.waitingForStreams + row.waitingForStreams,
    }),
    {
      checked: 0,
      limited: 0,
      eligible: 0,
      pending: 0,
      retryWaiting: 0,
      failed: 0,
      waitingForStreams: 0,
    },
  );
  const matchingRun = data.runs.find(
    (run) => run.job === 'match-activity-places',
  );
  const matchingMetric = (key: string) => {
    const value = matchingRun?.summary?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const saved = matchingMetric('saved');
  const elapsed = matchingMetric('elapsedMs');

  return (
    <main className="mx-auto max-w-6xl space-y-8 bg-background px-4 py-6 text-foreground">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ActivityMap admin</h1>
          <p className="text-sm text-muted-foreground">
            Observed {utc(now)} · stream backfill{' '}
            {data.switches.streamBackfillEnabled ? 'on' : 'off'} · photo
            catch-up {data.switches.photoBackfillEnabled ? 'on' : 'off'}
          </p>
        </div>
        <Link
          href={onlyFailures ? '/admin?failures=1' : '/admin'}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Refresh
        </Link>
      </header>

      <Section
        title="Place matching"
        description="Current checks for connected accounts. Empty encounter results count as checked; limited checks have partial, missing-GPS or uncovered routes. Counts update when you refresh."
      >
        <div className="space-y-4 p-4 text-sm">
          {!data.matching.available && (
            <Badge tone="warn">Waiting for a published place catalogue</Badge>
          )}
          {data.matching.available && (
            <Badge
              tone={
                matchingTotals.pending || matchingTotals.retryWaiting
                  ? 'warn'
                  : matchingTotals.eligible
                    ? 'good'
                    : 'muted'
              }
            >
              {matchingTotals.pending || matchingTotals.retryWaiting
                ? 'Work pending'
                : matchingTotals.eligible
                  ? 'Eligible activities caught up'
                  : 'No current streams to match'}
            </Badge>
          )}
          <dl className="grid grid-cols-2 gap-4 tabular-nums sm:grid-cols-4">
            {[
              [
                'Checked',
                `${matchingTotals.checked.toLocaleString()} / ${matchingTotals.eligible.toLocaleString()}`,
              ],
              ['Queued', matchingTotals.pending.toLocaleString()],
              [
                'Waiting to retry',
                matchingTotals.retryWaiting.toLocaleString(),
              ],
              [
                'Waiting for streams',
                matchingTotals.waitingForStreams.toLocaleString(),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            {matchingTotals.limited.toLocaleString()} limited checks ·{' '}
            {matchingTotals.failed.toLocaleString()} outstanding failed checks
            {matchingTotals.failed > 0 &&
              ' (included in queued or waiting to retry)'}
          </p>
          {matchingRun ? (
            <div className="space-y-2 border-t pt-3">
              <p>
                Last run {ago(matchingRun.startedAt, now)} ·{' '}
                {matchingRun.status} ·{' '}
                {saved === null
                  ? 'saved count unavailable'
                  : `${saved.toLocaleString()} saved`}{' '}
                in {duration(matchingRun.durationMs)}
                {saved !== null &&
                  elapsed !== null &&
                  elapsed > 0 &&
                  ` · ${((saved * 1000) / elapsed).toFixed(1)} activities/s`}
                {matchingRun.stopReason &&
                  ` · ${matchingRun.stopReason.replaceAll('_', ' ')}`}
              </p>
              {matchingRun.error && (
                <p className="text-red-700 dark:text-red-300">
                  {matchingRun.error}
                </p>
              )}
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                {[
                  ['Read inputs', 'inputReadMs'],
                  ['Load places', 'catalogueLoadMs'],
                  ['Prepare and match', 'matchingMs'],
                  ['Commit results', 'commitMs'],
                ].map(([label, key]) => {
                  const ms = matchingMetric(key!);
                  return (
                    <div key={key}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="tabular-nums">
                        {ms === null ? '—' : duration(ms)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="text-xs text-muted-foreground">
                {matchingMetric('inputBatches') ?? '—'} input batches ·{' '}
                {matchingMetric('commitBatches') ?? '—'} commit batches ·{' '}
                {matchingMetric('failed') ?? '—'} activity failures
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              No matching runs logged yet.
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Scheduled jobs"
        description="Triggered by the activitymap-cron Cloudflare Worker. Late means no start for 2.5 expected intervals."
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Job</th>
              <th className={th}>Health</th>
              <th className={th}>Last run</th>
              <th className={th}>Last success</th>
              <th className={th}>Failed runs</th>
              <th className={th}>Activity failures</th>
            </tr>
          </thead>
          <tbody>
            {health.map((row) => (
              <tr key={row.job} className="border-t">
                <td className={cn(td, 'font-mono text-xs')}>{row.job}</td>
                <td className={td}>
                  <Badge tone={HEALTH[row.health].tone}>
                    {HEALTH[row.health].label}
                  </Badge>
                </td>
                <td className={td} title={utc(row.latest?.startedAt)}>
                  {ago(row.latest?.startedAt, now)}
                </td>
                <td className={td} title={utc(row.lastSuccess?.startedAt)}>
                  {ago(row.lastSuccess?.startedAt, now)}
                </td>
                <td className={td}>
                  {row.failures} of {row.runs}
                </td>
                <td className={cn(td, 'tabular-nums')}>
                  {itemFailuresByJob.get(row.job) ? (
                    <Badge tone="warn">
                      {itemFailuresByJob.get(row.job)} in logged runs
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Failing activities"
        description="Activities whose latest fetch failed and that are still outstanding. The cause comes from the newest run log that recorded it."
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Pipeline</th>
              <th className={th}>Activity</th>
              <th className={th}>Error</th>
              <th className={th}>Attempts</th>
              <th className={th}>Last attempt</th>
              <th className={th}>Next retry</th>
            </tr>
          </thead>
          <tbody>
            {data.activityFailures.length === 0 && (
              <tr>
                <td className={cn(td, 'text-muted-foreground')} colSpan={6}>
                  No failing activities.
                </td>
              </tr>
            )}
            {data.activityFailures.map((failure) => {
              const cause = causes.get(
                `${PIPELINE_JOB[failure.pipeline]}:${failure.activityId}`,
              );
              return (
                <tr
                  key={`${failure.pipeline}:${failure.activityId}`}
                  className="border-t"
                >
                  <td className={td}>{failure.pipeline}</td>
                  <td className={cn(td, 'font-mono text-xs')}>
                    <a
                      href={stravaActivity(failure.activityId)}
                      className="underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {failure.activityId}
                    </a>
                    <div className="text-muted-foreground">
                      athlete {failure.athleteId}
                    </div>
                  </td>
                  <td className={cn(td, 'text-xs')}>
                    <div className="font-medium">{failure.code ?? '—'}</div>
                    <div
                      className={cn(!cause && 'text-muted-foreground')}
                      title={cause ? utc(cause.at) : undefined}
                    >
                      {cause?.failure.detail ??
                        'Cause not in the run log (recorded before causes were logged, or older than 14 days).'}
                    </div>
                  </td>
                  <td className={cn(td, 'tabular-nums')}>{failure.attempts}</td>
                  <td
                    className={cn(td, 'whitespace-nowrap')}
                    title={utc(failure.lastAttemptAt)}
                  >
                    {failure.lastAttemptAt
                      ? ago(failure.lastAttemptAt, now)
                      : '—'}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>
                    {failure.nextAttemptAt ? (
                      utc(failure.nextAttemptAt)
                    ) : (
                      <Badge tone="bad">Won&apos;t retry</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        title={onlyFailures ? 'Problem runs' : 'Recent runs'}
        description={
          onlyFailures
            ? `Runs that failed or failed for some activities, newest ${runs.length} of the last 14 days.`
            : `Newest ${data.runs.length} runs; kept for 14 days.`
        }
      >
        <div className="flex gap-2 border-b px-3 py-2 text-sm">
          <Link
            href="/admin"
            className={cn(!onlyFailures && 'font-semibold underline')}
          >
            All
          </Link>
          <Link
            href="/admin?failures=1"
            className={cn(onlyFailures && 'font-semibold underline')}
          >
            Problems ({data.problemRuns.length})
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Started</th>
              <th className={th}>Job</th>
              <th className={th}>Result</th>
              <th className={th}>Duration</th>
              <th className={th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td className={cn(td, 'text-muted-foreground')} colSpan={5}>
                  No runs logged yet.
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr key={run.id} className="border-t">
                <td
                  className={cn(td, 'whitespace-nowrap')}
                  title={utc(run.startedAt)}
                >
                  {ago(run.startedAt, now)}
                </td>
                <td className={cn(td, 'font-mono text-xs')}>{run.job}</td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  <Badge
                    tone={
                      run.status === 'failed'
                        ? 'bad'
                        : run.status === 'disabled'
                          ? 'muted'
                          : itemFailures(run) > 0
                            ? 'warn'
                            : 'good'
                    }
                  >
                    {run.status}
                    {run.status === 'completed' &&
                      itemFailures(run) > 0 &&
                      ` · ${itemFailures(run)} failed`}
                  </Badge>
                  {run.stopReason && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {run.stopReason}
                    </span>
                  )}
                </td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  {duration(run.durationMs)}
                </td>
                <td className={cn(td, 'text-xs')}>
                  <RunDetails run={run} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Webhook inbox"
        description={`Pending ${counts.pending ?? 0} · failed ${counts.failed ?? 0} · dead letters ${counts.dead_letter ?? 0} · succeeded ${counts.succeeded ?? 0}${data.inbox.oldestPendingAgeMs !== null ? ` · oldest pending ${Math.round(data.inbox.oldestPendingAgeMs / 60_000)} min` : ''}`}
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Updated</th>
              <th className={th}>Status</th>
              <th className={th}>Event</th>
              <th className={th}>Athlete</th>
              <th className={th}>Attempts</th>
              <th className={th}>Error</th>
            </tr>
          </thead>
          <tbody>
            {data.webhookFailures.length === 0 && (
              <tr>
                <td className={cn(td, 'text-muted-foreground')} colSpan={6}>
                  No failed or dead-lettered events.
                </td>
              </tr>
            )}
            {data.webhookFailures.map((event) => (
              <tr key={event.id} className="border-t">
                <td
                  className={cn(td, 'whitespace-nowrap')}
                  title={utc(event.updatedAt)}
                >
                  {ago(event.updatedAt, now)}
                </td>
                <td className={td}>
                  <Badge tone={event.status === 'dead_letter' ? 'bad' : 'warn'}>
                    {event.status}
                  </Badge>
                </td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  {event.objectType} {event.aspectType}
                </td>
                <td className={cn(td, 'font-mono text-xs')}>{event.ownerId}</td>
                <td className={td}>{event.attemptCount}</td>
                <td className={cn(td, 'text-xs')}>{event.lastError ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Ingestion status"
        description="Per athlete: stored coverage, outstanding work and scheduling. Strava import uses the same status as Settings → Sync & data; place checks use the current stream and catalogue versions."
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Athlete</th>
              <th className={th}>History</th>
              <th className={th}>Details</th>
              <th className={th}>Streams</th>
              <th className={th}>Photos</th>
              <th className={th}>Place checks</th>
            </tr>
          </thead>
          <tbody>
            {data.coverage.map((athlete) => {
              const [history, ...rest] = coverageSummaries(athlete.status);
              const matching = matchingByUser.get(athlete.userId);
              const matchingProgress =
                matching &&
                coverageProgress(matching.checked, matching.eligible);
              return (
                <tr key={athlete.userId} className="border-t">
                  <td className={td}>
                    <div>{athlete.name ?? 'Unnamed'}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {athlete.athleteId}
                      {athlete.revokedAt && ' · revoked'}
                    </div>
                  </td>
                  <td className={td}>
                    <div>{history!.count}</div>
                    <div className="text-xs text-muted-foreground">
                      {history!.status}
                    </div>
                  </td>
                  {(['details', 'streams', 'photos'] as const).map(
                    (pipeline, index) => {
                      const summary = rest[index]!;
                      const failing =
                        failingByAthlete.get(
                          `${athlete.athleteId}:${pipeline}`,
                        ) ?? [];
                      const terminal = failing.filter(
                        (failure) => !failure.nextAttemptAt,
                      ).length;
                      const pendingCounts: [number, string][] =
                        pipeline === 'details'
                          ? [
                              [
                                athlete.status.details.neverFetched,
                                'awaiting details',
                              ],
                              [
                                athlete.status.details.invalidated,
                                'invalidated',
                              ],
                              [
                                athlete.status.details.retryWaiting,
                                'waiting to retry',
                              ],
                            ]
                          : pipeline === 'streams'
                            ? [
                                [athlete.status.streams.runnable, 'queued'],
                                [athlete.status.streams.waiting, 'waiting'],
                                [athlete.status.streams.blocked, 'blocked'],
                                [athlete.status.streams.failed, 'failed'],
                              ]
                            : [
                                [
                                  athlete.status.photos.refreshRequired,
                                  'refresh pending',
                                ],
                                [athlete.status.photos.unknown, 'unknown'],
                              ];
                      const outstanding = pendingCounts
                        .filter(([count]) => count > 0)
                        .map(
                          ([count, label]) =>
                            `${count.toLocaleString()} ${label}`,
                        )
                        .join(' · ');
                      return (
                        <td key={pipeline} className={td}>
                          <div className="tabular-nums">
                            {summary.count}
                            {summary.progress &&
                              ` · ${summary.progress.percent}%`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {schedulingLabel(athlete.status[pipeline])}
                          </div>
                          {outstanding && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {outstanding}
                            </div>
                          )}
                          {failing.length > 0 && (
                            <div className="mt-1">
                              <Badge tone={terminal ? 'bad' : 'warn'}>
                                {failing.length} failing
                                {terminal > 0 && ` · ${terminal} won't retry`}
                              </Badge>
                            </div>
                          )}
                        </td>
                      );
                    },
                  )}
                  <td className={td}>
                    {matching ? (
                      <>
                        <div className="tabular-nums">
                          {matching.checked.toLocaleString()} /{' '}
                          {matching.eligible.toLocaleString()} checked
                          {matchingProgress &&
                            ` · ${matchingProgress.percent}%`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {matching.pending.toLocaleString()} queued ·{' '}
                          {matching.retryWaiting.toLocaleString()} waiting to
                          retry
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {matching.waitingForStreams.toLocaleString()} waiting
                          for streams · {matching.limited.toLocaleString()}{' '}
                          limited
                        </div>
                        {matching.failed > 0 && (
                          <Badge tone="warn">{matching.failed} failed</Badge>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {athlete.revokedAt
                          ? 'Disconnected'
                          : 'No eligible activities'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        title="Strava request budget"
        description="Shared by all Strava calls; background jobs stop early to keep a reserve for interactive use."
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Window</th>
              <th className={th}>Started</th>
              <th className={th}>Used</th>
              <th className={th}>In flight</th>
              <th className={th}>Blocked until</th>
            </tr>
          </thead>
          <tbody>
            {data.budgets.map((budget) => (
              <tr key={budget.key} className="border-t">
                <td className={cn(td, 'font-mono text-xs')}>{budget.key}</td>
                <td className={td}>{utc(budget.windowStart)}</td>
                <td className={cn(td, 'tabular-nums')}>
                  {budget.used} / {budget.ceiling}
                </td>
                <td className={td}>{budget.inFlight}</td>
                <td className={td}>
                  {budget.blockedUntil && budget.blockedUntil > now
                    ? utc(budget.blockedUntil)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}
