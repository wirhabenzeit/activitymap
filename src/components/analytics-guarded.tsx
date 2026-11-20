'use client';

import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { isPrivateUrl } from '~/lib/private-url';

/**
 * Wraps Vercel's Analytics/Speed Insights scripts with a `beforeSend` guard
 * that drops any event for a `/share/...` URL (issue #132: "never let the
 * raw token leak ... into analytics"). A private share link's capability
 * token lives in the page path, and these scripts would otherwise report
 * the full current URL - token included - to Vercel's collection endpoints
 * on every page view.
 *
 * This lives in its own Client Component (rather than passing inline
 * `beforeSend` functions as props from the Server Component root layout)
 * because a Server Component cannot pass a plain function as a prop to a
 * Client Component - only Server Actions can cross that boundary as
 * functions. Defining the guard here, inside the Client Component itself,
 * avoids that restriction entirely.
 */
export function AnalyticsGuarded() {
  return (
    <>
      <Analytics
        beforeSend={(event) => (isPrivateUrl(event.url) ? null : event)}
      />
      <SpeedInsights
        beforeSend={(data) => (isPrivateUrl(data.url) ? null : data)}
      />
    </>
  );
}
