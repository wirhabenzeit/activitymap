import type { Metadata } from 'next';
import Link from 'next/link';

import { loadAdminDashboard } from '~/server/application/admin-dashboard';
import { requireAdmin } from '~/server/auth/admin';
import { jobHealth, type JobHealth } from '~/lib/admin/job-health';
import { coverageSummaries } from '~/lib/ingestion/presentation';
import { cn } from '~/lib/utils';

/**
 * Read-only operations dashboard (issue #328): scheduled job health and run
 * history, the webhook inbox, per-athlete import coverage and the shared
 * Strava request budget. Outside the `(app)` group, like `/share`, so it has
 * no app chrome. Only athletes listed in `ACTIVITYMAP_ADMIN_ATHLETE_IDS` get
 * past `requireAdmin()`; everyone else gets the ordinary 404.
 */

export const dynamic = 'force-dynamic';

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
  const runs = onlyFailures
    ? data.runs.filter((run) => run.status === 'failed')
    : data.runs;
  const counts = data.inbox.countsByStatus;

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
              <th className={th}>Failures (logged runs)</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title={onlyFailures ? 'Failed runs' : 'Recent runs'}
        description={`Newest ${data.runs.length} runs; kept for 14 days.`}
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
            Failures only
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
                <td className={td}>
                  <Badge
                    tone={
                      run.status === 'failed'
                        ? 'bad'
                        : run.status === 'disabled'
                          ? 'muted'
                          : 'good'
                    }
                  >
                    {run.status}
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
                  {run.error ? (
                    <span className="text-red-700 dark:text-red-300">
                      {run.error}
                    </span>
                  ) : (
                    <span className="font-mono text-muted-foreground">
                      {Object.entries(run.summary ?? {})
                        .map(([key, value]) => `${key}=${String(value)}`)
                        .join(' ')}
                    </span>
                  )}
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
        title="Import coverage"
        description="Per athlete, from the same read model as Settings → Sync & data."
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={th}>Athlete</th>
              <th className={th}>History</th>
              <th className={th}>Details</th>
              <th className={th}>Streams</th>
              <th className={th}>Photos</th>
            </tr>
          </thead>
          <tbody>
            {data.coverage.map((athlete) => {
              const [history, ...rest] = coverageSummaries(athlete.status);
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
                  {rest.map((summary) => (
                    <td key={summary.title} className={td}>
                      <div className="tabular-nums">
                        {summary.progress
                          ? `${summary.progress.percent}%`
                          : '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {summary.status}
                      </div>
                    </td>
                  ))}
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
