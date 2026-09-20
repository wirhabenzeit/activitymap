/**
 * Legacy sharing kill switch.
 *
 * Part of #132 (https://github.com/wirhabenzeit/activitymap/issues/132).
 *
 * Before #132, ActivityMap's only "sharing" mechanism embedded durable,
 * non-expiring identifiers directly in `/map` query params:
 *
 * - `/map?user=<Better Auth user.id>` ("share entire profile"), served by
 *   `getPublicUserActivities`.
 * - `/map?activities=<public_id,...>` ("share selected activities"), served
 *   by `getPublicActivities`, keyed on `public_id` - a deterministic,
 *   non-cryptographic FNV-1a hash (`~/server/strava/transforms.ts`) that is
 *   guessable/enumerable and was never a real capability token.
 *
 * Both flows are unauthenticated, have no expiry, and have no revocation:
 * once shared, a link grants standing, permanent, full read access to an
 * athlete's activity history to anyone who has it. See
 * `docs/strava-data-policy.md` §5 for the full assessment. That document
 * concludes these identifiers must be retired, not patched, in favor of an
 * athlete-created, hashed-random-token, mandatory-expiry link - the full
 * scope of #132.
 *
 * This flag disables the legacy exposure immediately, ahead of that
 * replacement, which is blocked on #125's deauthorization/invalidation
 * hooks landing first (see #132's "Dependencies" section). It is the single
 * gate for both sides of the legacy flow - the server-side data readers
 * (`getPublicActivities`/`getPublicUserActivities` in
 * `~/server/db/actions.ts`) and the client UI (the share button and the
 * shared-view notice) - so flipping it back on is a one-line, obviously
 * reversible change once a real replacement (or an interim decision to
 * restore the legacy flow) exists. It is not meant to be toggled
 * independently per side.
 */
export const LEGACY_SHARING_ENABLED = false;

export const LEGACY_SHARING_ISSUE_URL =
  'https://github.com/wirhabenzeit/activitymap/issues/132';

export const LEGACY_SHARING_DISABLED_MESSAGE =
  'Sharing is temporarily disabled while it is redesigned into secure, ' +
  `expiring, revocable private links (see ${LEGACY_SHARING_ISSUE_URL}). ` +
  'Existing share links no longer grant access.';

export class LegacySharingDisabledError extends Error {
  constructor(message: string = LEGACY_SHARING_DISABLED_MESSAGE) {
    super(message);
    this.name = 'LegacySharingDisabledError';
  }
}

/**
 * Throws `LegacySharingDisabledError` while legacy sharing is disabled.
 * Call this before doing any other work (including reading `db`) in a
 * function that serves the legacy unauthenticated sharing flows, so a stale
 * shared link fails loudly and explicitly rather than silently returning no
 * data or a generic error.
 */
export function assertLegacySharingEnabled(): void {
  if (!LEGACY_SHARING_ENABLED) {
    throw new LegacySharingDisabledError();
  }
}
