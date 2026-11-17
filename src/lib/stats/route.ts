/** Production Stats routes share an independent sport scope. */
export function isStatsRoute(pathname: string | null | undefined): boolean {
  return pathname === '/stats' || Boolean(pathname?.startsWith('/stats/'));
}
