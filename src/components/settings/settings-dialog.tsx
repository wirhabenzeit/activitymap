'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { signOut } from '~/lib/auth-client';
import { displayEmail, safeReturnPath } from '~/lib/auth-return';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { DisplaySettings } from './display-settings';
import { useShallowStore } from '~/store';
import { useIngestionStatus } from '~/hooks/use-ingestion-status';
import {
  coverageProgress,
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
import {
  STRAVA_PERMISSIONS_RECONNECT,
  stravaPermissionNotes,
  stravaPermissionsLimited,
} from '~/lib/strava-permissions';

const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

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
  const query = useIngestionStatus(
    userId,
    open && (tab === 'sync' || tab === 'account'),
  );
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
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
  const needsReconnect =
    !!userId &&
    (!user?.stravaConnected ||
      (status &&
        [status.history, status.details, status.photos, status.streams].some(
          (category) => category.scheduling === 'blocked',
        )));
  const browserMessage = !userId
    ? 'Sign in to sync your activities.'
    : offline || browser.phase === 'offline'
      ? 'Offline. Sync will resume when you’re back online.'
      : browser.phase === 'syncing'
        ? 'Syncing…'
        : browser.phase === 'error'
          ? (browser.error ?? 'Couldn’t sync. Please try again.')
          : null;
  const fetched = status
    ? [
        {
          title: 'Details',
          progress: coverageProgress(
            status.details.detailed,
            status.history.knownActivityCount,
          ),
        },
        {
          title: 'Photos',
          progress: coverageProgress(
            status.photos.activitiesWithStoredPhotos,
            status.photos.activitiesWithPhotos,
          ),
          emptyLabel:
            status.photos.activitiesWithPhotos === 0 ? 'No photos' : '—',
        },
        {
          title: 'Streams',
          progress: coverageProgress(
            status.streams.withData + status.streams.withoutData,
            status.history.knownActivityCount,
          ),
        },
      ]
    : [];
  const permissionNotes =
    userId && user?.stravaConnected
      ? stravaPermissionNotes(user.stravaPermissions)
      : [];
  const showConnect = !userId || !!needsReconnect || permissionNotes.length > 0;
  const email = userId ? displayEmail(user?.email) : null;

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      const result = await signOut();
      if (result.error) throw new Error('Sign-out failed');
      window.location.assign(
        safeReturnPath(`${window.location.pathname}${window.location.search}`),
      );
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="z-[70]"
        className="z-[70] flex h-[min(30rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-md flex-col gap-0 overflow-hidden rounded-xl p-0 [@media(min-width:640px)_and_(max-height:500px)]:h-[calc(100dvh-2rem)] [@media(min-width:640px)_and_(max-height:500px)]:max-w-2xl [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
      >
        <DialogHeader className="shrink-0 px-5 py-4 text-left">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Web sync, Strava import status and display preferences.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b px-5 pb-3">
            <TabsList
              aria-label="Settings sections"
              className="grid h-10 w-full grid-cols-4"
            >
              <TabsTrigger value="sync" className="h-8 px-1 text-xs sm:text-sm">
                Sync & data
              </TabsTrigger>
              <TabsTrigger
                value="display"
                className="h-8 px-1 text-xs sm:text-sm"
              >
                Display
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="h-8 px-1 text-xs sm:text-sm"
              >
                Account
              </TabsTrigger>
              <TabsTrigger
                value="about"
                className="h-8 px-1 text-xs sm:text-sm"
              >
                About
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="sync"
            className="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 [@media(min-width:640px)_and_(max-height:500px)]:py-3"
          >
            <div className="grid gap-5 [@media(min-width:640px)_and_(max-height:500px)]:grid-cols-[0.85fr_1.15fr]">
              <section aria-labelledby="web-sync-heading" className="space-y-2">
                <div className="flex items-center justify-between gap-3 [@media(min-width:640px)_and_(max-height:500px)]:flex-col [@media(min-width:640px)_and_(max-height:500px)]:items-start">
                  <div className="min-w-0 space-y-1">
                    <h2 id="web-sync-heading" className="text-sm font-semibold">
                      Last web sync
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {browser.lastSuccess ? (
                        <time dateTime={browser.lastSuccess}>
                          {date(browser.lastSuccess)}
                        </time>
                      ) : (
                        'Not yet synced'
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 shrink-0"
                    onClick={requestBrowserSync}
                    disabled={
                      !userId ||
                      offline ||
                      browser.phase === 'syncing' ||
                      (!!browser.retryAt && clock < browser.retryAt)
                    }
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={
                        browser.phase === 'syncing' ? 'animate-spin' : ''
                      }
                    />
                    Sync now
                  </Button>
                </div>
                {browserMessage && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {browserMessage}
                  </p>
                )}
                {userId && browser.retryAt && clock < browser.retryAt && (
                  <p className="text-xs text-muted-foreground">
                    Try again after{' '}
                    {date(new Date(browser.retryAt).toISOString())}.
                  </p>
                )}
              </section>
              <section
                aria-labelledby="import-heading"
                className="space-y-3 border-t pt-4 [@media(min-width:640px)_and_(max-height:500px)]:space-y-2 [@media(min-width:640px)_and_(max-height:500px)]:border-t-0 [@media(min-width:640px)_and_(max-height:500px)]:border-l [@media(min-width:640px)_and_(max-height:500px)]:pt-0 [@media(min-width:640px)_and_(max-height:500px)]:pl-5"
              >
                <h2 id="import-heading" className="text-sm font-semibold">
                  Strava import status
                </h2>
                {status ? (
                  <>
                    <dl className="space-y-3 text-sm [@media(min-width:640px)_and_(max-height:500px)]:space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">
                          All activities imported
                        </dt>
                        <dd className="font-medium">
                          {status.history.progress === 'complete'
                            ? 'Yes'
                            : status.history.progress === 'unknown'
                              ? 'Unknown'
                              : 'No'}
                        </dd>
                      </div>
                      {fetched.map(({ title, progress, emptyLabel }) => (
                        <div key={title} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-muted-foreground">{title}</dt>
                            <dd className="font-medium tabular-nums">
                              {progress
                                ? `${progress.percent.toLocaleString()}%`
                                : (emptyLabel ?? '—')}
                            </dd>
                          </div>
                          {progress && (
                            <dd>
                              <progress
                                className="block h-1.5 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                                value={progress.value}
                                max={progress.total}
                                aria-label={`${title} fetched`}
                                aria-valuetext={`${progress.percent}%`}
                              />
                            </dd>
                          )}
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Fetched for imported activities. Photos count only
                      activities with photos.
                    </p>
                  </>
                ) : (
                  <p role="status" className="text-sm text-muted-foreground">
                    {!userId
                      ? 'Sign in to see your import status.'
                      : query.isFetching
                        ? 'Checking your import…'
                        : 'Import status unavailable. Please try again later.'}
                  </p>
                )}
                {stale && status && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {offline ? 'Offline. ' : ''}Last known status ·{' '}
                    {date(status.observedAt)}
                  </p>
                )}
                {needsReconnect && (
                  <div className="space-y-2">
                    <p role="status" className="text-sm text-muted-foreground">
                      Reconnect Strava from Account to continue importing.
                    </p>
                    <Button variant="outline" onClick={() => setTab('account')}>
                      Go to Account
                    </Button>
                  </div>
                )}
              </section>
            </div>
          </TabsContent>
          <TabsContent
            value="display"
            className="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 [@media(min-width:640px)_and_(max-height:500px)]:py-3"
          >
            <DisplaySettings />
          </TabsContent>
          <TabsContent
            value="account"
            className="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 [@media(min-width:640px)_and_(max-height:500px)]:py-3"
          >
            <section aria-labelledby="account-heading" className="space-y-4">
              <div className="space-y-1">
                <h2 id="account-heading" className="text-sm font-semibold">
                  Account
                </h2>
                <p className="break-words text-sm text-muted-foreground">
                  {userId
                    ? (user?.name ?? 'Your account')
                    : 'Connect Strava to see your activities.'}
                </p>
                {email && (
                  <p className="break-words text-xs text-muted-foreground">
                    {email}
                  </p>
                )}
              </div>
              {userId && (
                <p className="text-xs text-muted-foreground">
                  {!user?.stravaConnected
                    ? 'Strava not connected'
                    : stravaPermissionsLimited(user.stravaPermissions)
                      ? 'Strava connected with limited access'
                      : 'Strava connected'}
                </p>
              )}
              {showConnect && (
                <div className="space-y-3">
                  {permissionNotes.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {permissionNotes.join(' ')} {STRAVA_PERMISSIONS_RECONNECT}
                    </p>
                  ) : needsReconnect ? (
                    <p className="text-xs text-muted-foreground">
                      Connect with Strava again to restore access to your
                      activities.
                    </p>
                  ) : null}
                  <StravaConnectButton />
                  <StravaConnectFailure />
                  {!userId && (
                    <p className="text-muted-foreground">
                      {STRAVA_CONNECT_PERMISSIONS}
                    </p>
                  )}
                </div>
              )}
              {userId && (
                <div className="space-y-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={handleSignOut}
                    disabled={signingOut}
                  >
                    {signingOut ? 'Signing out…' : 'Sign out of ActivityMap'}
                  </Button>
                  {signOutFailed && (
                    <p role="alert" className="text-xs text-destructive">
                      Couldn’t sign out. Please try again.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Strava stays connected.
                  </p>
                </div>
              )}
            </section>
          </TabsContent>
          <TabsContent
            value="about"
            className="m-0 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-5"
          >
            <h2 className="text-sm font-semibold">ActivityMap</h2>
            <p className="text-sm text-muted-foreground">
              Your activities, on a map and beyond.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
