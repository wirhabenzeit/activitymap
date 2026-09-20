/**
 * Explicit opt-in field-disclosure groups for a private share link
 * (issue #132; see docs/strava-data-policy.md §5).
 *
 * Every group defaults to `false` (excluded). Disclosing any of them is a
 * deliberate, visible choice made by the athlete in the share-creation flow,
 * never an ambient default - see `~/server/sharing/validators.ts` (the
 * creation input schema, which defaults every group to `false`) and
 * `~/contracts/share/activity.ts` (the recipient-facing DTO, which is an
 * allow-list gated by these flags, not the full activity minus some
 * excluded keys).
 *
 * This module is imported by both server code (schema, application service)
 * and client UI (the share-creation dialog's field toggles), so it stays
 * free of any `server-only`/framework import.
 */
export type ShareLinkFieldOptions = {
  /** `has_heartrate`, `average_heartrate`, `max_heartrate`. */
  heartRate: boolean;
  /** `device_watts`, `average_watts`, `max_watts`, `weighted_average_watts`, `kilojoules`, `calories`. */
  power: boolean;
  /** `kudos_count`, `comment_count`, `achievement_count`, `athlete_count`, `pr_count`, `has_kudoed`. */
  social: boolean;
  /** `start_latlng`, `end_latlng`. */
  preciseLocation: boolean;
};

export const DEFAULT_SHARE_LINK_FIELD_OPTIONS: ShareLinkFieldOptions = {
  heartRate: false,
  power: false,
  social: false,
  preciseLocation: false,
};

export const SHARE_LINK_FIELD_GROUP_LABELS: Record<
  keyof ShareLinkFieldOptions,
  { label: string; description: string }
> = {
  heartRate: {
    label: 'Heart rate',
    description: 'Average and max heart rate.',
  },
  power: {
    label: 'Power & energy',
    description: 'Watts, weighted average power, kilojoules, and calories.',
  },
  social: {
    label: 'Comments & kudos',
    description: 'Kudos, comments, achievements, and other athletes present.',
  },
  preciseLocation: {
    label: 'Precise start/end location',
    description: 'The exact start and end coordinates of each activity.',
  },
};
