'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Button } from '~/components/ui/button';
import { DisplaySettings } from './display-settings';
import { useShallowStore } from '~/store';
import {
  useIngestionStatus,
  IngestionStatusError,
} from '~/hooks/use-ingestion-status';
import {
  coverageRows,
  coverageSummaries,
  outcomeText,
  snapshotIsStale,
} from '~/lib/ingestion/presentation';
import {
  emptyBrowserStatus,
  requestBrowserSync,
  useBrowserSyncStatus,
} from '~/lib/sync/browser-status';
import {
  StravaConnectButton,
  StravaConnectFailure,
  STRAVA_CONNECT_PERMISSIONS,
} from '~/components/auth/strava-connect';

const date = (value: string) => new Date(value).toLocaleString();

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, isGuest } = useShallowStore((state) => ({
    user: state.user,
    isGuest: state.isGuest,
  }));
  const userId = isGuest ? undefined : user?.id;
  const [tab, setTab] = useState('sync');
  const query = useIngestionStatus(userId, open && tab === 'sync');
  const browser = useBrowserSyncStatus((state) =>
    userId ? (state.byUser[userId] ?? emptyBrowserStatus) : emptyBrowserStatus,
  );
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!open) return;
    const tick = () => setClock(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [open]);
  const status = userId ? query.data : undefined;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const stale =
    !!status &&
    (offline || query.isError || snapshotIsStale(status.observedAt, clock));
  const statusRetryAt = Math.max(
    query.dataUpdatedAt + 60_000,
    query.errorUpdatedAt + 60_000,
    query.error instanceof IngestionStatusError ? query.error.retryAt : 0,
  );
  const browserTitle = {
    idle: 'Not yet synced',
    syncing: 'Downloading changes…',
    ready: 'Up to date',
    offline: 'Offline',
    error: 'Couldn’t sync',
  }[browser.phase];
  const rows = status ? coverageRows(status) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto break-words sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Account, sync and display preferences.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList
            className="grid h-auto w-full grid-cols-4"
            aria-label="Settings sections"
          >
            {[
              ['account', 'Account'],
              ['sync', 'Sync & data'],
              ['display', 'Display'],
              ['about', 'About'],
            ].map(([value, title]) => (
              <TabsTrigger
                key={value}
                value={value!}
                className="min-w-0 whitespace-normal px-1 text-xs sm:text-sm"
              >
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="sync" className="space-y-6 pt-4">
            <section aria-labelledby="server-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="server-heading" className="font-semibold">
                    Strava import
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Strava → ActivityMap
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Check server status"
                  title={
                    clock < statusRetryAt
                      ? `Next check after ${date(new Date(statusRetryAt).toISOString())}`
                      : 'Check server status'
                  }
                  disabled={
                    !userId ||
                    query.isFetching ||
                    offline ||
                    clock < statusRetryAt
                  }
                  onClick={() => void query.refetch()}
                >
                  <RefreshCw
                    className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
              {status ? (
                <div className="divide-y rounded-xl border">
                  {coverageSummaries(status).map((summary, index) => {
                    const row = rows[index]!;
                    return (
                      <details key={summary.title} className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
                              <span>{summary.title}</span>
                              {summary.progress && (
                                <span className="tabular-nums">
                                  {summary.progress.percent.toLocaleString()}%
                                </span>
                              )}
                            </div>
                            {summary.progress && (
                              <progress
                                className="block h-2 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                                value={summary.progress.value}
                                max={summary.progress.total}
                                aria-label={summary.title}
                                aria-valuetext={`${summary.progress.percent}% — ${summary.count}`}
                              />
                            )}
                            <span className="block text-xs text-muted-foreground">
                              {summary.count}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {summary.status}
                            </span>
                          </div>
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                        </summary>
                        <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                          <p>
                            {stale ? 'At last check: ' : ''}
                            {row.schedule}
                          </p>
                          {row.reason && <p>{row.reason}</p>}
                          {row.retryAt && (
                            <p>Eligible to retry after {date(row.retryAt)}.</p>
                          )}
                          {index === 0 && (
                            <div className="space-y-2">
                              <p>
                                {status.history.reconciliation.lastCompletedAt
                                  ? `Last full history check: ${date(status.history.reconciliation.lastCompletedAt)}.`
                                  : 'A full history check has not finished yet.'}
                              </p>
                              {status.history.reconciliation.nextDueAt && (
                                <p>
                                  {Date.parse(
                                    status.history.reconciliation.nextDueAt,
                                  ) <= Date.parse(status.observedAt)
                                    ? 'Refresh was due'
                                    : 'Next refresh due'}
                                  :{' '}
                                  {date(
                                    status.history.reconciliation.nextDueAt,
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                          {index === 1 || index === 2 ? (
                            <p>Of the activities imported so far.</p>
                          ) : null}
                          {index === 3 && (
                            <p>
                              Counts activities with photos available, not
                              individual images.
                            </p>
                          )}
                          <details className="space-y-2">
                            <summary className="cursor-pointer">
                              More information
                            </summary>
                            {index === 3 ? (
                              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                                <dt>Individual photos stored</dt>
                                <dd>
                                  {status.photos.photoCount.toLocaleString()}
                                </dd>
                                <dt>Collections verified current</dt>
                                <dd>
                                  {status.photos.current.toLocaleString()}
                                </dd>
                              </dl>
                            ) : (
                              <p>{row.counts}</p>
                            )}
                            {index === 2 && (
                              <p>
                                An activity with no recorded measurements still
                                counts as checked.
                              </p>
                            )}
                            {row.outcome && (
                              <p>
                                {outcomeText(row.outcome)} ·{' '}
                                {date(row.outcome.attemptedAt)}
                                {row.outcome.lastSucceededAt
                                  ? ` · Last success: ${date(row.outcome.lastSucceededAt)}`
                                  : ''}
                              </p>
                            )}
                          </details>
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <div
                  role="status"
                  className="rounded-xl border px-4 py-6 text-sm text-muted-foreground"
                >
                  {!userId
                    ? 'Sign in to see your import status.'
                    : query.isFetching
                      ? 'Checking your import…'
                      : 'Server status unavailable.'}
                </div>
              )}
              <div role="status" className="text-xs text-muted-foreground">
                {status && (
                  <p title={date(status.observedAt)}>
                    {stale ? 'Last known status' : 'Checked'} ·{' '}
                    {date(status.observedAt)}
                  </p>
                )}
                {offline ? (
                  <p>Offline. Showing saved status.</p>
                ) : query.isError ? (
                  <p>{query.error.message}</p>
                ) : null}
              </div>
              {rows.some((row) => row.schedule.startsWith('Reconnect')) && (
                <StravaConnectButton />
              )}
              <StravaConnectFailure />
            </section>
            <section
              aria-labelledby="browser-heading"
              className="space-y-3 border-t pt-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="browser-heading" className="font-semibold">
                    This browser
                  </h2>
                  <p role="status" className="text-sm text-muted-foreground">
                    {browserTitle}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={requestBrowserSync}
                  disabled={
                    !userId ||
                    offline ||
                    browser.phase === 'syncing' ||
                    (!!browser.retryAt && clock < browser.retryAt)
                  }
                >
                  Sync browser
                </Button>
              </div>
              {browser.error && (
                <p role="alert" className="text-sm">
                  {browser.error}
                </p>
              )}
              {browser.retryAt && clock < browser.retryAt && (
                <p className="text-xs text-muted-foreground">
                  Retry after {date(new Date(browser.retryAt).toISOString())}
                </p>
              )}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Download details</summary>
                <div className="space-y-2 pt-2">
                  <p>
                    Last success:{' '}
                    {browser.lastSuccess
                      ? date(browser.lastSuccess)
                      : 'Not recorded'}
                  </p>
                  <p>
                    Downloads ActivityMap metadata to this browser. Strava
                    import and image downloads run separately.
                  </p>
                </div>
              </details>
            </section>
          </TabsContent>
          <TabsContent value="account" className="space-y-4 py-5">
            <div>
              <h2 className="font-semibold">
                {userId ? (user?.name ?? 'Your account') : 'Your account'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {userId
                  ? user?.stravaConnected
                    ? 'Strava connected'
                    : 'Strava needs reconnecting'
                  : 'Sign in to view your activities.'}
              </p>
            </div>
            <StravaConnectButton />
            <StravaConnectFailure />
            <p className="text-sm text-muted-foreground">
              {STRAVA_CONNECT_PERMISSIONS}
            </p>
          </TabsContent>
          <TabsContent value="display" className="py-5">
            <DisplaySettings />
          </TabsContent>
          <TabsContent value="about" className="space-y-2 py-5">
            <h2 className="font-semibold">ActivityMap</h2>
            <p className="text-sm text-muted-foreground">
              Your activities, on a map and beyond.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
