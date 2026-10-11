/**
 * Athlete-chosen options for a private track share (issue #132; see
 * docs/strava-data-policy.md §5).
 *
 * A share discloses a fixed, track-level allow-list (see
 * `~/contracts/share/activity.ts`): route, name, sport, date and the basic
 * distance/time/elevation/speed summary. Health, power, social and every
 * other Strava field are never shared, so they are not options here.
 *
 * The one option is whether the route keeps its true start and finish. By
 * default the server trims both ends (`~/lib/sharing/route-trim.ts`) before
 * the route ever leaves it; showing them is a deliberate opt-in.
 *
 * This module is imported by both server code (schema, application service)
 * and client UI (the share-creation dialog), so it stays free of any
 * `server-only`/framework import.
 */
export type ShareLinkFieldOptions = {
  /** Show each route's true start and finish instead of trimming both ends. */
  showRouteEnds: boolean;
};

/**
 * What a `share_links.fields` row may contain. Links created before shares
 * were narrowed to tracks stored four opt-in groups; only `preciseLocation`
 * still means anything (the athlete chose to reveal exact start/end points).
 */
export type StoredShareLinkFieldOptions = Partial<ShareLinkFieldOptions> & {
  heartRate?: boolean;
  power?: boolean;
  social?: boolean;
  preciseLocation?: boolean;
};

export const DEFAULT_SHARE_LINK_FIELD_OPTIONS: ShareLinkFieldOptions = {
  showRouteEnds: false,
};

export function normalizeShareLinkFieldOptions(
  stored: StoredShareLinkFieldOptions,
): ShareLinkFieldOptions {
  return {
    showRouteEnds: stored.showRouteEnds === true || stored.preciseLocation === true,
  };
}
