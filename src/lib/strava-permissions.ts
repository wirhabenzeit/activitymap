/**
 * What a Strava grant lets ActivityMap do, derived from the scopes the person
 * actually approved (issue #303). Strava's consent screen lets people untick
 * individual scopes, so a working connection is not the same as every
 * requested permission: `activity:read` without `activity:read_all` hides
 * "Only You" activities, and without `activity:write` editing fails.
 *
 * Shared by the server (to describe the grant) and the web client (to word
 * it); the iOS client receives the same shape through `GET /api/v1/me`.
 */
export type StravaActivityAccess = 'all' | 'public' | 'none';

export interface StravaPermissions {
  /** `all`: activity:read_all; `public`: activity:read only; `none`: neither. */
  activities: StravaActivityAccess;
  /** activity:write: names, descriptions and sports can be edited. */
  edit: boolean;
}

const KNOWN_SCOPES = new Set([
  'read',
  'read_all',
  'profile:read_all',
  'profile:write',
  'activity:read',
  'activity:read_all',
  'activity:write',
]);

function scopeList(scope: string | null | undefined): string[] {
  return (scope ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => KNOWN_SCOPES.has(value));
}

/**
 * The granted Strava scope as stored on the account, or `null` when the
 * value is missing or carries no Strava scope. Accounts connected before
 * scopes were recorded have no usable value: that is "unknown", never
 * "nothing granted".
 */
export function stravaPermissionsFromScope(
  scope: string | null | undefined,
): StravaPermissions | null {
  const scopes = scopeList(scope);
  if (scopes.length === 0) return null;
  return {
    activities: scopes.includes('activity:read_all')
      ? 'all'
      : scopes.includes('activity:read')
        ? 'public'
        : 'none',
    edit: scopes.includes('activity:write'),
  };
}

/**
 * The `scope` Strava appends to its authorization redirect, normalised for
 * storage. Strava reports the approved scopes only there; the token response
 * carries none, so Better Auth cannot record them itself.
 */
export function grantedStravaScope(callbackUrl: string | undefined) {
  if (!callbackUrl) return null;
  let scope: string | null;
  try {
    scope = new URL(callbackUrl).searchParams.get('scope');
  } catch {
    return null;
  }
  // Present but empty is still an answer: no scope was granted.
  if (scope === null) return null;
  return scopeList(scope).join(',');
}

export function stravaPermissionsLimited(
  permissions: StravaPermissions | null | undefined,
): boolean {
  return (
    !!permissions && (permissions.activities !== 'all' || !permissions.edit)
  );
}

/**
 * Short explanations of what a limited grant leaves out, in order of
 * impact. Empty for a full or unknown grant. Mirrored in iOS
 * `StravaPermissionsCopy`; keep them in step.
 */
export function stravaPermissionNotes(
  permissions: StravaPermissions | null | undefined,
): string[] {
  if (!permissions) return [];
  const notes: string[] = [];
  if (permissions.activities === 'none') {
    notes.push(
      'Strava isn’t sharing your activities with ActivityMap, so none can be imported.',
    );
  } else if (permissions.activities === 'public') {
    notes.push(
      'Activities visible only to you aren’t included, because access to private activities wasn’t granted.',
    );
  }
  if (!permissions.edit) {
    notes.push(
      'Editing activity names, descriptions and sports isn’t available, because permission to update activities wasn’t granted.',
    );
  }
  return notes;
}

export const STRAVA_PERMISSIONS_RECONNECT =
  'To change this, connect with Strava again and keep every box ticked.';
