'use client';

import * as React from 'react';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';

import { signIn } from '~/lib/auth-client';
import {
  connectFailure,
  safeReturnPath,
  type ConnectFailure,
} from '~/lib/auth-return';
import { cn } from '~/lib/utils';
import { useShallowStore } from '~/store';

/**
 * Why ActivityMap asks to connect Strava, and what the requested `read`,
 * `activity:read_all` and `activity:write` scopes are for. Mirrored by the
 * iOS `StravaConnect` copy; keep them in step (issue #304).
 */
export const STRAVA_CONNECT_PURPOSE =
  'ActivityMap shows your Strava activities on a map, in a list and as stats.';
export const STRAVA_CONNECT_PERMISSIONS =
  'Strava will ask you to let ActivityMap read your activities, including private ones, and update an activity’s name, description and sport when you edit it here.';

const FAILURE_MESSAGES: Record<ConnectFailure, string> = {
  cancelled:
    'Strava connection was cancelled. Connect again whenever you’re ready.',
  failed: 'Couldn’t connect to Strava. Please try again.',
};

type StravaConnect = {
  connect: () => void;
  pending: boolean;
  failure: ConnectFailure | null;
};

const StravaConnectContext = React.createContext<StravaConnect | null>(null);

/**
 * One connection flow for every web entry point. The OAuth round trip
 * returns to the view it started from (validated by `safeReturnPath`); a
 * declined or failed attempt returns there too, with Better Auth's `error`
 * parameter. The next attempt starts from a return path without it.
 */
export function StravaConnectProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signedOut = useShallowStore(
    (state) => state.isInitialized && !state.user && !state.isGuest,
  );
  const [pending, setPending] = React.useState(false);
  const [attemptFailure, setAttemptFailure] =
    React.useState<ConnectFailure | null>(null);
  const returnedFailure = signedOut
    ? connectFailure(searchParams.get('error'))
    : null;
  const failure = pending ? null : (attemptFailure ?? returnedFailure);

  // Returning with the Back button can restore this page from the
  // back/forward cache with the attempt still marked as in progress.
  React.useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const connect = React.useCallback(() => {
    if (pending) return;
    const query = searchParams.toString();
    const returnPath = safeReturnPath(`${pathname}${query ? `?${query}` : ''}`);
    setPending(true);
    setAttemptFailure(null);
    void signIn
      .social({
        provider: 'strava',
        callbackURL: returnPath,
        errorCallbackURL: returnPath,
      })
      .then((result) => {
        // Success navigates away to Strava; only a failure returns here.
        if (result.error) {
          setPending(false);
          setAttemptFailure('failed');
        }
      })
      .catch(() => {
        setPending(false);
        setAttemptFailure('failed');
      });
  }, [pending, pathname, searchParams]);

  const value = React.useMemo(
    () => ({ connect, pending, failure }),
    [connect, pending, failure],
  );
  return (
    <StravaConnectContext.Provider value={value}>
      {children}
    </StravaConnectContext.Provider>
  );
}

export function useStravaConnect(): StravaConnect {
  const value = React.useContext(StravaConnectContext);
  if (!value)
    throw new Error('useStravaConnect requires StravaConnectProvider');
  return value;
}

/**
 * Strava's official "Connect with Strava" artwork, unmodified and at its
 * native proportions (193 × 48, including Strava's own padding). Progress
 * stays next to the artwork rather than drawn over it.
 */
export function StravaConnectButton({ className }: { className?: string }) {
  const { connect, pending } = useStravaConnect();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={connect}
        disabled={pending}
        aria-busy={pending}
        className="shrink-0 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
      >
        <Image
          src="/btn_strava.svg"
          alt="Connect with Strava"
          width={193}
          height={48}
          priority
          unoptimized
        />
      </button>
      {pending && (
        <span
          role="status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening Strava…
        </span>
      )}
    </div>
  );
}

export function StravaConnectFailure({ className }: { className?: string }) {
  const { failure } = useStravaConnect();
  if (!failure) return null;
  return (
    <p
      role={failure === 'failed' ? 'alert' : 'status'}
      className={cn(
        'text-sm',
        failure === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {FAILURE_MESSAGES[failure]}
    </p>
  );
}

/**
 * The first-use surface over Map, List and Stats while signed out: one tap
 * on the official button starts the Strava authorization. The surrounding
 * view stays visible and is not blocked beyond the card itself.
 */
export function SignedOutConnectPanel() {
  const signedOut = useShallowStore(
    (state) => state.isInitialized && !state.user && !state.isGuest,
  );
  if (!signedOut) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <section
        aria-labelledby="strava-connect-title"
        className="pointer-events-auto w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 text-card-foreground shadow-lg"
      >
        <div className="space-y-2">
          <h2
            id="strava-connect-title"
            className="text-lg font-semibold leading-tight"
          >
            Connect Strava to see your activities
          </h2>
          <p className="text-sm text-muted-foreground">
            {STRAVA_CONNECT_PURPOSE}
          </p>
        </div>
        <StravaConnectButton />
        <StravaConnectFailure />
        <p className="text-xs text-muted-foreground">
          {STRAVA_CONNECT_PERMISSIONS}
        </p>
      </section>
    </div>
  );
}
