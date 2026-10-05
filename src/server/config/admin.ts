/**
 * Strava athlete ids allowed to open the admin dashboard (issue #328), from
 * `ACTIVITYMAP_ADMIN_ATHLETE_IDS` (comma- or space-separated). Unset or empty
 * means nobody: the dashboard then answers 404 for everyone.
 */
export function adminAthleteIds(
  environment: Record<string, string | undefined> = process.env,
): Set<number> {
  const ids = new Set<number>();
  for (const value of (environment.ACTIVITYMAP_ADMIN_ATHLETE_IDS ?? '').split(
    /[\s,]+/,
  )) {
    if (/^\d+$/.test(value)) ids.add(Number(value));
  }
  return ids;
}

export function isAdminAthlete(
  athleteId: number | null | undefined,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return athleteId != null && adminAthleteIds(environment).has(athleteId);
}
