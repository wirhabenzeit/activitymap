/**
 * The scopes ActivityMap asks Strava for at sign-in, on the web and in the iOS
 * app alike. `activity:read` alongside `activity:read_all` gives Strava's
 * consent screen separate public and private boxes, so leaving private
 * unticked still shares public activities (#303).
 */
export const STRAVA_SIGN_IN_SCOPES =
  'read,activity:read,activity:read_all,activity:write';
