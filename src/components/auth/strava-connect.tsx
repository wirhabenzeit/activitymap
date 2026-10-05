'use client';

import * as React from 'react';
import Image from 'next/image';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { usePathname, useSearchParams } from 'next/navigation';

import {
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '~/components/ui/dialog';
import { signIn } from '~/lib/auth-client';
import {
  connectFailure,
  safeReturnPath,
  type ConnectFailure,
} from '~/lib/auth-return';
import { STRAVA_FORCE_CONSENT } from '~/lib/strava-permissions';
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
  // Someone already signed in is reconnecting, usually to change what they
  // granted: show Strava's consent screen instead of letting it skip ahead.
  const reconnecting = useShallowStore(
    (state) => !!state.user && !state.isGuest,
  );
  const [pending, setPending] = React.useState(false);
  const [attemptFailure, setAttemptFailure] =
    React.useState<ConnectFailure | null>(null);
  const returnedFailure = connectFailure(searchParams.get('error'));
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
        ...(reconnecting ? { additionalParams: STRAVA_FORCE_CONSENT } : {}),
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
  }, [pending, pathname, searchParams, reconnecting]);

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
 * native proportions (193 × 48, including Strava's own padding). Clicking it
 * is effectively a link to Strava: the brief request that prepares the
 * redirect only disables the button so a second click cannot start another.
 */
export function StravaConnectButton({ className }: { className?: string }) {
  const { connect, pending } = useStravaConnect();
  return (
    <button
      type="button"
      onClick={connect}
      disabled={pending}
      aria-busy={pending}
      className={cn(
        'shrink-0 self-start rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait',
        className,
      )}
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
 * The first-use surface while signed out: a centred, non-dismissible dialog
 * floating over the whole app on a blurred backdrop. One tap on the official
 * button starts the Strava authorization; the app stays visible behind it.
 */
export function SignedOutConnectPanel() {
  const signedOut = useShallowStore(
    (state) => state.isInitialized && !state.user && !state.isGuest,
  );
  // Nothing behind the dialog is usable without an account, so it cannot be
  // closed; connecting (which reloads the shell) is the way forward.
  const keepOpen = (event: Event) => event.preventDefault();
  return (
    <DialogPrimitive.Root open={signedOut}>
      <DialogPortal>
        {/* Above the app header (z-[60]) so the whole app sits behind the glass. */}
        <DialogOverlay className="z-[70] bg-background/20 backdrop-blur-md" />
        <DialogPrimitive.Content
          onEscapeKeyDown={keepOpen}
          onPointerDownOutside={keepOpen}
          onInteractOutside={keepOpen}
          className="fixed top-1/2 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-white/20 bg-card/75 p-6 text-card-foreground shadow-2xl ring-1 ring-black/5 backdrop-blur-xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:border-white/10"
        >
          <div className="space-y-2">
            <DialogTitle className="text-lg leading-tight font-semibold">
              Connect Strava to see your activities
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {STRAVA_CONNECT_PURPOSE}
            </DialogDescription>
          </div>
          <StravaConnectButton />
          <StravaConnectFailure />
          <p className="text-xs text-muted-foreground">
            {STRAVA_CONNECT_PERMISSIONS}
          </p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
