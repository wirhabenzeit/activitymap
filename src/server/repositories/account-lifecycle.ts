import 'server-only';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import type { db } from '~/server/db';
import { accounts, users } from '~/server/db/schema';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Fence work started with an account that has since been deleted/recreated. */
export async function lockActiveStravaAccount(
  tx: Transaction,
  identity: { userId: string; id: string },
): Promise<boolean> {
  // Match deletion's user-before-account lock order. Hold these locks until
  // persistence commits; erasure either runs afterwards or wins before us.
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, identity.userId))
    .for('key share');
  if (!user) return false;
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, identity.id),
        eq(accounts.userId, identity.userId),
        eq(accounts.providerId, 'strava'),
        isNull(accounts.revokedAt),
        or(isNotNull(accounts.accessToken), isNotNull(accounts.access_token)),
      ),
    )
    .for('share');
  return Boolean(account);
}
