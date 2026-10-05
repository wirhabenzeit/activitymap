/**
 * Where to send someone after connecting Strava (issue #304): back to the
 * app view they started from. Only same-origin application paths are
 * accepted; anything else falls back to the map, so a crafted link can never
 * turn sign-in into an open redirect.
 */
export const DEFAULT_RETURN_PATH = '/map';

const APP_ROUTES = ['/map', '/list', '/stats'];
/** Query parameters the OAuth round trip itself adds on failure. */
const AUTH_RESULT_PARAMS = ['error', 'error_description'];
const ORIGIN = 'https://return-path.invalid';

export function safeReturnPath(candidate: string | null | undefined): string {
  if (!candidate?.startsWith('/') || /^\/[/\\]/.test(candidate)) {
    return DEFAULT_RETURN_PATH;
  }
  let url: URL;
  try {
    url = new URL(candidate, ORIGIN);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (url.origin !== ORIGIN) return DEFAULT_RETURN_PATH;
  const isAppRoute = APP_ROUTES.some(
    (route) => url.pathname === route || url.pathname.startsWith(`${route}/`),
  );
  if (!isAppRoute) return DEFAULT_RETURN_PATH;
  // Only rewrite the query when there is something to remove, so the
  // view's own parameters keep their exact encoding.
  const params = [...url.searchParams];
  const kept = params.filter(([key]) => !AUTH_RESULT_PARAMS.includes(key));
  if (kept.length === params.length) return `${url.pathname}${url.search}`;
  const query = new URLSearchParams(kept).toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

export type ConnectFailure = 'cancelled' | 'failed';

/** Classify the `error` query parameter Better Auth adds after a failed round trip. */
export function connectFailure(
  error: string | null | undefined,
): ConnectFailure | null {
  if (!error) return null;
  // Strava reports a declined authorization as the OAuth `access_denied` error.
  return error === 'access_denied' ? 'cancelled' : 'failed';
}

/** Synthetic fallback addresses are an implementation detail, not identity. */
export function displayEmail(email: string | null | undefined): string | null {
  if (!email || email.toLowerCase().endsWith('@strava.local')) return null;
  return email;
}
