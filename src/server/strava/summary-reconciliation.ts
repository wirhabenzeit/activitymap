const DAY_MS = 24 * 60 * 60 * 1000;

/** Provider data older than this is not shown as current. */
export const STRAVA_FRESHNESS_LIMIT_MS = 7 * DAY_MS;
/** How often an account's library is reconciled with the provider's list. */
export const SUMMARY_RECONCILIATION_INTERVAL_MS = 6 * DAY_MS;
