/**
 * Where sign-in records live. `ACTIVITYMAP_AUTH_STORE=convex` moves users,
 * linked accounts with their tokens, sessions and signing keys to the
 * sign-in store in Convex (backend/convex/authStore.ts); anything else
 * keeps them in Postgres.
 */
export function authStoreIsConvex(
  environment: Record<string, string | undefined> = process.env,
) {
  return environment.ACTIVITYMAP_AUTH_STORE === 'convex';
}
