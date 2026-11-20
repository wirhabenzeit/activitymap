import type { Metadata } from 'next';

/**
 * Landing page for the iOS sign-in redirect (issue #482).
 *
 * The ActivityMap app asks its system sign-in sheet to watch for
 * `https://activitymap.cc/auth/callback` and intercepts that navigation, so
 * normally this page is never rendered: the sheet closes and the app finishes
 * signing in. It exists so the https redirect target is a real URL. If the
 * link is opened anywhere else (the app is not installed, or the link was
 * followed in a browser), the visitor sees a short explanation instead of an
 * error.
 *
 * The query string carries a one-time sign-in code, so this page is built to
 * keep it out of everything else: it renders nothing from the query, is not
 * indexable, is sent with `Referrer-Policy: no-referrer` and `no-store` (see
 * `next.config.js`), and `AnalyticsGuarded` drops events for this path.
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Return to ActivityMap',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
};

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-center text-foreground">
      <div className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Return to ActivityMap</h1>
        <p className="text-sm text-muted-foreground">
          Sign-in finishes in the ActivityMap app. If this page stayed open,
          close it and try Connect with Strava again from the app.
        </p>
      </div>
    </main>
  );
}
