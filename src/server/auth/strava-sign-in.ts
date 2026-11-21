import {
  findStravaAccountInternal,
  setAccountScopeInternal,
  updateUserInternal,
} from '~/server/auth/users';

/**
 * What follows a completed Strava sign-in, whichever way it arrived (the web
 * callback hook in `~/lib/auth.ts`, or the iOS app sign-in): link the user to
 * their athlete and record the scopes the person actually approved.
 *
 * Strava reports those scopes only on the authorization redirect; Better Auth
 * never records them (issue #303). `scope` is `null` when the redirect carried
 * none, which leaves a stored grant untouched.
 */
export async function finishStravaSignIn(
  userId: string,
  scope: string | null,
): Promise<void> {
  const account = await findStravaAccountInternal({ userId });
  if (!account) return;
  const athleteId = Number(account.accountId);
  if (!Number.isFinite(athleteId)) return;

  await updateUserInternal(userId, { athlete_id: athleteId });
  if (scope !== null) await setAccountScopeInternal(account.id, scope);
}
