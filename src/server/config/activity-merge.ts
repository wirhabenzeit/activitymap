/**
 * Who can merge activities, from `ACTIVITYMAP_MERGE_ATHLETE_IDS`: Strava
 * athlete ids (comma- or space-separated), or `*` for everyone. Unset or
 * empty means nobody, and the merge endpoints answer 404.
 *
 * The feature uploads to and changes people's Strava accounts, so it is
 * rolled out to named athletes first and opened to everyone after testing.
 */
export function isActivityMergeEnabled(
  athleteId: number | null | undefined,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (athleteId == null) return false;
  const values = (environment.ACTIVITYMAP_MERGE_ATHLETE_IDS ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (values.includes('*')) return true;
  return values.some(
    (value) => /^\d+$/.test(value) && Number(value) === athleteId,
  );
}
