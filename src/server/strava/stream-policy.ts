// Stored streams have no age limit. The summary reconciliation cron
// revalidates the athlete's dataset, and any change to the source fields
// below invalidates the streams through the database trigger
// (docs/strava-data-policy.md).
export const STREAM_FETCH_LEASE_MS = 90_000;
export const STREAM_REQUEST_TIMEOUT_MS = 20_000;
export const STREAM_RETRY_MS = 60_000;

export const STREAM_SOURCE_FIELDS = [
  'athlete',
  'map_id',
  'map_polyline',
  'map_summary_polyline',
  'start_date',
  'start_date_local',
  'distance',
  'moving_time',
  'elapsed_time',
  'start_latlng',
  'end_latlng',
  'total_elevation_gain',
  'elev_high',
  'elev_low',
  'sport_type',
  'manual',
  'private',
  'trainer',
  'has_heartrate',
  'heartrate_opt_out',
  'display_hide_heartrate_option',
  'average_heartrate',
  'max_heartrate',
  'device_watts',
  'average_watts',
  'max_watts',
  'weighted_average_watts',
  'kilojoules',
] as const;
