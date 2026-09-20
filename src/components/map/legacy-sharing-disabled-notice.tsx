'use client';

import { LEGACY_SHARING_ISSUE_URL } from '~/lib/legacy-sharing';

/**
 * Shown instead of the map when a visitor arrives via a legacy
 * `/map?user=...`/`/map?activities=...` share link. Part of #132 - see
 * `~/lib/legacy-sharing.ts` and docs/strava-data-policy.md §5 for why these
 * links are disabled. A stale link should say plainly that access has been
 * withdrawn, not render an empty map or a generic error.
 */
export function LegacySharingDisabledNotice({
  guestModeType,
}: {
  guestModeType: 'user' | 'activities' | null;
}) {
  const whatWasShared =
    guestModeType === 'user'
      ? 'This link previously shared an athlete’s entire activity history.'
      : 'This link previously shared a selected set of activities.';

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold">
          This shared link no longer works
        </h1>
        <p className="text-sm text-muted-foreground">
          {whatWasShared} Sharing has been disabled because it granted
          permanent, non-revocable access with no expiry, so access through
          this link has been withdrawn.
        </p>
        <p className="text-sm text-muted-foreground">
          It is being replaced with secure, expiring private links that the
          athlete can revoke at any time.{' '}
          <a
            href={LEGACY_SHARING_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Track progress in issue #132.
          </a>
        </p>
      </div>
    </div>
  );
}
