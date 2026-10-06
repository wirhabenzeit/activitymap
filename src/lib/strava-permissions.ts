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
 * carries none, so Better Auth cannot record them itself. `null` when the
 * redirect carried no `scope`, which leaves the stored grant untouched.
 */
export function grantedStravaScope(scope: unknown): string | null {
  if (typeof scope !== 'string') return null;
  return scopeList(scope).join(',');
}

/** The raw `scope` query value of an OAuth callback URL, if any. */
export function callbackScopeParam(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('scope');
  } catch {
    return null;
  }
}

/**
 * Strava skips its consent screen for an athlete who already authorised the
 * app, so reconnecting to grant more access needs `approval_prompt=force`.
 */
export const STRAVA_FORCE_CONSENT = { approval_prompt: 'force' } as const;

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
    notes.push('No activities are shared.');
  } else if (permissions.activities === 'public') {
    notes.push('Private activities aren’t shared.');
  }
  if (!permissions.edit) notes.push('Editing isn’t allowed.');
  return notes;
}

export const STRAVA_PERMISSIONS_RECONNECT =
  'Connect with Strava again to grant the missing permissions.';
