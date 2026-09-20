import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  ShareLinkUnavailableError,
  getShareView,
} from '~/server/application/share-links';
import { SharedActivityMap } from '~/components/share/shared-activity-map';

/**
 * The private share-link capability view (issue #132).
 *
 * This route is deliberately outside the `(app)` group (see
 * `~/app/layout.tsx`'s doc comment): it renders under the minimal root
 * layout only, with no authenticated app chrome, no React Query, and no
 * analytics reporting for this path (see that layout's `beforeSend`
 * guards). It is also intentionally **not** an `/api/v1/...` endpoint - per
 * docs/strava-data-policy.md §5 and the SwiftUI backend preparation plan,
 * public/private sharing is explicitly out of the native API's initial
 * scope. This page calls the same application service
 * (`~/server/application/share-links.ts`) directly from a server component
 * instead.
 *
 * Non-indexable and non-enumerable by design: `robots` below asks crawlers
 * not to index or follow it, nothing in the app ever links to a `/share/...`
 * URL except the athlete's own copy-to-clipboard flow, and every failure
 * mode - unknown token, expired, revoked, or deauthorized athlete - renders
 * the same ordinary Next.js 404 via `notFound()`, so a guessed or
 * incremented token cannot be distinguished from a URL typo.
 *
 * This page renders the shared subset on the same map presentation as the
 * authenticated app, but without the app shell, List/Stats navigation, or
 * access to unrelated account data. The route metadata and response headers
 * both enforce `no-referrer`, so map-tile requests cannot receive the raw
 * capability URL.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared activities · ActivityMap',
  description: 'A private, time-limited ActivityMap share link.',
  referrer: 'no-referrer',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let view;
  try {
    view = await getShareView(token);
  } catch (error) {
    if (error instanceof ShareLinkUnavailableError) {
      notFound();
    }
    throw error;
  }

  return (
    <SharedActivityMap
      activities={view.activities}
      expiresAt={view.expiresAt.toISOString()}
    />
  );
}
