/**
 * Configuration-driven allow-list for the mobile-auth universal-link
 * redirect (issue #121). Any redirect target outside this list must be
 * rejected at the point the redirect is constructed - this module is the
 * open-redirect test surface called out in the issue's acceptance
 * criteria, and it never does a naive `startsWith` string comparison
 * (which a `https://good.example.com.evil.test` or
 * `https://evil.test/https://good.example.com` payload would defeat).
 */

const ENV_VAR = 'MOBILE_AUTH_REDIRECT_ALLOWLIST';

export type AllowlistedRedirectPrefix = {
  /** e.g. "https:" or "activitymap:" - compared exactly. */
  protocol: string;
  /**
   * The URL's `host` (empty string for a scheme with no authority, e.g. a
   * custom-scheme universal link like `activitymap:/callback`). Compared
   * exactly, never by substring/suffix, so a lookalike host can't match.
   */
  host: string;
  /** Path prefix the candidate's pathname must start with, always "/"-terminated. */
  pathPrefix: string;
};

export class InvalidRedirectAllowlistEntryError extends Error {
  constructor(entry: string, cause: unknown) {
    super(`Invalid mobile auth redirect allow-list entry: "${entry}"`, {
      cause,
    });
    this.name = 'InvalidRedirectAllowlistEntryError';
  }
}

function normalizePathPrefix(pathname: string): string {
  // A prefix "/auth" must not match "/auth-evil"; treat every prefix as
  // matching only at a path segment boundary.
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function parseAllowlistEntry(entry: string): AllowlistedRedirectPrefix {
  try {
    const url = new URL(entry);
    return {
      protocol: url.protocol,
      host: url.host,
      pathPrefix: normalizePathPrefix(url.pathname),
    };
  } catch (error) {
    throw new InvalidRedirectAllowlistEntryError(entry, error);
  }
}

/**
 * Parses the comma-separated `MOBILE_AUTH_REDIRECT_ALLOWLIST` env var into
 * a list of allowed origin+path prefixes, e.g.
 * `https://app.activitymap.example/auth/callback,activitymap://auth/callback`.
 * Throws on a malformed entry rather than silently allowing nothing or
 * everything, so a typo fails closed at startup/first use rather than
 * quietly disabling the allow-list.
 */
export function parseMobileRedirectAllowlist(
  raw: string | undefined,
): AllowlistedRedirectPrefix[] {
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseAllowlistEntry);
}

export function loadMobileRedirectAllowlist(
  environment: Record<string, string | undefined> = process.env,
): AllowlistedRedirectPrefix[] {
  return parseMobileRedirectAllowlist(environment[ENV_VAR]);
}

/**
 * Returns true only when `candidate` is a well-formed URL whose protocol
 * and host exactly match an allow-list entry and whose path starts with
 * that entry's path prefix at a segment boundary.
 */
export function isAllowedMobileRedirectUri(
  candidate: string,
  allowlist: AllowlistedRedirectPrefix[],
): boolean {
  if (allowlist.length === 0) return false;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  const candidatePathPrefix = normalizePathPrefix(url.pathname);
  return allowlist.some(
    (entry) =>
      entry.protocol === url.protocol &&
      entry.host === url.host &&
      candidatePathPrefix.startsWith(entry.pathPrefix),
  );
}
