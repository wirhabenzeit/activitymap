/**
 * Ends a failed mobile sign-in by returning to the app instead of leaving the
 * person on a JSON error page inside the system sign-in sheet (issue #303).
 * The app matches `state` to its pending attempt, so a failure can only end
 * the attempt that started it.
 *
 * Only call this with a `redirectUri` that already passed the allow-list:
 * before that, the only safe answer is the JSON error response.
 */
export function mobileAuthErrorRedirect(
  redirectUri: string,
  params: { state: string; error: string; requestId?: string },
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set('error', safeErrorCode(params.error));
  target.searchParams.set('state', params.state);
  if (params.requestId) target.searchParams.set('request_id', params.requestId);
  return Response.redirect(target.toString(), 302);
}

/**
 * Provider and Better Auth error codes are short snake_case identifiers such
 * as `access_denied`; anything else is not forwarded verbatim.
 */
function safeErrorCode(error: string): string {
  return /^[a-z0-9_]{1,64}$/i.test(error)
    ? error.toLowerCase()
    : 'sign_in_failed';
}
