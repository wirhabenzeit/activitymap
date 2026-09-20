import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  ShareLinkUnavailableError,
  getShareView,
} from '~/server/application/share-links';
import type { SharedActivityDTO } from '~/contracts/share/activity';
import { polylineToSvgPath } from '~/lib/sharing/polyline-preview';

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
 * This page also renders no map tiles, external images, fonts, or scripts:
 * `polylineToSvgPath` draws each activity's route entirely inline from the
 * decoded polyline, so nothing on this page ever sends a third-party
 * request that would carry the current URL (and therefore the capability
 * token) in its `Referer` header - see that helper's doc comment.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared activities · ActivityMap',
  description: 'A private, time-limited ActivityMap share link.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

function formatDistance(meters: number | null): string {
  if (meters === null) return '—';
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, '0')}m`
    : `${minutes}m ${secs.toString().padStart(2, '0')}s`;
}

function formatElevation(meters: number | null): string {
  if (meters === null) return '—';
  return `${Math.round(meters)} m`;
}

function ActivityCard({ activity }: { activity: SharedActivityDTO }) {
  const preview = activity.map_summary_polyline
    ? polylineToSvgPath(activity.map_summary_polyline)
    : null;

  return (
    <li className="flex gap-4 rounded-lg border border-border p-4">
      {preview && (
        <svg
          viewBox={preview.viewBox}
          width={72}
          height={72}
          className="shrink-0 text-primary"
          aria-hidden="true"
        >
          <path
            d={preview.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{activity.name}</p>
        <p className="text-sm text-muted-foreground">
          {activity.sport_type} ·{' '}
          {new Date(activity.start_date_local).toLocaleString()}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Distance</dt>
            <dd>{formatDistance(activity.distance)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Moving time</dt>
            <dd>{formatDuration(activity.moving_time)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Elevation</dt>
            <dd>{formatElevation(activity.total_elevation_gain)}</dd>
          </div>
          {activity.average_heartrate !== undefined && (
            <div>
              <dt className="text-xs text-muted-foreground">Avg heart rate</dt>
              <dd>
                {activity.average_heartrate !== null
                  ? `${Math.round(activity.average_heartrate)} bpm`
                  : '—'}
              </dd>
            </div>
          )}
          {activity.average_watts !== undefined && (
            <div>
              <dt className="text-xs text-muted-foreground">Avg power</dt>
              <dd>
                {activity.average_watts !== null
                  ? `${Math.round(activity.average_watts)} W`
                  : '—'}
              </dd>
            </div>
          )}
          {activity.kudos_count !== undefined && (
            <div>
              <dt className="text-xs text-muted-foreground">Kudos</dt>
              <dd>{activity.kudos_count ?? '—'}</dd>
            </div>
          )}
        </dl>
      </div>
    </li>
  );
}

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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Shared activities</h1>
        <p className="text-sm text-muted-foreground">
          Shared privately via ActivityMap. This link expires{' '}
          {new Date(view.expiresAt).toLocaleString()} and can be revoked by
          its owner at any time.
        </p>
      </header>
      {view.activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None of the shared activities are currently available.
        </p>
      ) : (
        <ul className="space-y-3">
          {view.activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </ul>
      )}
    </main>
  );
}
