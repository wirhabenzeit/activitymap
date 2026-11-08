'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  AppDialogBody,
  AppDialogContent,
  AppDialogHeader,
} from '~/components/app-dialog';
import {
  STRAVA_CONNECT_PERMISSIONS,
  StravaConnectButton,
  StravaConnectFailure,
} from '~/components/auth/strava-connect';
import { Button } from '~/components/ui/button';
import { Dialog, DialogDescription, DialogTitle } from '~/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useFormattingLocale } from '~/hooks/use-display-preferences';
import { useIngestionStatus } from '~/hooks/use-ingestion-status';
import { useStravaImport } from '~/hooks/use-strava-import';
import {
  clearDeletedAccountData,
  clearLocalAccountData,
  deleteAccount,
  notifyAccountDeleted,
} from '~/lib/account-deletion';
import { signOut } from '~/lib/auth-client';
import { displayEmail, safeReturnPath } from '~/lib/auth-return';
import {
  coverageProgress,
  snapshotIsStale,
} from '~/lib/ingestion/presentation';
import { stravaImportMessage } from '~/lib/ingestion/strava-import';
import { message } from '~/lib/presentation/messages';
import {
  STRAVA_PERMISSIONS_RECONNECT,
  stravaPermissionNotes,
  stravaPermissionsLimited,
} from '~/lib/strava-permissions';
import {
  emptyBrowserStatus,
  requestBrowserSync,
  useBrowserSyncStatus,
} from '~/lib/sync/browser-status';
import { useShallowStore } from '~/store';

import { DisplaySettings } from './display-settings';
import { PlaceDebugSettings } from './place-debug-settings';

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const locale = useFormattingLocale();
  const date = (value: string) =>
    new Date(value).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const percent = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'percent' }).format(value / 100);
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
  const manualImport = useStravaImport(userId, open && tab === 'sync');
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionFailed, setDeletionFailed] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState<string | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
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
    ? message('settings.signInToSync')
    : offline || browser.phase === 'offline'
      ? message('settings.offlineSync')
      : browser.phase === 'syncing'
        ? message('settings.syncing')
        : browser.phase === 'error'
          ? (browser.error ?? message('settings.syncError'))
          : null;
  const fetched = status
    ? [
        {
          title: message('status.summary.details'),
          progress: coverageProgress(
            status.details.detailed,
            status.history.knownActivityCount,
          ),
        },
        {
          title: message('metric.photos'),
          progress: coverageProgress(
            status.photos.activitiesWithStoredPhotos,
            status.photos.activitiesWithPhotos,
          ),
          emptyLabel:
            status.photos.activitiesWithPhotos === 0
              ? message('status.browsing.noPhotos')
              : '—',
        },
        {
          title: message('status.summary.streams'),
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
  const manualNeedsReconnect = manualImport.data?.status === 'blocked';
  const showConnect =
    !userId ||
    !!needsReconnect ||
    manualNeedsReconnect ||
    permissionNotes.length > 0;
  const email = userId ? displayEmail(user?.email) : null;

  const handleSignOut = async () => {
    const departingUserId = userId;
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      const result = await signOut();
      if (result.error) throw new Error('Sign-out failed');
      if (departingUserId) await clearLocalAccountData(departingUserId);
      window.location.assign(
        safeReturnPath(`${window.location.pathname}${window.location.search}`),
      );
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
    }
  };

  const handleDeletion = async () => {
    const deletedUserId = accountDeleted ?? userId;
    if (!deletedUserId) return;
    setDeleting(true);
    setDeletionFailed(false);
    setCleanupFailed(false);
    try {
      if (!accountDeleted) {
        await deleteAccount();
        setAccountDeleted(deletedUserId);
        notifyAccountDeleted(deletedUserId);
      }
      try {
        await clearDeletedAccountData(deletedUserId);
      } catch {
        setCleanupFailed(true);
        return;
      }
      // The deletion transaction already revoked every server session.
      // Sign-out also removes the browser's authentication cookie.
      await signOut().catch(() => undefined);
      // Reload drops authenticated server-rendered state and in-memory caches.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/map');
    } catch {
      setDeletionFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (deleting) return;
        if (!value) {
          setConfirmDeletion(false);
          setDeletionFailed(false);
        }
        onOpenChange(value);
      }}
    >
      <AppDialogContent
        overlayClassName="z-[70]"
        closeLabel={message('settings.close')}
        layout="sections"
        showClose={!deleting}
        className="z-[70] h-[min(30rem,calc(100dvh-2rem))] [@media(min-width:640px)_and_(max-height:500px)]:max-w-2xl"
      >
        <AppDialogHeader>
          <DialogTitle>{message('navigation.settings')}</DialogTitle>
          <DialogDescription className="sr-only">
            {message('settings.description')}
          </DialogDescription>
        </AppDialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (!deleting) setTab(value);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b px-5 pb-3">
            <TabsList
              aria-label={message('settings.sections')}
              className="grid h-auto w-full grid-cols-4"
            >
              <TabsTrigger
                value="sync"
                className="h-auto min-h-11 px-1 py-2 text-xs whitespace-normal sm:text-sm"
              >
                {message('settings.syncData')}
              </TabsTrigger>
              <TabsTrigger
                value="display"
                className="h-auto min-h-11 px-1 py-2 text-xs whitespace-normal sm:text-sm"
              >
                {message('settings.display')}
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="h-auto min-h-11 px-1 py-2 text-xs whitespace-normal sm:text-sm"
              >
                {message('navigation.account')}
              </TabsTrigger>
              <TabsTrigger
                value="about"
                className="h-auto min-h-11 px-1 py-2 text-xs whitespace-normal sm:text-sm"
              >
                {message('settings.about')}
              </TabsTrigger>
            </TabsList>
          </div>
          <AppDialogBody asChild>
            <TabsContent
              value="sync"
              className="m-0 [@media(min-width:640px)_and_(max-height:500px)]:py-3"
            >
              <div className="grid gap-5 [@media(min-width:640px)_and_(max-height:500px)]:grid-cols-[0.85fr_1.15fr]">
                <section
                  aria-labelledby="web-sync-heading"
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between gap-3 [@media(min-width:640px)_and_(max-height:500px)]:flex-col [@media(min-width:640px)_and_(max-height:500px)]:items-start">
                    <div className="min-w-0 space-y-1">
                      <h2
                        id="web-sync-heading"
                        className="text-sm font-semibold"
                      >
                        {message('settings.lastWebSync')}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {browser.lastSuccess ? (
                          <time dateTime={browser.lastSuccess}>
                            {date(browser.lastSuccess)}
                          </time>
                        ) : (
                          message('settings.notSynced')
                        )}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="min-h-11 shrink-0"
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
                      {message('settings.syncNow')}
                    </Button>
                  </div>
                  {browserMessage && (
                    <p role="status" className="text-xs text-muted-foreground">
                      {browserMessage}
                    </p>
                  )}
                  {userId && browser.retryAt && clock < browser.retryAt && (
                    <p className="text-xs text-muted-foreground">
                      {message('settings.retryAfter', {
                        time: date(new Date(browser.retryAt).toISOString()),
                      })}
                    </p>
                  )}
                </section>
                <section
                  aria-labelledby="import-heading"
                  className="space-y-3 border-t pt-4 [@media(min-width:640px)_and_(max-height:500px)]:space-y-2 [@media(min-width:640px)_and_(max-height:500px)]:border-t-0 [@media(min-width:640px)_and_(max-height:500px)]:border-l [@media(min-width:640px)_and_(max-height:500px)]:pt-0 [@media(min-width:640px)_and_(max-height:500px)]:pl-5"
                >
                  <h2 id="import-heading" className="text-sm font-semibold">
                    {message('status.browsing.stravaImportStatus')}
                  </h2>
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={manualImport.start}
                      disabled={
                        !userId ||
                        offline ||
                        !!needsReconnect ||
                        manualImport.starting ||
                        !manualImport.data?.available ||
                        manualImport.data.status === 'running' ||
                        clock < manualImport.retryAt
                      }
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={
                          manualImport.starting ||
                          manualImport.data?.status === 'running'
                            ? 'animate-spin'
                            : ''
                        }
                      />
                      {message('status.browsing.fetchFromStrava')}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {message(
                        'status.browsing.fetchRecentActivitiesMissingDetailsAndPhotosAndMore',
                      )}
                    </p>
                    {(!!manualImport.startError || manualImport.isError) && (
                      <p
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        {manualImport.startError?.message ??
                          message('error.stravaImport.checkFailed')}
                      </p>
                    )}
                    {manualImport.data &&
                      stravaImportMessage(manualImport.data, locale) && (
                        <p
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          {stravaImportMessage(manualImport.data, locale)}
                        </p>
                      )}
                    {clock < manualImport.retryAt && (
                      <p className="text-xs text-muted-foreground">
                        {message('settings.retryAfter', {
                          time: date(
                            new Date(manualImport.retryAt).toISOString(),
                          ),
                        })}
                      </p>
                    )}
                  </div>
                  {status ? (
                    <>
                      <dl className="space-y-3 text-sm [@media(min-width:640px)_and_(max-height:500px)]:space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-muted-foreground">
                            {message('status.browsing.allActivitiesImported')}
                          </dt>
                          <dd className="font-medium">
                            {status.history.progress === 'complete'
                              ? message('value.yes')
                              : status.history.progress === 'unknown'
                                ? message('status.progress.unknown')
                                : message('value.no')}
                          </dd>
                        </div>
                        {fetched.map(({ title, progress, emptyLabel }) => (
                          <div key={title} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3">
                              <dt className="text-muted-foreground">{title}</dt>
                              <dd className="font-medium tabular-nums">
                                {progress
                                  ? percent(progress.percent)
                                  : (emptyLabel ?? '—')}
                              </dd>
                            </div>
                            {progress && (
                              <dd>
                                <progress
                                  className="block h-1.5 w-full overflow-hidden rounded-full accent-primary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
                                  value={progress.value}
                                  max={progress.total}
                                  aria-label={message('settings.progressName', {
                                    category: title,
                                  })}
                                  aria-valuetext={percent(progress.percent)}
                                />
                              </dd>
                            )}
                          </div>
                        ))}
                      </dl>
                      <p className="text-xs text-muted-foreground">
                        {message('settings.coverageExplanation')}
                      </p>
                    </>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {!userId
                        ? message('settings.signInStatus')
                        : query.isFetching
                          ? message('status.browsing.checkingYourImport')
                          : message(
                              'status.browsing.importStatusUnavailablePleaseTryAgainLater',
                            )}
                    </p>
                  )}
                  {stale && status && (
                    <p role="status" className="text-xs text-muted-foreground">
                      {message(
                        offline
                          ? 'status.browsing.offlineLastKnown'
                          : 'status.browsing.lastKnown',
                        { time: date(status.observedAt) },
                      )}
                    </p>
                  )}
                  {needsReconnect && (
                    <div className="space-y-2">
                      <p
                        role="status"
                        className="text-sm text-muted-foreground"
                      >
                        {message(
                          'status.browsing.reconnectStravaFromAccountToContinueImporting',
                        )}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => setTab('account')}
                      >
                        {message('settings.goToAccount')}
                      </Button>
                    </div>
                  )}
                </section>
              </div>
            </TabsContent>
          </AppDialogBody>
          <AppDialogBody asChild>
            <TabsContent
              value="display"
              className="m-0 [@media(min-width:640px)_and_(max-height:500px)]:py-3"
            >
              <DisplaySettings />
              <PlaceDebugSettings check={open && tab === 'display'} />
            </TabsContent>
          </AppDialogBody>
          <AppDialogBody asChild>
            <TabsContent
              value="account"
              className="m-0 [@media(min-width:640px)_and_(max-height:500px)]:py-3"
            >
              {accountDeleted && (
                <div className="mb-4 space-y-3" role="status">
                  <p className="text-sm">{message('account.deleted')}</p>
                  {cleanupFailed && (
                    <p className="text-sm text-destructive">
                      {message('account.cleanupFailed')}
                    </p>
                  )}
                  <Button disabled={deleting} onClick={handleDeletion}>
                    {deleting
                      ? message('account.clearing')
                      : message('account.finishClearing')}
                  </Button>
                </div>
              )}
              <section aria-labelledby="account-heading" className="space-y-4">
                <div className="space-y-1">
                  <h2 id="account-heading" className="text-sm font-semibold">
                    {message('navigation.account')}
                  </h2>
                  <p className="text-sm break-words text-muted-foreground">
                    {userId
                      ? (user?.name ?? message('account.yourAccount'))
                      : message('account.connectToSee')}
                  </p>
                  {email && (
                    <p className="text-xs break-words text-muted-foreground">
                      {email}
                    </p>
                  )}
                </div>
                {userId && (
                  <p className="text-xs text-muted-foreground">
                    {!user?.stravaConnected
                      ? message('account.stravaDisconnected')
                      : stravaPermissionsLimited(user.stravaPermissions)
                        ? message('account.stravaLimited')
                        : message('account.stravaConnected')}
                  </p>
                )}
                {showConnect && !accountDeleted && (
                  <div className="space-y-3">
                    {permissionNotes.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {permissionNotes.join(' ')}{' '}
                        {STRAVA_PERMISSIONS_RECONNECT}
                      </p>
                    ) : needsReconnect || manualNeedsReconnect ? (
                      <p className="text-xs text-muted-foreground">
                        {message('account.reconnect')}
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
                      disabled={signingOut || deleting}
                    >
                      {signingOut
                        ? message('account.signingOut')
                        : message('account.signOut')}
                    </Button>
                    {signOutFailed && (
                      <p role="alert" className="text-xs text-destructive">
                        {message('account.signOutFailed')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {message('account.stravaStaysConnected')}
                    </p>
                  </div>
                )}
                {userId && !accountDeleted && (
                  <div className="space-y-3 border-t pt-4">
                    <h3 className="text-sm font-semibold">
                      {message('account.delete')}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {message('account.deleteExplanation')}
                    </p>
                    {confirmDeletion ? (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">
                          {message('account.deleteQuestion')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="destructive"
                            disabled={deleting || offline}
                            onClick={handleDeletion}
                          >
                            {deleting
                              ? message('account.deleting')
                              : message('account.confirmDelete')}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={deleting}
                            onClick={() => setConfirmDeletion(false)}
                          >
                            {message('activity.edit.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="destructive"
                        disabled={signingOut || offline}
                        onClick={() => {
                          setConfirmDeletion(true);
                          setDeletionFailed(false);
                        }}
                      >
                        {message('account.delete')}
                      </Button>
                    )}
                    {offline && (
                      <p className="text-xs text-muted-foreground">
                        {message('account.onlineToDelete')}
                      </p>
                    )}
                    {deletionFailed && (
                      <p role="alert" className="text-xs text-destructive">
                        {message('account.deleteFailed')}
                      </p>
                    )}
                  </div>
                )}
              </section>
            </TabsContent>
          </AppDialogBody>
          <AppDialogBody asChild>
            <TabsContent value="about" className="m-0 space-y-2">
              <h2 className="text-sm font-semibold">ActivityMap</h2>
              <p className="text-sm text-muted-foreground">
                {message('settings.tagline')}
              </p>
            </TabsContent>
          </AppDialogBody>
        </Tabs>
      </AppDialogContent>
    </Dialog>
  );
}
