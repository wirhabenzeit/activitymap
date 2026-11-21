import type { Metadata } from 'next';

/**
 * Landing page for the return from the installed Strava app (issue #305).
 *
 * After a sign-in approved in the Strava app, Strava opens
 * `https://activitymap.cc/auth/strava?code=…&state=…`. This path is an
 * universal link of the ActivityMap app (`applinks` in the
 * apple-app-site-association file), so iOS normally hands it to the app and
 * this page is never rendered. It exists so the redirect target is a real
 * URL: if the link is opened in a browser instead, the visitor sees an
 * explanation rather than an error.
 *
 * The query string carries a Strava authorization code, so, like
 * `/auth/callback`, this page renders nothing from it, is not indexable, is
 * sent with `Referrer-Policy: no-referrer` and `no-store` (see
 * `next.config.js`), and `AnalyticsGuarded` drops events for this path. The
 * code alone signs nobody in: it is only redeemed together with a PKCE
 * verifier that never leaves the app.
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Return to ActivityMap',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
};

export default function StravaReturnPage() {
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
