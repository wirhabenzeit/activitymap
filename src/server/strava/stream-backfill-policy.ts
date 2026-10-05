// Hourly caps. Strava allows this app 3,000 reads a day; 40 activities an hour
// (about 1,100 reads a day) clears the historical backlog within days while
// leaving room for photos, details and interactive use.
export const STREAM_BACKFILL_DEFAULT_ACTIVITIES = 40;
export const STREAM_BACKFILL_MAX_ACTIVITIES = 40;
export const STREAM_BACKFILL_DEFAULT_REQUESTS = 60;
export const STREAM_BACKFILL_MAX_REQUESTS = 60;
export const STREAM_BACKFILL_TIME_MS = 45_000;
export const STREAM_BACKFILL_LEASE_MS = 90_000;
export const STREAM_BACKFILL_HOUR_MS = 3_600_000;

export type BackfillStopReason =
  | 'complete'
  | 'busy'
  | 'activity_limit'
  | 'request_limit'
  | 'deadline'
  | 'rate_limit'
  | 'lease_lost';

export class StreamBackfillStopped extends Error {
  constructor(public readonly reason: BackfillStopReason) {
    super(`Stream backfill stopped: ${reason}`);
  }
}

export function streamBackfillRetryAt(now: Date, attempt: number): Date {
  return new Date(
    now.getTime() +
      Math.min(
        24 * STREAM_BACKFILL_HOUR_MS,
        STREAM_BACKFILL_HOUR_MS * 2 ** Math.min(10, Math.max(0, attempt - 1)),
      ),
  );
}

export function validateBackfillLimits(
  activities: number,
  requests: number,
  timeMs: number,
) {
  for (const [name, value, max] of [
    ['activities', activities, STREAM_BACKFILL_MAX_ACTIVITIES],
    ['requests', requests, STREAM_BACKFILL_MAX_REQUESTS],
    ['timeMs', timeMs, STREAM_BACKFILL_TIME_MS],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new RangeError(`${name} must be an integer between 1 and ${max}`);
  }
}
