/**
 * Stats pages (`/stats/tiles`, `/stats/review`, ...) share one filter scope:
 * the reporting period and the "only selected" restriction are not offered,
 * and resets keep them. Every sidebar control must use this one predicate.
 */
export function isStatsRoute(pathname: string | null | undefined): boolean {
  return pathname === '/stats' || Boolean(pathname?.startsWith('/stats/'));
}
