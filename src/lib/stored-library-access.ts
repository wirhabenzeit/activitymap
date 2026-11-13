/** Stored Strava data is available while the account remains connected. */
export function hasStoredLibraryAccess(
  user: { stravaConnected: boolean } | null | undefined,
) {
  return user?.stravaConnected === true;
}
