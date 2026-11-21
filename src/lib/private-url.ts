/**
 * Paths whose URL is itself a secret: a share token, or the one-time code on
 * the iOS sign-in callback (issue #482), or Strava's authorization code on the
 * return from the Strava app (issue #305). Analytics must never report them.
 * The vendor scripts may report the path alone or the whole URL, so both
 * forms are matched.
 */
const PRIVATE_PATH =
  /^(?:https?:\/\/[^/]+)?\/(?:share\/|auth\/(?:callback|strava)(?:[/?#]|$))/;

export function isPrivateUrl(url: string): boolean {
  return PRIVATE_PATH.test(url);
}
